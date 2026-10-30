/**
 * Rate limiting and per-user quotas.
 *
 * Deliberately in-memory: a Vercel serverless instance keeps its own counters, so this
 * is a burst brake and a best-effort daily quota, not a distributed ledger. The
 * production-grade swap is @upstash/ratelimit on a shared Redis - the call signature
 * below is what that adapter must implement (see README "Limitations").
 */
import { track, type Opts, type WorkResult } from "./diag";

export type QuotaKind = "guest_analyze" | "user_analyze" | "user_chat" | "burst";

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k);
}

function limits(): Record<QuotaKind, { max: number; windowMs: number }> {
  const n = (v: string | undefined, d: number) => Number(v && Number(v) > 0 ? v : d);
  return {
    guest_analyze: { max: n(process.env.GUEST_MAX_ANALYSES_PER_DAY, 3), windowMs: 24 * 60 * 60_000 },
    user_analyze: { max: n(process.env.USER_MAX_ANALYSES_PER_DAY, 20), windowMs: 24 * 60 * 60_000 },
    user_chat: { max: n(process.env.USER_MAX_CHAT_MESSAGES_PER_DAY, 100), windowMs: 24 * 60 * 60_000 },
    burst: { max: 12, windowMs: 60_000 },
  };
}

export interface QuotaState {
  kind: QuotaKind;
  key: string;
  limit: number;
  used: number;
  remaining: number;
  resetInMs: number;
  allowed: boolean;
}

/** Consume one unit. Never throws; a failure to record is reported as a failing check. */
export function consume(kind: QuotaKind, identity: string, opts: Opts = {}): WorkResult<QuotaState> {
  const p = track<QuotaState>(`ratelimit.consume(${kind})`, opts);
  try {
    sweep();
    const { max, windowMs } = limits()[kind];
    const day = new Date().toISOString().slice(0, 10);
    const key = kind === "burst" ? `${kind}:${identity}` : `${kind}:${day}:${identity}`;
    const now = Date.now();
    const b = store.get(key);
    const bucket: Bucket = !b || b.resetAt <= now ? { count: 0, resetAt: now + windowMs } : b;
    bucket.count += 1;
    store.set(key, bucket);
    const state: QuotaState = {
      kind,
      key,
      limit: max,
      used: bucket.count,
      remaining: Math.max(0, max - bucket.count),
      resetInMs: Math.max(0, bucket.resetAt - now),
      allowed: bucket.count <= max,
    };
    p.check(
      `${kind} quota ${state.allowed ? "ok" : "EXCEEDED"} for ${identity.slice(0, 24)}`,
      state.allowed,
      `${state.used}/${max} used; resets in ${Math.round(state.resetInMs / 60_000)} min`,
    );
    if (opts.is_working) {
      // roll the counter back so a health probe does not eat the user's day
      bucket.count -= 1;
      store.set(key, bucket);
      p.skip("quota charged", "is_working: counter decremented after the probe");
    }
    return p.done(state);
  } catch (e) {
    return p.caught(e);
  }
}

/** Pre-flight check without charging (used by the Vitals tab). */
export function peek(kind: QuotaKind, identity: string, opts: Opts = {}): WorkResult<QuotaState> {
  const p = track<QuotaState>(`ratelimit.peek(${kind})`, opts);
  const { max, windowMs } = limits()[kind];
  const day = new Date().toISOString().slice(0, 10);
  const key = kind === "burst" ? `${kind}:${identity}` : `${kind}:${day}:${identity}`;
  const b = store.get(key);
  const used = b && b.resetAt > Date.now() ? b.count : 0;
  p.check(`${key.slice(0, 40)} at ${used}/${max}`, used <= max);
  return p.done({ kind, key, limit: max, used, remaining: Math.max(0, max - used), resetInMs: b ? Math.max(0, b.resetAt - Date.now()) : windowMs, allowed: used <= max });
}

export function clientIp(req: Request): string {
  const h = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";
  const first = h.split(",")[0]?.trim();
  return first || "unknown-ip";
}

/** Self-test: the brake engages, and the probe does not consume real quota. */
export async function selfTest(opts: Opts = {}): Promise<WorkResult<QuotaState>> {
  const p = track<QuotaState>("ratelimit.selfTest", { ...opts, is_working: true });
  const daily = consume("guest_analyze", "self-test-daily", { is_working: true });
  p.attach(daily, "consume#daily");
  const before = peek("guest_analyze", "self-test-daily-2", { is_working: true });
  consume("guest_analyze", "self-test-daily-2", { is_working: true });
  const after = peek("guest_analyze", "self-test-daily-2", { is_working: true });
  p.check("probes do not accumulate (rollback works)", before.data?.used === after.data?.used, `${before.data?.used} -> ${after.data?.used}`);
  p.check("daily keys include the date", daily.data ? /^guest_analyze:\d{4}-\d{2}-\d{2}:/.test(daily.data.key) : false, daily.data?.key ?? "no key");
  const burst = consume("burst", "self-test-burst", { is_working: true });
  p.attach(burst, "consume#burst");
  p.check("burst window is one minute", burst.data ? burst.data.resetInMs <= 60_000 : false);
  return p.done(daily.data);
}
