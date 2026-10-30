/**
 * End-to-end over the analysis engine with a mocked Groq (plan step 40).
 * The model is replaced by a fetch stub, so these tests are deterministic, cost nothing
 * and still exercise: retrieval -> prompt -> schema validation -> retry -> citation guard
 * -> server-side precedents -> guidance enrichment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeCase, detectNotice, sanitizeContact, validateImage } from "@/lib/analyze";
import { AnalyzeRequestSchema, DetectRequestSchema, type Analysis } from "@/lib/schema";
import { FIXTURE_ANALYSIS } from "@/lib/prompts";

const GROQ = "https://api.groq.com/openai/v1";

function groqReply(content: unknown, status = 200, errorMessage?: string) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 800 }, model: "llama-3.3-70b-versatile" }
        : { error: { message: errorMessage ?? "model overloaded" } },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
}

let answers: unknown[] = [];

beforeEach(() => {
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const called = url.startsWith(GROQ);
      expect(called).toBe(true);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant" }] }), { status: 200 });
      }
      const answer = answers.shift() ?? { error: "no stubbed answer" };
      if (typeof answer === "object" && answer !== null && "__json" in (answer as object)) {
        const a = answer as { __json: string; __finish?: string };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: a.__json }, finish_reason: a.__finish ?? "stop" }], usage: { prompt_tokens: 900, completion_tokens: 800 }, model: "llama-3.3-70b-versatile" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (typeof answer === "object" && answer !== null && "__status" in (answer as object)) {
        const a = answer as { __status: number; __msg?: string };
        return groqReply(null, a.__status, a.__msg);
      }
      // record what the prompt looked like so we can assert on it
      (globalThis as unknown as { __lastBody?: string }).__lastBody = init?.body ?? "";
      return groqReply(answer);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const validAnalysis = (): Analysis => ({
  ...FIXTURE_ANALYSIS,
  letter: FIXTURE_ANALYSIS.letter, // already long enough to pass the 80-char floor
  citations: [
    { act: "Consumer Protection Act, 2019", section: "2(11)", title: "deficiency" },
    { act: "Consumer Protection Act, 2019", section: "9999", title: "invented by the model" },
    { act: "Quantum Telecom Act, 2031", section: "1", title: "invented act" },
  ],
  precedents: [{ title: "Fabricated v. Nobody (2024)", court: "X", year: 2024, citation: "c", holding: "h", url: "" }],
});

describe("analyzeCase against a mocked model", () => {
  it("turns a good answer into a full, safe response", async () => {
    answers.push(validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "The shop delivered a washing machine with a dead motor and refuses to replace it", category: "Consumer", lang: "en", city: "Pune" });
    const r = await analyzeCase(req);

    expect(r.ok).toBe(true);
    expect(r.data!.kind).toBe("analysis");
    expect(r.data!.analysis!.letter).toContain("Subject");
    expect(r.data!.disclaimer).toMatch(/not legal advice/i);
    expect(r.data!.meta.model).toBe("llama-3.3-70b-versatile");
    expect(r.data!.meta.retrieval.count).toBeGreaterThan(0);
    expect(r.data!.guidance.deadlines.length).toBeGreaterThan(0);
    expect(r.data!.guidance.review.length).toBeGreaterThan(5);
  });

  it("never shows a citation the retrieval did not provide (plan step 20)", async () => {
    answers.push(validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "Defective goods sold online, refund refused by the marketplace seller", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    const shown = r.data!.citations.map((c) => c.section);
    expect(shown).not.toContain("9999");
    expect(r.data!.strippedCitations.length).toBeGreaterThanOrEqual(1);
    expect(r.data!.meta.warnings.join(" ")).toMatch(/removed because they were not part of the verified text/i);
  });

  it("discards model-supplied precedents and uses only the verified dataset (plan steps 22-25)", async () => {
    answers.push(validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "My builder is three years late handing over the flat", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    expect(JSON.stringify(r.data!.analysis!.precedents)).not.toMatch(/Fabricated v. Nobody/);
    expect(r.data!.precedents.label).toMatch(/Similar published cases/i);
    expect(r.data!.precedents.label).not.toMatch(/chance of winning/i);
  });

  it("canonicalises the model's section wording and de-duplicates (live '§Section 38' bug)", async () => {
    const a = validAnalysis();
    a.citations = [
      { act: "Consumer Protection Act, 2019", section: "Section 2(11)" },
      { act: "Consumer Protection Act, 2019", section: "2(11)" },
      { act: "Consumer Protection Act 2019", section: "sec. 2(11)", title: "deficiency" },
    ];
    answers.push(a);
    const req = AnalyzeRequestSchema.parse({ problem: "Defective washing machine, refund refused by the shop in Pune", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    const secs = r.data!.citations.map((c) => c.section);
    expect(secs, "model wording must never reach the UI").not.toContain("Section 2(11)");
    expect(new Set(secs).size, "the same section echoed three times shows once").toBe(secs.length);
    for (const c of r.data!.citations) {
      expect(c.section).toBe("2(11)");
      expect(c.source_url).toMatch(/^https/);
      expect(c.act).toBe("Consumer Protection Act, 2019");
    }
  });

  it("retries exactly once when the JSON fails the schema, and succeeds", async () => {
    answers.push("this is not json at all", validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "Airline cancelled my flight and refused a refund under the consumer act", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(true);
    expect(r.checks.some((c) => /model returned invalid JSON, repairing/.test(c.name))).toBe(true);
    const calls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).endsWith("/chat/completions"));
    expect(calls.length).toBe(2);
  });

  it("returns a clean error (not a half-baked object) when the retry also fails", async () => {
    answers.push("{ bad", "{ still bad");
    const req = AnalyzeRequestSchema.parse({ problem: "Insurance claim rejected without any reason given", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/did not match the legal-response schema|could not be validated/i);
    // the message must name the schema paths that failed, or the operator cannot fix it
    expect(r.error ?? "").toMatch(/last errors:.*[a-z]+\./i);
  });

  it("surfaces an upstream outage as an honest message, after one bounded retry", async () => {
    answers.push({ __status: 429 });
    const req = AnalyzeRequestSchema.parse({ problem: "Electricity connection application has been pending for months", category: "General", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rate-limited|try again/i);
    // the client retried the throttled call once instead of failing the user immediately
    expect(r.checks.some((c) => /transient upstream limit, retried once/.test(c.name))).toBe(true);
    expect(r.checks.some((c) => /retried once/.test(c.name) && c.ok)).toBe(true);
  });

  it("falls back to plain JSON when Groq rejects the JSON mode (live json_validate_failed bug)", async () => {
    // gpt-oss-20b sometimes returns an empty completion in json_object mode, which Groq
    // reports as a 400 - the answer must still arrive, and the model must be remembered
    answers.push({ __status: 400, __msg: 'Failed to validate JSON. See \'failed_generation\' for more details. code: "json_validate_failed", failed_generation: ""' }, validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "Bank debited my account twice for one UPI payment and refuses to reverse it", category: "Banking / Fraud", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok, r.error).toBe(true);
    expect(r.checks.some((c) => /retried as plain JSON/.test(c.name))).toBe(true);
    expect(r.data!.analysis!.letter.length).toBeGreaterThan(80);
  });

  it("spaceParagraphs promotes single line breaks when a letter has no blank lines", async () => {
    const { spaceParagraphs } = await import("@/lib/analyze");
    const single = "To\nThe PIO\nOffice\nSubject: x\nBody one\nBody two";
    expect(spaceParagraphs(single).split("\n\n").length).toBe(6);
    const already = "To\nThe PIO\n\nSubject: x\n\nBody";
    expect(spaceParagraphs(already)).toBe(already);
    expect(spaceParagraphs(undefined)).toBe("");
    expect(spaceParagraphs("short one-liner")).toBe("short one-liner");
  });

  it("calls a cut-off answer a size problem, not a schema problem (live truncation bug)", async () => {
    const cut = { __json: '{ "authority": "District Commission", "law": "Consumer Protection Act, 2019", "le', __finish: "length" };
    answers.push(cut, { ...cut }, { ...cut }, { ...cut });
    const req = AnalyzeRequestSchema.parse({ problem: "Builder delayed possession of my flat by three years and refuses interest", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/cut off before it finished/i);
    expect(r.error).not.toMatch(/did not match the legal-response schema/);
    // the client must have asked for a bigger window before giving up
    expect(r.checks.some((c) => /retrying with more room/.test(c.name))).toBe(true);
    expect(r.checks.some((c) => /truncated by the token limit/.test(c.name))).toBe(true);
  });

  it("drives the RTI pipeline through its own schema", async () => {
    answers.push({
      letter: "To\nThe Public Information Officer\n[Office]\n\nSubject: Information under Section 6(1) of the RTI Act, 2005\n\nSir/Madam,\n\n1. Please state the date on which the application was received.\n2. Please provide the file notings.\n\nYours faithfully,\n[Name]",
      citations: [{ act: "Right to Information Act, 2005", section: "6(1)" }],
      review: ["Confirm the public authority is the correct one", "Attach the fee receipt"],
    });
    const req = AnalyzeRequestSchema.parse({ problem: "I want the status of my passport application and the name of the officer holding it", category: "RTI", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(true);
    expect(r.data!.kind).toBe("rti");
    expect(r.data!.rti!.letter).toContain("Section 6(1)");
    expect(r.data!.analysis).toBeNull();
  });

  it("in self-test mode spends nothing and says so", async () => {
    const req = AnalyzeRequestSchema.parse({ problem: "Probe case for the is_working path", category: "Consumer", lang: "en", is_working: true });
    const r = await analyzeCase(req, { is_working: true });
    const calls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).endsWith("/chat/completions"));
    expect(calls.length).toBe(0);
    expect(r.is_working).toBe(true);
    expect(r.checks.some((c) => c.skipped)).toBe(true);
  });
});

describe("guards around the model call", () => {
  it("rejects a PDF pretending to be an image, and an oversized photo", () => {
    expect(validateImage("data:application/pdf;base64,AAAA").ok).toBe(false);
    const huge = "data:image/png;base64," + "A".repeat(2_400_000);
    expect(validateImage(huge).ok).toBe(false);
    const small = "data:image/jpeg;base64," + "A".repeat(400);
    expect(validateImage(small).ok).toBe(true);
    expect(validateImage(undefined).ok).toBe(true);
  });

  it("removes a non-official link the model invented, keeps a .gov.in one", () => {
    const bad = sanitizeContact({ designation: "Officer", department: "X", email_or_link: "https://phish.example.com/claim" });
    expect(bad.data!.email_or_link).toBe("N/A");
    const email = sanitizeContact({ designation: "Officer", department: "X", email_or_link: "somebody@example.com" });
    expect(email.data!.email_or_link).toBe("N/A");
    const good = sanitizeContact({ designation: "PIO", department: "Passport Seva", email_or_link: "https://rtionline.gov.in/" });
    expect(good.data!.email_or_link).toBe("https://rtionline.gov.in/");
  });

  it("detects a scam notice via the fast model slot", async () => {
    answers.push({
      verdict: "LikelyFraud",
      confidence: 0.8,
      red_flags: ["asks for payment to a personal UPI id", "no reference number", "threatens immediate arrest"],
      checks: [{ claim: "issued by the Income Tax Department", status: "mismatch", note: "no DIN or assessment year" }],
      what_to_do: ["Call the department's published helpline", "Visit the local office with the notice"],
      law: "",
    });
    const req = DetectRequestSchema.parse({ text: "Dear customer, your PAN is misused. Pay Rs 5000 to this UPI within 2 hours or police will arrest you today. - Income Tax Department" });
    const r = await detectNotice(req);
    expect(r.ok).toBe(true);
    expect(r.data!.verdict).toBe("LikelyFraud");
    const body = (globalThis as unknown as { __lastBody: string }).__lastBody;
    expect(body).toContain("llama-3.1-8b-instant");
  });

  it("refuses an empty detection request before spending anything", async () => {
    const parsed = DetectRequestSchema.safeParse({ text: "" });
    expect(parsed.success).toBe(false);
  });
});
