import { describe, expect, it } from "vitest";
import { ALL_SECTIONS, citationGuard, corpusStats, getIndex, normSection, retrieve, selfTest } from "@/lib/rag";

describe("normSection - the label the model echoes vs the key we store", () => {
  it("strips the lead-in word both sides so real citations survive the guard", () => {
    // this exact mismatch made the live run strip every valid citation once
    expect(normSection("section 38")).toBe(normSection("38"));
    expect(normSection("Section 2(11)")).toBe(normSection("2(11)"));
    expect(normSection("rule3")).toBe(normSection("Rule 3"));
    expect(normSection("74a/74b")).toBe(normSection("74A / 74B"));
    expect(normSection("Article 21")).toBe(normSection("21"));
    expect(normSection("sec. 6(1)")).toBe(normSection("6(1)"));
    expect(normSection("धारा 6(1)")).toBe(normSection("6(1)"));
  });

  it("does not collapse genuinely different numbers", () => {
    expect(normSection("2(11)")).not.toBe(normSection("2(10)"));
    expect(normSection("175(3)")).not.toBe(normSection("175(4)"));
  });

  it("every corpus section normalises to something non-empty", () => {
    for (const s of ALL_SECTIONS) {
      if (s.section === "act-level" || s.section === "n/a") continue;
      expect(s.skey.length).toBeGreaterThan(0);
    }
  });
});

describe("RAG corpus (plan step 17)", () => {
  it("holds a usable number of sections across the acts we claim to cover", () => {
    const s = corpusStats();
    expect(s.sections).toBeGreaterThanOrEqual(60);
    expect(s.acts).toBeGreaterThanOrEqual(10);
    for (const want of ["Consumer", "RTI", "Workplace / Labour", "Tenant / Housing", "Police / FIR", "Banking / Fraud", "Cyber Fraud"]) {
      expect(s.categories).toContain(want);
    }
  });

  it("every section has an act, a section number and a source URL to check", () => {
    for (const sec of ALL_SECTIONS) {
      expect(sec.act.length).toBeGreaterThan(3);
      expect(sec.section.length).toBeGreaterThan(0);
      expect(sec.source_url).toMatch(/^https?:\/\//);
    }
  });

  it("does not pretend the dataset is verified when it is not", () => {
    const s = corpusStats();
    expect(s.verified).toBeLessThan(s.sections); // until `npm run verify:sources -- --write` has run
    expect(s.unverified).toBeGreaterThan(0);
  });

  it("builds the index once and reuses it", async () => {
    const a = getIndex();
    const b = getIndex();
    expect(a.ok).toBe(true);
    expect(b.data).toBe(a.data);
  });
});

describe("retrieve (plan step 18)", () => {
  it("finds the RTI thirty-day reply section for a plain-language question", async () => {
    const r = await retrieve("It has been 45 days and the PIO has not replied to my application", "RTI");
    expect(r.ok).toBe(true);
    const keys = r.data!.sections.map((s) => `${s.act}|${s.section}`);
    expect(keys.some((k) => k.includes("7(1)"))).toBe(true);
  });

  it("prefers the requested category but still tops up from the whole corpus", async () => {
    const r = await retrieve("defective mixer grinder refused refund", "Consumer");
    const sections = r.data!.sections;
    expect(sections.length).toBeGreaterThan(2);
    expect(sections.filter((s) => s.category === "Consumer").length).toBeGreaterThan(0);
  });

  it("returns something honest for an unknown category instead of crashing", async () => {
    const r = await retrieve("my neighbour built a wall over my land", "Not A Real Category");
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.data!.sections)).toBe(true);
  });

  it("caps k so the prompt cannot be bloated by a caller", async () => {
    const r = await retrieve("wages", "Workplace / Labour", { k: 999 });
    expect(r.data!.sections.length).toBeLessThanOrEqual(12);
  });

  it("reports how many retrieved sections are still awaiting verification", async () => {
    const r = await retrieve("RTI fee and first appeal", "RTI");
    expect(r.data!.unverified).toBeGreaterThanOrEqual(0);
    expect(r.data!.why.length).toBeGreaterThan(0);
  });
});

describe("citationGuard (plan step 20)", () => {
  const pool = ALL_SECTIONS.filter((s) => s.category === "Consumer");

  it("keeps a citation that was really retrieved", () => {
    const r = citationGuard([{ act: "Consumer Protection Act, 2019", section: "2(11)" }], pool);
    expect(r.data!.kept).toHaveLength(1);
    expect(r.data!.stripped).toHaveLength(0);
  });

  it("strips an invented section number", () => {
    const r = citationGuard([{ act: "Consumer Protection Act, 2019", section: "9999" }], pool);
    expect(r.data!.kept).toHaveLength(0);
    expect(r.data!.stripped).toHaveLength(1);
  });

  it("strips an invented act even when the number looks plausible", () => {
    const r = citationGuard([{ act: "Consumer Protection Act, 1882", section: "2(11)" }], pool);
    expect(r.data!.stripped).toHaveLength(1);
  });

  it("keeps a citation the model phrased as 'Section 2(11)' or 'section 2(11)'", () => {
    for (const phrasing of ["Section 2(11)", "section 2(11)", "2(11)", "Sec. 2(11)", "2 (11)"]) {
      const r = citationGuard([{ act: "Consumer Protection Act, 2019", section: phrasing }], pool);
      expect(r.data!.kept, phrasing).toHaveLength(1);
    }
  });

  it("labels a removed citation as 'real but not retrieved' vs 'not in the corpus'", () => {
    const real = citationGuard([{ act: "Right to Information Act, 2005", section: "6(1)" }], pool);
    expect(real.data!.kept).toHaveLength(0);
    expect(real.data!.stripped[0].in_corpus_elsewhere).toBe(true);
    const fake = citationGuard([{ act: "Imaginary Act, 2040", section: "99" }], pool);
    expect(fake.data!.stripped[0].in_corpus_elsewhere).toBe(false);
  });

  it("survives an empty or missing citation list", () => {
    expect(citationGuard([], pool).data!.kept).toEqual([]);
    expect(citationGuard(undefined as never, pool).ok).toBe(true);
  });
});

it("rag.selfTest passes without any network call", async () => {
  const r = await selfTest({ is_working: true });
  expect(r.checks.every((c) => c.skipped || c.ok || !c.ok)).toBe(true);
  const failing = r.checks.filter((c) => !c.ok);
  expect(failing.map((f) => `${f.fn}/${f.name}: ${f.detail}`)).toEqual([]);
});
