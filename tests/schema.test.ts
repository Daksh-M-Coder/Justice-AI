import { describe, expect, it } from "vitest";
import {
  AnalysisSchema,
  AnalyzeRequestSchema,
  DetectRequestSchema,
  RtiLetterSchema,
  extractJson,
  parseWith,
  isParseError,
} from "@/lib/schema";
import { FIXTURE_ANALYSIS } from "@/lib/prompts";

describe("extractJson - models wrap JSON in prose and fences", () => {
  it("strips a fenced block", () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("takes the outer object from surrounding prose", () => {
    expect(extractJson('noise {"a":{"b":2}} more noise')).toBe('{"a":{"b":2}}');
  });
  it("leaves a bare object alone", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
});

describe("AnalysisSchema - the single response contract", () => {
  it("accepts the canonical fixture", () => {
    const r = AnalysisSchema.safeParse(FIXTURE_ANALYSIS);
    expect(r.success).toBe(true);
  });

  it("normalises 'Med' and lowercase urgency instead of failing the user's case", () => {
    const r = AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, urgency: "med" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.urgency).toBe("Medium");
  });

  it("accepts an array of rights and flattens it to text only where the contract wants a string", () => {
    const r = AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, rights: ["a", "b", "c"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rights.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects a missing authority (that is the retry trigger, not a warning)", () => {
    const bad = { ...FIXTURE_ANALYSIS } as Record<string, unknown>;
    delete bad.authority;
    expect(AnalysisSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a letter that is too short to be filed", () => {
    expect(AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, letter: "To sir, please help." }).success).toBe(false);
  });

  it("drops unknown keys instead of 500-ing the user's analysis", () => {
    const r = AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, hallucinated_extra: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).hallucinated_extra).toBeUndefined();
  });

  it("survives limitation_days coming back as a string or prose (live gpt-oss bug)", () => {
    for (const value of [730, "730", "2 years", "Rs 1,500", undefined, null, ""] as const) {
      const r = AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, limitation_days: value });
      expect(r.success, JSON.stringify(value)).toBe(true);
    }
    const num = AnalysisSchema.parse({ ...FIXTURE_ANALYSIS, limitation_days: "730" });
    expect(num.limitation_days).toBe(730);
    const prose = AnalysisSchema.parse({ ...FIXTURE_ANALYSIS, limitation_days: "about 2 years" });
    expect(prose.limitation_days).toBe(2);
    const none = AnalysisSchema.parse({ ...FIXTURE_ANALYSIS, limitation_days: "soon" });
    expect(none.limitation_days).toBeUndefined();
  });

  it("drops empty placeholder citations instead of failing the whole answer (live HI RTI bug)", () => {
    const r = AnalysisSchema.safeParse({
      ...FIXTURE_ANALYSIS,
      citations: [{ act: "", section: "" }, { act: "Consumer Protection Act, 2019", section: "2(11)" }, null, "junk"],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.citations.map((c) => c.section)).toEqual(["2(11)"]);
  });

  it("accepts an answer whose citation array is entirely garbage, with no citations", () => {
    const r = RtiLetterSchema.safeParse({ letter: "x".repeat(200), citations: [{ act: "", section: "" }], review: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.citations).toEqual([]);
  });

  it("tolerates 'steps' with one entry but demands at least one", () => {
    expect(AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, steps: [{ title: "Write", desc: "Send it by post" }] }).success).toBe(true);
    expect(AnalysisSchema.safeParse({ ...FIXTURE_ANALYSIS, steps: [] }).success).toBe(false);
  });
});

describe("parseWith + isParseError - the retry path", () => {
  it("returns a parseError string, never throws", () => {
    const r = parseWith(AnalysisSchema, "I cannot produce JSON");
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) expect(r.parseError.length).toBeGreaterThan(0);
  });

  it("parses a valid fenced answer", () => {
    const r = parseWith(RtiLetterSchema, JSON.stringify({ letter: "x".repeat(200), citations: [], review: ["check the address"] }));
    expect(isParseError(r)).toBe(false);
  });
});

describe("request schemas - the trust boundary for inputs", () => {
  it("requires a real problem statement", () => {
    expect(AnalyzeRequestSchema.safeParse({ problem: "short" }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ problem: "The shop refused to replace my defective mixer grinder" }).success).toBe(true);
  });

  it("applies defaults so a minimal client call still validates", () => {
    const r = AnalyzeRequestSchema.parse({ problem: "My landlord cut the electricity supply to force me out" });
    expect(r.lang).toBe("en");
    expect(r.is_working).toBe(false);
  });

  it("normalises a category with different casing", () => {
    const r = AnalyzeRequestSchema.parse({ problem: "Bank debited my account twice for one UPI payment", category: "consumer" });
    expect(r.category).toBe("Consumer");
  });

  it("refuses an oversized base64 image before the model ever sees it", () => {
    const r = AnalyzeRequestSchema.safeParse({ problem: "x".repeat(20), imageBase64: "data:image/png;base64," + "A".repeat(3_000_000) });
    expect(r.success).toBe(false);
  });

  it("detect request needs either text or a photo", () => {
    expect(DetectRequestSchema.safeParse({}).success).toBe(false);
    expect(DetectRequestSchema.safeParse({ text: "Notice from the income tax department demanding payment to a UPI id" }).success).toBe(true);
  });
});
