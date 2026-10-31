/**
 * Groq API key pool: round-robin rotation with per-key penalty boxes.
 *
 * WHY. One Groq key carries a tokens-per-minute *and* a tokens-per-day allowance, and the day
 * one is the killer: live testing burned a single key's daily quota in an afternoon and every
 * request after it failed with `... on tokens per day`, no matter how long we waited. N keys
 * means N independent allowances, so the app scales roughly linearly with the pool instead of
 * dying on one account's calendar.
 *
 * HOW.
 *  - `acquire()` advances a cursor, so two consecutive requests never use the same key.
 *  - A key that answers 401/403 (revoked, expired, wrong) is taken out for the life of the
 *    process: it will not come back mid-day, and retrying it only burns the user's patience.
 *  - A key that answers 429 (rate or daily limit) cools down and is skipped until then.
 *  - If every key is cooling, we still hand out the one that frees up soonest rather than
 *    returning null, because a slow answer beats no answer.
 *
 * NEVER EXPOSE KEY MATERIAL. `Probe` checks are returned to the browser in every API response
 * (the envelope carries `checks`), so anything written here is public. Slots are identified by
 * position and a truncated SHA-256 fingerprint - enough to say "key 3 of 4 is cooling" in the
 * Vitals tab without leaking a character of the secret.
 */
import { createHash } from "node:crypto";
import { track, type Opts, type WorkResult } from "./diag";

export interface KeySlot {
  /** 1-based, for humans */
  index: number;
  total: number;
  /** non-reversible, safe to print */
  fingerprint: string;
}

interface Entry {
  value: string;
  fingerprint: string;
  /** epoch ms before which this key must not be used (429 / 5xx) */
  coolingUntil: number;
  /** a 401/403 key is dead for this process */
  rejected: boolean;
  rejectReason?: string;
}

const COOLDOWN_429_MS = 60_000;
const COOLDOWN_5XX_MS = 15_000;
/** a daily-limit 429 is not going to clear in a minute: back off much harder */
const COOLDOWN_DAILY_MS = 30 * 60_000;

let entries: Entry[] = [];
let cursor = 0;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function looksReal(value: string): boolean {
  if (value.length < 20) return false;
  // the repo ships a placeholder line in .env; never send it upstream
  if (/^(paste|your|changeme|todo|xxx|none|placeholder)/i.test(value)) return false;
  return true;
}

/**
 * Read the pool from the environment. Two shapes are supported because both are natural:
 *   GROQ_API_KEYS=k1,k2,k3                     (one variable, any separator)
 *   GROQ_API_KEY=k1  GROQ_API_KEY2=k2  ...     (numbered, what .env uses)
 * Deduplicated, so the same key pasted twice does not pretend to be two allowances.
 */
export function syncPool(): number {
  const found: string[] = [];

  const bulk = (process.env.GROQ_API_KEYS ?? "").trim();
  if (bulk) found.push(...bulk.split(/[\s,;]+/));

  const single = (process.env.GROQ_API_KEY ?? "").trim();
  if (single) found.push(single);

  // GROQ_API_KEY2..GROQ_API_KEY20: stop at the first gap so a typo in the middle is reported
  // rather than silently hiding the keys after it.
  for (let n = 2; n <= 20; n += 1) {
    const v = (process.env[`GROQ_API_KEY${n}`] ?? "").trim();
    if (!v) break;
    found.push(v);
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of found) {
    const value = raw.trim();
    if (!looksReal(value) || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }

  const previous = new Map(entries.map((e) => [e.fingerprint, e]));
  entries = values.map((value) => {
    const fp = fingerprint(value);
    const known = previous.get(fp);
    // keep the penalty box across a re-read, otherwise a config probe would revive dead keys
    return known ?? { value, fingerprint: fp, coolingUntil: 0, rejected: false };
  });
  if (cursor >= entries.length) cursor = 0;
  return entries.length;
}

function total(): number {
  if (!entries.length) syncPool();
  return entries.length;
}

export interface Acquired {
  value: string;
  slot: KeySlot;
  /** true when nothing was free and we used the key that cools down soonest */
  bestEffort: boolean;
}

/** Next key in rotation. The cursor moves every call, so consecutive requests differ by design. */
export function acquire(): Acquired | null {
  const n = total();
  if (!n) return null;
  const now = Date.now();

  for (let step = 0; step < n; step += 1) {
    const i = (cursor + step) % n;
    const e = entries[i];
    if (!e.rejected && e.coolingUntil <= now) {
      cursor = (i + 1) % n;
      return { value: e.value, slot: { index: i + 1, total: n, fingerprint: e.fingerprint }, bestEffort: false };
    }
  }

  // every key is penalised: hand back the soonest-to-clear one and let the caller decide
  const alive = entries.filter((e) => !e.rejected);
  const pool = alive.length ? alive : entries;
  const sorted = [...pool].sort((a, b) => a.coolingUntil - b.coolingUntil);
  const i = entries.indexOf(sorted[0]);
  cursor = (i + 1) % n;
  return { value: sorted[0].value, slot: { index: i + 1, total: n, fingerprint: sorted[0].fingerprint }, bestEffort: true };
}

/** Distinct keys to try inside ONE request before giving up. */
export function attemptBudget(): number {
  const n = total();
  if (!n) return 0;
  return Math.min(n, Number(process.env.GROQ_KEY_ATTEMPTS ?? 3) || 3);
}

/**
 * Look at the key a request WOULD get, without advancing the cursor.
 *
 * A config/health probe must not consume a slot: an early version called acquire() inside
 * config(), so every real request started on the second key and the pool rotated one step
 * ahead of itself for no reason.
 */
export function peek(): Acquired | null {
  const n = total();
  if (!n) return null;
  const now = Date.now();
  for (let step = 0; step < n; step += 1) {
    const i = (cursor + step) % n;
    const e = entries[i];
    if (!e.rejected && e.coolingUntil <= now) return { value: e.value, slot: { index: i + 1, total: n, fingerprint: e.fingerprint }, bestEffort: false };
  }
  const e = entries.find((x) => !x.rejected) ?? entries[0];
  return { value: e.value, slot: { index: entries.indexOf(e) + 1, total: n, fingerprint: e.fingerprint }, bestEffort: true };
}

/**
 * Record what upstream said about this key. Returns how long the key is out of action, so the
 * caller can put a human-readable number in its own trace.
 */
export function reportFailure(fingerprint: string, status: number, detail = ""): number {
  const e = entries.find((x) => x.fingerprint === fingerprint);
  if (!e) return 0;
  const now = Date.now();

  if (status === 401 || status === 403) {
    e.rejected = true;
    e.rejectReason = `HTTP ${status}`;
    e.coolingUntil = Number.MAX_SAFE_INTEGER;
    return -1; // -1 = out for the process
  }
  const daily = /per\s*da[y]?|daily/i.test(detail);
  const ms = status === 429 ? (daily ? COOLDOWN_DAILY_MS : COOLDOWN_429_MS) : status >= 500 ? COOLDOWN_5XX_MS : 0;
  if (ms > 0) e.coolingUntil = now + ms;
  return ms;
}

/** A key that answered successfully should not stay marked cooling from an earlier 429. */
export function reportSuccess(fingerprint: string): void {
  const e = entries.find((x) => x.fingerprint === fingerprint);
  if (e && !e.rejected) e.coolingUntil = 0;
}

export interface PoolStatus {
  total: number;
  available: number;
  cooling: number;
  rejected: number;
  /** "key 2/4 (a1b2c3d4)" style labels - never the secret */
  slots: { label: string; state: "ready" | "cooling" | "rejected"; forHowLongMs?: number }[];
}

export function status(): PoolStatus {
  const n = total();
  const now = Date.now();
  const slots = entries.map((e, i) => ({
    label: `key ${i + 1}/${n} (${e.fingerprint})`,
    state: (e.rejected ? "rejected" : e.coolingUntil > now ? "cooling" : "ready") as "ready" | "cooling" | "rejected",
    forHowLongMs: e.rejected ? undefined : Math.max(0, e.coolingUntil - now),
  }));
  return {
    total: n,
    available: slots.filter((s) => s.state === "ready").length,
    cooling: slots.filter((s) => s.state === "cooling").length,
    rejected: slots.filter((s) => s.state === "rejected").length,
    slots,
  };
}

/** Test hook: forget everything so env changes take effect in isolation. */
export function resetPool(): void {
  entries = [];
  cursor = 0;
}

/**
 * Health probe. Deliberately does NOT simulate failures against the real pool: marking a live
 * key as cooling for 60 s just to prove the penalty box works would hurt real users. The
 * penalty behaviour is covered in isolation by tests/keypool.test.ts, which calls resetPool()
 * and works on fake env values. Here we only prove we can read the pool and that consecutive
 * acquires hand out different keys.
 */
export function selfTest(opts: Opts = {}): WorkResult<PoolStatus> {
  const p = track<PoolStatus>("keypool.selfTest", opts);
  const n = syncPool();
  p.check(`pool parsed from the environment`, n > 0, n ? `${n} distinct key(s)` : "none - set GROQ_API_KEY / GROQ_API_KEY2..N / GROQ_API_KEYS");
  p.check("no secret material is exposed by the probe", !JSON.stringify(status()).includes("gsk_"), "slots are reported as position + hash only");

  if (n >= 2) {
    const a = acquire();
    const b = acquire();
    p.check("two consecutive requests get two different keys", a?.slot.fingerprint !== b?.slot.fingerprint, `${a?.slot.index} -> ${b?.slot.index}`);
    // rewind to just after the first key: a probe must not consume a real slot either
    if (a) cursor = a.slot.index % n;
  } else {
    p.skip("rotation across keys", "only one key configured - add GROQ_API_KEY2 to spread the load");
  }
  return p.done(status());
}
