/**
 * JusticeAI self-test layer.
 *
 * CONVENTION (applies to every function in `lib/` and every API route):
 *   fn(input, { is_working })  ->  WorkResult<T> = { ok, data, checks, error, is_working }
 *
 * - `is_working` falsy  → normal execution. The function still records checks, so the
 *   UI can show a "what happened" trace for real traffic.
 * - `is_working: true`  → SELF-TEST mode. Inputs and dependencies are validated, but NO
 *   billable / side-effecting work happens (no Groq call, no Firestore write). The
 *   function returns a fixture `data` plus the list of checks it performed. This is what
 *   `/api/health` and the in-app "System Vitals" tab aggregate.
 *
 * `ok` is true only when nothing failed: no thrown error AND no failing recorded check.
 */

export interface WorkCheck {
  /** owning function name, e.g. "groq.chat" */
  fn: string;
  /** short human-readable assertion, e.g. "problem is at least 12 chars" */
  name: string;
  ok: boolean;
  /** evidence / observed value — shown in the Vitals UI */
  detail: string;
  ms: number;
  /** true when the check was not really executed because is_working short-circuited it */
  skipped: boolean;
}

export interface Opts {
  is_working?: boolean;
  /** forwarded to fetch/abortables so timeouts cancel cleanly */
  signal?: AbortSignal;
}

export interface WorkResult<T> {
  ok: boolean;
  data: T | null;
  checks: WorkCheck[];
  error?: string;
  is_working: boolean;
}

type Verdict = boolean | string | void;

export class Probe<T> {
  readonly fn: string;
  readonly working: boolean;
  private readonly checks: WorkCheck[] = [];
  private readonly startedAt = Date.now();
  private stepStart = Date.now();
  private error?: string;

  constructor(fn: string, opts: Opts = {}) {
    this.fn = fn;
    this.working = opts.is_working === true;
    this.stepStart = this.startedAt;
  }

  /** Record a boolean assertion. Returning a string marks a pass and uses it as detail. */
  check(name: string, verdict: Verdict, detailOverride?: string): boolean {
    const ms = Date.now() - this.stepStart;
    this.stepStart = Date.now();
    let ok = true;
    let detail = "";
    if (typeof verdict === "string") {
      ok = true;
      detail = verdict;
    } else if (typeof verdict === "boolean") {
      ok = verdict;
      detail = verdict ? "passed" : "failed";
    } else {
      detail = "no assertion returned";
    }
    this.checks.push({ fn: this.fn, name, ok, detail: detailOverride ?? detail, ms, skipped: false });
    return ok;
  }

  /** Record a failing assertion (alias for check(name, false)). */
  fail(name: string, detail: string): void {
    this.checks.push({
      fn: this.fn,
      name,
      ok: false,
      detail,
      ms: Date.now() - this.stepStart,
      skipped: false,
    });
    this.stepStart = Date.now();
  }

  /** Record that a real side effect was intentionally not performed (self-test mode). */
  skip(name: string, detail: string): void {
    this.checks.push({
      fn: this.fn,
      name,
      ok: true,
      detail,
      ms: 0,
      skipped: true,
    });
  }

  /** Merge checks from a nested WorkResult (child fn is prefixed for traceability). */
  attach<R>(child: WorkResult<R>, label: string): R | null {
    for (const c of child.checks) {
      this.checks.push({ ...c, fn: `${this.fn}:${label}`, name: c.name });
    }
    if (!child.ok) {
      this.error = child.error ?? `nested step "${label}" reported a failure`;
    }
    return child.data;
  }

  /** Merge raw checks produced by another probe (same fn label rules as attach). */
  merge(checks: WorkCheck[], label: string): void {
    for (const c of checks) this.checks.push({ ...c, fn: `${this.fn}:${label}` });
  }

  /** Self-test short-circuit: return fixture data without doing real work. */
  fixture(data: T, note = "self-test mode: real side effect skipped"): WorkResult<T> {
    this.skip("side effects", note);
    return this.done(data);
  }

  /** Finalise. `ok` = no error AND every recorded check passed. */
  done(data: T | null, error?: string): WorkResult<T> {
    if (error) this.error = error;
    const checks = this.checks.slice();
    const failed = checks.some((c) => !c.ok);
    return {
      ok: !this.error && !failed,
      data: this.error && !data ? null : data,
      checks,
      error: this.error,
      is_working: this.working,
    };
  }

  /** Convenience for the error path: `catch (e) { return p.error(e) }`. */
  caught(err: unknown): WorkResult<T> {
    const message = err instanceof Error ? err.message : String(err);
    this.checks.push({
      fn: this.fn,
      name: "threw",
      ok: false,
      detail: message,
      ms: Date.now() - this.startedAt,
      skipped: false,
    });
    return this.done(null, message);
  }
}

/** Create a probe. Every public function in this repo starts with this line. */
export function track<T>(fn: string, opts: Opts = {}): Probe<T> {
  return new Probe<T>(fn, opts);
}

/** True when the caller asked for self-test mode. */
export function working(opts: Opts = {}): boolean {
  return opts.is_working === true;
}

export interface HealthSummary {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failing: WorkCheck[];
}

/** Flatten several WorkResults into one summary — used by /api/health. */
export function summarize(results: WorkResult<unknown>[]): HealthSummary {
  const checks = results.flatMap((r) => r.checks);
  const failing = checks.filter((c) => !c.ok);
  return {
    ok: failing.length === 0 && results.every((r) => r.ok),
    total: checks.length,
    passed: checks.filter((c) => c.ok && !c.skipped).length,
    failed: failing.length,
    skipped: checks.filter((c) => c.skipped).length,
    failing,
  };
}

/**
 * Read an env var and record its presence as a check (never logs the value).
 * A missing *required* variable fails the probe, so /api/health turns red instead of
 * silently reporting "passed".
 */
export function envCheck<T>(p: Probe<T>, name: string, required = true): string | null {
  const value = (process.env[name] ?? "").trim();
  const present = value.length > 0;
  if (present) p.check(`${name} is configured`, "present");
  else if (required) p.check(`${name} is configured`, false, `missing — set ${name} in .env.local and in Vercel → Environment Variables`);
  else p.check(`${name} is configured`, true, "not set (optional)");
  return present ? value : null;
}
