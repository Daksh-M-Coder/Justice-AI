/**
 * End-to-end over the analysis engine with a mocked Groq (plan step 40).
 * The model is replaced by a fetch stub, so these tests are deterministic, cost nothing
 * and still exercise: retrieval -> prompt -> schema validation -> retry -> citation guard
 * -> server-side precedents -> guidance enrichment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPool, status as poolStatus, syncPool } from "@/lib/keypool";
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
  (globalThis as unknown as { __authLog?: string[] }).__authLog = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
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
        logAuth(init);
        return groqReply(null, a.__status, a.__msg);
      }
      // record what the prompt looked like so we can assert on it
      logAuth(init);
      (globalThis as unknown as { __lastBody?: string }).__lastBody = init?.body ?? "";
      return groqReply(answer);
    }),
  );
});

/** Which Authorization values did this test actually send? Used to prove key rotation. */
function logAuth(init?: { headers?: Record<string, string> }) {
  const g = globalThis as unknown as { __authLog?: string[] };
  g.__authLog = g.__authLog ?? [];
  g.__authLog.push(String(init?.headers?.Authorization ?? ""));
}

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
    expect(r.checks.some((c) => /waited and retried once|every key was limited/.test(c.name))).toBe(true);
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

  it("removes an instruction that tells the user to pay, and replaces it", async () => {
    answers.push({
      verdict: "LikelyFraud",
      confidence: 0.9,
      red_flags: ["demand for payment to a personal UPI ID"],
      checks: [],
      what_to_do: [
        "Pay Rs 5000 to this UPI ID immediately to avoid the warrant",
        "Transfer the amount to the account given in the notice",
        "Call the officer on the number in the letter",
      ],
      law: "IT Act 66D",
    });
    const req = DetectRequestSchema.parse({ text: "URGENT pay Rs 5000 to this UPI ID or arrest warrant will be issued today" });
    const r = await detectNotice(req);
    const advice = r.data!.what_to_do;
    expect(advice.some((line) => /pay rs 5000|transfer the amount/i.test(line))).toBe(false);
    expect(advice[0]).toMatch(/do not pay anything/i);
    // a real step is kept, not blanked
    expect(advice.length).toBeGreaterThan(1);
    expect(r.checks.some((c) => /removed \d+ instruction that told the user to pay/.test(c.name))).toBe(true);
  });
});

describe("the self-test fixture is shaped like a real response (browser-testability)", () => {
  it("carries citations, the applicant and the subject instead of an empty shell", async () => {
    const req = AnalyzeRequestSchema.parse({
      problem: "copies of the file notes on my passport application",
      category: "RTI",
      lang: "en",
      city: "Pune",
      applicant: { name: "Ramesh Yadav", address: "12 Model Street", city: "Pune", state: "Maharashtra", pin: "411038", phone: "9876543210" },
    });
    const r = await analyzeCase(req, { is_working: true });
    expect(r.ok).toBe(true);
    const letter = r.data!.rti!.letter;
    // the old fixture was one static string: no name, no subject, no citations, so T2.10
    // could not be verified at all and the chip row read "0 sections used"
    expect(letter).toContain("Ramesh Yadav");
    expect(letter).toContain("9876543210");
    expect(letter).toContain("passport application");
    expect(letter).not.toContain("[Full Name]");
    expect(r.data!.citations.length).toBeGreaterThan(0);
    for (const c of r.data!.citations) {
      expect(c.source_url).toMatch(/^https?:\/\//);
      expect(typeof c.verified).toBe("boolean");
    }
  });

  it("fills the place and date in a complaint letter too", async () => {
    const req = AnalyzeRequestSchema.parse({ problem: "washing machine failed within warranty and the shop refuses a refund", category: "Consumer", lang: "en", city: "Nagpur" });
    const r = await analyzeCase(req, { is_working: true });
    expect(r.data!.analysis!.letter).toContain("Nagpur");
    expect(r.data!.analysis!.letter).not.toContain("[Place]");
  });
});

describe("key-pool rotation under real failure shapes", () => {
  const KA = "gsk_rotationtestkeyaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const KB = "gsk_rotationtestkeybbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function twoKeys() {
    process.env.GROQ_API_KEY = KA;
    process.env.GROQ_API_KEY2 = KB;
    delete process.env.GROQ_API_KEYS;
    resetPool();
    syncPool();
  }

  afterEach(() => {
    process.env.GROQ_API_KEY = "test-key-not-a-real-secret";
    delete process.env.GROQ_API_KEY2;
    resetPool();
  });

  it("a 429 on the first key continues on the second instead of failing the user", async () => {
    twoKeys();
    answers.push({ __status: 429, __msg: "Rate limit reached for model openai/gpt-oss-20b on tokens per minute. Please try again." });
    answers.push(validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "Defective washing machine, the shop in Pune refuses a refund", category: "Consumer", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok, r.error ?? "should have succeeded on the second key").toBe(true);
    const log = (globalThis as unknown as { __authLog?: string[] }).__authLog ?? [];
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(new Set(log).size).toBe(2); // two DIFFERENT Authorization headers were sent
    expect(log.join(" | ")).toContain(KA.slice(0, 12));
    expect(log.join(" | ")).toContain(KB.slice(0, 12));
    expect(r.checks.some((c) => /key pool: used key 2 of 2/.test(c.name))).toBe(true);
    expect(r.checks.some((c) => /2 key\(s\) tried/.test(c.detail))).toBe(true);
  });

  it("a 401 on the first key is not retried on it again, ever", async () => {
    twoKeys();
    answers.push({ __status: 401, __msg: "invalid api key" });
    answers.push(validAnalysis());
    const req = AnalyzeRequestSchema.parse({ problem: "Landlord refuses to return the security deposit in Pune", category: "Tenant / Housing", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok, r.error ?? "second key should answer").toBe(true);
    const after = poolStatus();
    expect(after.rejected).toBe(1);
    expect(after.available).toBe(1);
  });

  it("does not walk the pool for a payload error - it stops and reports it", async () => {
    twoKeys();
    answers.push({ __status: 413, __msg: "Request too large for model openai/gpt-oss-20b on tokens per minute" });
    const req = AnalyzeRequestSchema.parse({ problem: "Electricity connection has been pending for months", category: "General", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
    // one attempt only: rotating four keys over a 413 would burn the pool for nothing
    const log = (globalThis as unknown as { __authLog?: string[] }).__authLog ?? [];
    expect(log.length).toBe(1);
  });

  it("names the pool in the failure text when every key is spent", async () => {
    twoKeys();
    // two attempts inside the request budget, plus the one patience retry after the wait
    answers.push({ __status: 429, __msg: "on tokens per minute" });
    answers.push({ __status: 429, __msg: "on tokens per minute" });
    answers.push({ __status: 429, __msg: "on tokens per minute" });
    const req = AnalyzeRequestSchema.parse({ problem: "Bank refused to reverse an unauthorised UPI debit", category: "Banking / Fraud", lang: "en" });
    const r = await analyzeCase(req);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/all 2 groq keys/i);
  });
});
