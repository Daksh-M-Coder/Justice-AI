import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, consume, peek, selfTest } from "@/lib/ratelimit";

describe("quotas and rate limiting (plan steps 11 + 14)", () => {
  it("lets a guest through the configured free allowance and then blocks", () => {
    const ip = `ip-${Math.random().toString(36).slice(2)}`;
    const limit = Number(process.env.GUEST_MAX_ANALYSES_PER_DAY);
    for (let i = 0; i < limit; i += 1) {
      const r = consume("guest_analyze", ip);
      expect(r.data!.allowed).toBe(true);
      expect(r.data!.remaining).toBe(limit - i - 1);
    }
    const blocked = consume("guest_analyze", ip);
    expect(blocked.data!.allowed).toBe(false);
    expect(blocked.data!.remaining).toBe(0);
    expect(blocked.checks.some((c) => !c.ok)).toBe(true); // the block is a visible failing check
  });

  it("keeps signed-in users on a different bucket than guests", () => {
    const tag = Math.random().toString(36).slice(2);
    const g = consume("guest_analyze", `ip:${tag}`);
    const u = consume("user_analyze", `uid:${tag}`);
    expect(g.data!.allowed).toBe(true);
    expect(u.data!.allowed).toBe(true);
    expect(u.data!.limit).toBe(Number(process.env.USER_MAX_ANALYSES_PER_DAY));
  });

  it("brake-bursts a caller who sends too many requests in a minute", () => {
    const tag = `burst-${Math.random().toString(36).slice(2)}`;
    let blocked = false;
    for (let i = 0; i < 30; i += 1) {
      const r = consume("burst", tag);
      if (!r.data!.allowed) blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("does not let a health probe eat the user's daily allowance", () => {
    const tag = `probe-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 5; i += 1) consume("user_analyze", tag, { is_working: true });
    const real = peek("user_analyze", tag);
    expect(real.data!.used).toBe(0);
    expect(real.data!.allowed).toBe(true);
  });

  it("uses the first hop of x-forwarded-for, never the whole chain", () => {
    const req = new Request("http://localhost/api", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientIp(req)).toBe("1.2.3.4");
    expect(clientIp(new Request("http://localhost/api"))).toBe("unknown-ip");
  });

  it("self-test passes", async () => {
    const r = await selfTest({ is_working: true });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe("identity (plan step 11)", () => {
  beforeEach(() => expect(true).toBe(true));

  it("a request with no Authorization header is a guest", async () => {
    const { identify } = await import("@/lib/identity");
    const r = await identify(new Request("http://localhost/api/analyze", { headers: { "x-forwarded-for": "9.9.9.9" } }));
    expect(r.data!.kind).toBe("guest");
    expect(r.data!.quotaKey).toBe("ip:9.9.9.9");
  });

  it("a bad bearer token is an error, never a silent downgrade to guest", async () => {
    const { identify } = await import("@/lib/identity");
    const r = await identify(new Request("http://localhost/api/analyze", { headers: { authorization: "Bearer not-a-real-jwt" } }));
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
  });

  it("requireUser refuses guests with a sign-in message", async () => {
    const { requireUser } = await import("@/lib/identity");
    const r = await requireUser(new Request("http://localhost/api/cases"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sign in/i);
  });
});
