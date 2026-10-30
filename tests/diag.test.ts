import { describe, expect, it } from "vitest";
import { Probe, summarize, track, type WorkResult } from "@/lib/diag";

describe("is_working envelope (the convention every function follows)", () => {
  it("normal mode reports the checks it made", async () => {
    const p = track<number>("unit.normal");
    p.check("input present", true);
    const r = p.done(42);
    expect(r.ok).toBe(true);
    expect(r.data).toBe(42);
    expect(r.checks).toHaveLength(1);
    expect(r.is_working).toBe(false);
  });

  it("a failing check makes the result not-ok even without an error", () => {
    const p = track<number>("unit.fail");
    p.check("quota available", false, "0 left today");
    const r = p.done(1);
    expect(r.ok).toBe(false);
    expect(r.checks[0].ok).toBe(false);
    expect(r.data).toBe(1); // the value is still returned; the caller decides what to do
  });

  it("self-test mode short-circuits side effects and labels them skipped", () => {
    const p = track<string>("unit.working", { is_working: true });
    expect(p.working).toBe(true);
    const r = p.fixture("fixture-value", "no email sent");
    expect(r.is_working).toBe(true);
    expect(r.data).toBe("fixture-value");
    expect(r.checks.some((c) => c.skipped)).toBe(true);
  });

  it("caught() records the throw and clears the data", () => {
    const p = track<number>("unit.throws");
    const r = p.caught(new Error("boom"));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
    expect(r.data).toBeNull();
  });

  it("attach() merges child checks and propagates a child failure", () => {
    const parent = track<string>("parent");
    const child: WorkResult<number> = { ok: false, data: null, checks: [{ fn: "kid", name: "x", ok: false, detail: "nope", ms: 1, skipped: false }], error: "kid failed", is_working: false };
    const v = parent.attach(child, "kid");
    expect(v).toBeNull();
    const r = parent.done(null);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("kid failed");
    expect(r.checks[0].fn).toBe("parent:kid");
  });

  it("summarize() flattens a fleet of results", () => {
    const pa = new Probe<number>("a");
    pa.check("one", true);
    const pb = new Probe<number>("b");
    pb.check("two", false, "bad");
    const s = summarize([pa.done(1), pb.done(2)]);
    expect(s.total).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.ok).toBe(false);
    expect(s.failing[0].fn).toBe("b");
  });
});
