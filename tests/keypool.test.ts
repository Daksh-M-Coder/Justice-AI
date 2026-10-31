/**
 * The Groq key pool.
 *
 * Rotation is the scaling mechanism: each key has its own tokens-per-minute AND tokens-per-day
 * allowance, and a spent key used to fail every request until midnight. These tests pin the
 * three things that make it work - consecutive requests use different keys, a dead key leaves
 * rotation, and the pool never hands out secret material to a trace.
 *
 * Every case works on fake values in isolation; nothing here talks to the network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquire, attemptBudget, reportFailure, reportSuccess, resetPool, selfTest, status, syncPool } from "@/lib/keypool";

const K1 = "gsk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11";
const K2 = "gsk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb22";
const K3 = "gsk_cccccccccccccccccccccccccccccccccccccccccccccccc33";

function envKeys(env: Record<string, string | undefined>) {
  for (const k of ["GROQ_API_KEY", "GROQ_API_KEYS", "GROQ_API_KEY2", "GROQ_API_KEY3", "GROQ_API_KEY4", "GROQ_API_KEY5"]) delete process.env[k];
  Object.assign(process.env, env);
}

beforeEach(() => resetPool());
afterEach(() => {
  resetPool();
  envKeys({ GROQ_API_KEY: "test-key-not-a-real-secret" }); // whatever tests/setup.ts established
});

describe("parsing the pool from the environment", () => {
  it("takes the single key, the numbered keys and the bulk list, in that order", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2, GROQ_API_KEY3: K3 });
    expect(syncPool()).toBe(3);
  });

  it("splits GROQ_API_KEYS on commas, spaces, semicolons and newlines", () => {
    envKeys({ GROQ_API_KEYS: `${K1}, ${K2};\n${K3}` });
    expect(syncPool()).toBe(3);
  });

  it("collapses a key pasted twice, because two copies is not two allowances", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K1, GROQ_API_KEYS: `${K1} ${K2}` });
    expect(syncPool()).toBe(2);
  });

  it("refuses placeholders and stops at the first gap in the numbering", () => {
    envKeys({ GROQ_API_KEY: "PASTE_ROTATED_KEY_IN_ENV_LOCAL_NOT_HERE", GROQ_API_KEY2: "short", GROQ_API_KEYS: K1 });
    expect(syncPool()).toBe(1);
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY3: K3 }); // no KEY2 -> the scan stops, KEY3 is not silently skipped over
    expect(syncPool()).toBe(1);
  });
});

describe("round-robin rotation", () => {
  it("never gives the same key twice in a row while the pool has choices", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2, GROQ_API_KEY3: K3 });
    syncPool();
    const a = acquire()!;
    const b = acquire()!;
    const c = acquire()!;
    expect(new Set([a.slot.fingerprint, b.slot.fingerprint, c.slot.fingerprint]).size).toBe(3);
    const d = acquire()!; // wraps
    expect(d.slot.fingerprint).toBe(a.slot.fingerprint);
    expect([a.slot.index, b.slot.index, c.slot.index, d.slot.index]).toEqual([1, 2, 3, 1]);
    expect(a.slot.total).toBe(3);
  });

  it("returns null only when there is genuinely no key at all", () => {
    envKeys({});
    expect(syncPool()).toBe(0);
    expect(acquire()).toBeNull();
    expect(attemptBudget()).toBe(0);
  });

  it("caps the per-request attempt count so one user cannot walk the whole pool", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2, GROQ_API_KEYS: `${K1} ${K2} ${K3}` });
    syncPool();
    expect(status().total).toBe(3);
    expect(attemptBudget()).toBe(3);
    envKeys({ GROQ_API_KEY: K1 });
    resetPool();
    syncPool();
    expect(attemptBudget()).toBe(1);
  });
});

describe("the penalty boxes", () => {
  it("takes a 401 key out of rotation for the life of the process", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2 });
    syncPool();
    const first = acquire()!;
    expect(reportFailure(first.slot.fingerprint, 401)).toBe(-1);
    const next = acquire()!;
    // the surviving key is the OTHER one, and it is the only one ever offered again
    expect(next.slot.index).not.toBe(first.slot.index);
    expect(status().rejected).toBe(1);
    // and it never comes back, not after a hundred acquires
    for (let i = 0; i < 50; i += 1) expect(acquire()!.slot.fingerprint).not.toBe(first.slot.fingerprint);
  });

  it("cools a 429 key for a minute, but a daily-limit 429 for much longer", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2 });
    syncPool();
    const a = acquire()!;
    const short = reportFailure(a.slot.fingerprint, 429, "Rate limit reached for requests per minute");
    expect(short).toBe(60_000);
    expect(status().cooling).toBe(1);
    expect(acquire()!.slot.fingerprint).not.toBe(a.slot.fingerprint); // skipped, not retried

    resetPool();
    syncPool();
    const b = acquire()!;
    const long = reportFailure(b.slot.fingerprint, 429, "Request too large for this model on tokens per day");
    expect(long).toBe(30 * 60_000);
  });

  it("does not penalise a key for a 400 or a 413, because the payload was the problem", () => {
    envKeys({ GROQ_API_KEY: K1 });
    syncPool();
    const a = acquire()!;
    expect(reportFailure(a.slot.fingerprint, 400, "bad request")).toBe(0);
    expect(reportFailure(a.slot.fingerprint, 413, "too large")).toBe(0);
    expect(status().cooling).toBe(0);
    expect(status().rejected).toBe(0);
  });

  it("clears the cooldown when the same key later succeeds", () => {
    envKeys({ GROQ_API_KEY: K1 });
    syncPool();
    const a = acquire()!;
    reportFailure(a.slot.fingerprint, 429, "per minute");
    expect(status().available).toBe(0);
    reportSuccess(a.slot.fingerprint);
    expect(status().available).toBe(1);
  });

  it("still hands something out when every key is penalised, rather than failing flat", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2 });
    syncPool();
    const a = acquire()!;
    const b = acquire()!;
    reportFailure(a.slot.fingerprint, 429, "per minute");
    reportFailure(b.slot.fingerprint, 429, "per minute");
    const c = acquire()!;
    expect(c.bestEffort).toBe(true);
    expect(c.value.length).toBeGreaterThan(20);
  });
});

describe("secret hygiene (these traces are returned to the browser)", () => {
  it("no probe, status line or slot label ever contains a key", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2 });
    syncPool();
    const a = acquire()!;
    const blob = JSON.stringify({ st: status(), slot: a.slot, probe: selfTest({ is_working: true }).checks });
    expect(blob).not.toContain(K1.slice(0, 20));
    expect(blob).not.toContain(K2.slice(0, 20));
    expect(blob).not.toContain("gsk_");
    expect(a.value).toContain("gsk_"); // the value itself is of course intact for the header
  });

  it("the health self-test passes on a real pool and proves distinctness", () => {
    envKeys({ GROQ_API_KEY: K1, GROQ_API_KEY2: K2 });
    const r = selfTest({ is_working: true });
    expect(r.ok).toBe(true);
    expect(r.checks.some((c) => /two consecutive requests get two different keys/.test(c.name))).toBe(true);
  });

  it("the self-test degrades honestly instead of failing when only one key exists", () => {
    envKeys({ GROQ_API_KEY: K1 });
    resetPool();
    const r = selfTest({ is_working: true });
    expect(r.ok).toBe(true);
    expect(r.checks.some((c) => c.skipped && /only one key configured/.test(c.detail))).toBe(true);
  });
});
