/**
 * The self-test registry. Every module exposes `selfTest({ is_working: true })`;
 * this runs them all and flattens the result into one report that /api/health serves
 * and the in-app "System Vitals" tab renders.
 *
 * Nothing here spends tokens: groq.chat short-circuits in self-test mode.
 */
import { summarize, track, type Opts, type WorkCheck, type WorkResult } from "./diag";
import { selfTest as analyzeSelfTest } from "./analyze";
import { selfTest as chatSelfTest } from "./chat";
import { selfTest as dbSelfTest } from "./db";
import { config as groqConfig, listModels, resolveVisionModel } from "./groq";
import { selfTest as keyPoolSelfTest, status as keyPoolStatus } from "./keypool";
import { selfTest as firebaseSelfTest } from "./firebaseAdmin";
import { corpusStats, selfTest as ragSelfTest } from "./rag";
import { selfTest as guidanceSelfTest } from "./guidance";
import { selfTest as precedentsSelfTest } from "./precedents";
import { selfTest as ratelimitSelfTest } from "./ratelimit";
import { selfTest as remindersSelfTest } from "./reminders";

export interface ServiceReport {
  name: string;
  ok: boolean;
  error?: string;
  checks: WorkCheck[];
  data?: unknown;
}

/** Failures here degrade the app (no cross-device sync, no photo reading) but do not break it. */
const OPTIONAL = new Set(["firebaseAdmin.selfTest", "db.selfTest", "groq.vision", "reminders.selfTest"]);

export interface HealthReport {
  ok: boolean;
  degraded: string[];
  at: string;
  durationMs: number;
  summary: ReturnType<typeof summarize>;
  services: ServiceReport[];
  corpus: ReturnType<typeof corpusStats>;
  models: { text: string; fast: string; vision: string | null; active: string[]; note: string };
  keys: { total: number; available: number; cooling: number; rejected: number; slots: { label: string; state: string; forHowLongMs?: number }[] };
  quota: { guestPerDay: number; userPerDay: number; userChatPerDay: number };
}

async function one(name: string, run: () => Promise<WorkResult<unknown>>): Promise<ServiceReport> {
  try {
    const r = await run();
    return { name, ok: r.ok, error: r.error, checks: r.checks, data: r.data };
  } catch (e) {
    const p = track(name, { is_working: true });
    return { name, ok: false, error: e instanceof Error ? e.message : String(e), checks: p.caught(e).checks };
  }
}

export async function runSelfTests(opts: Opts = {}): Promise<HealthReport> {
  const started = Date.now();
  const w = { ...opts, is_working: true };

  const services = await Promise.all([
    one("groq.config", async () => groqConfig(w)),
    one("keypool.selfTest", async () => keyPoolSelfTest(w)),
    one("groq.listModels", () => listModels(w)),
    one("groq.vision", () => resolveVisionModel(w)),
    one("rag.selfTest", () => ragSelfTest(w)),
    one("analyze.selfTest", () => analyzeSelfTest(w)),
    one("chat.selfTest", () => chatSelfTest(w)),
    one("precedents.selfTest", async () => precedentsSelfTest(w)),
    one("guidance.selfTest", async () => guidanceSelfTest(w)),
    one("reminders.selfTest", () => remindersSelfTest(w)),
    one("ratelimit.selfTest", () => ratelimitSelfTest(w)),
    one("firebaseAdmin.selfTest", () => firebaseSelfTest(w)),
    one("db.selfTest", () => dbSelfTest(w)),
  ]);

  const asResults = services.map((s) => ({ ok: s.ok, data: null, checks: s.checks, is_working: true, error: s.error } as WorkResult<null>));
  const summary = summarize(asResults);
  const failingRequired = services.filter((s) => !s.ok && !OPTIONAL.has(s.name)).map((s) => s.name);
  const degraded = services.filter((s) => !s.ok && OPTIONAL.has(s.name)).map((s) => `${s.name}: ${s.error ?? "check failed"}`);

  const modelsData = services.find((s) => s.name === "groq.listModels")?.data as { ids?: string[] } | undefined;
  const visionData = services.find((s) => s.name === "groq.vision")?.data as string | null | undefined;
  const cfg = services.find((s) => s.name === "groq.config")?.data as { textModel?: string; fastModel?: string; visionModel?: string } | undefined;
  const cfgProbe = groqConfig(w);

  return {
    ok: failingRequired.length === 0,
    degraded,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    summary: { ...summary, ok: failingRequired.length === 0, failing: [...summary.failing] },
    services,
    corpus: corpusStats(),
    models: {
      text: cfg?.textModel ?? "openai/gpt-oss-20b",
      fast: cfg?.fastModel ?? "openai/gpt-oss-20b",
      vision: visionData ?? cfg?.visionModel ?? null,
      active: modelsData?.ids ?? [],
      note: cfgProbe.ok ? "Groq reachable" : cfgProbe.error ?? "Groq not configured",
    },
    // pool state, never pool contents: this object is served to the browser
    keys: keyPoolStatus(),
    quota: {
      guestPerDay: Number(process.env.GUEST_MAX_ANALYSES_PER_DAY ?? 3),
      userPerDay: Number(process.env.USER_MAX_ANALYSES_PER_DAY ?? 20),
      userChatPerDay: Number(process.env.USER_MAX_CHAT_MESSAGES_PER_DAY ?? 100),
    },
  };
}
