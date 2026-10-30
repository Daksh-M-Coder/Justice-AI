/**
 * The analysis engine. A route should stay thin: identify -> quota -> analyzeCase -> respond.
 *
 * Everything the model returns is treated as untrusted until it has been
 * (a) validated against the zod schema, (b) had invented citations stripped, and
 * (c) had its contact details sanitised against the official-domain list.
 */
import { track, type Opts, type WorkResult } from "./diag";
import { chatJson, resolveVisionModel, type ChatTurn } from "./groq";
import {
  ANALYSIS_KEYS,
  DISCLAIMER,
  FIXTURE_ANALYSIS,
  FIXTURE_RTI,
  analysisSystem,
  analysisUser,
  detectSystem,
  detectUser,
  repairUser,
  rtiSystem,
  rtiUser,
} from "./prompts";
import { ALL_SECTIONS, citationGuard, normSection, retrieve, type Section } from "./rag";
import { normAct } from "./prompts";
import { precedentsFor, type PrecedentSet } from "./precedents";
import { computeDeadlines, guidanceFor, LETTER_REVIEW_CHECKLIST, DIRECTORIES, type Countdown, type EscalationStep } from "./guidance";
import {
  AnalysisSchema,
  DetectionSchema,
  RtiLetterSchema,
  type Analysis,
  type AnalyzeRequest,
  type Category,
  type Citation,
  type DetectRequest,
  type Detection,
  type RtiLetter,
} from "./schema";

export interface EnrichedCitation extends Citation {
  verified: boolean;
  source_url: string;
  note: string;
  /** true for corpus entries that cite a whole Act rather than a numbered section */
  act_level?: boolean;
}

export interface AnalyzeResponse {
  kind: "analysis" | "rti";
  analysis: Analysis | null;
  rti: RtiLetter | null;
  citations: EnrichedCitation[];
  strippedCitations: (Citation & { in_corpus_elsewhere?: boolean })[];
  precedents: PrecedentSet;
  guidance: { deadlines: Countdown[]; checklist: string[]; escalation: EscalationStep[]; review: string[] };
  legalAid: { name: string; url: string; use: string; status: string }[];
  meta: {
    model: string;
    warnings: string[];
    retrieval: { count: number; unverified: number; why: string };
    imageUsed: boolean;
    durationMs: number;
    tokens?: { prompt?: number; completion?: number };
  };
  disclaimer: string;
}

/* ── image handling (plan step 10) ───────────────────────────────────────── */

const OK_MIME = ["image/jpeg", "image/png", "image/webp"];

export function validateImage(
  dataUrl: string | undefined,
  opts: Opts = {},
): WorkResult<{ mime: string; bytes: number } | null> {
  const p = track<{ mime: string; bytes: number } | null>("analyze.validateImage", opts);
  if (!dataUrl) {
    p.check("no image supplied", true);
    return p.done(null);
  }
  const m = /^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  p.check("data URL is a base64 image (jpeg/png/webp)", !!m, m ? "ok" : "expected data:image/(jpeg|png|webp);base64,... - anything else is rejected");
  if (!m) return p.done(null, "The photo was not a readable image. Try a JPG, PNG or WebP under the size limit.");
  const mime = m[1];
  const bytes = Math.floor((m[2].length * 3) / 4);
  const max = Number(process.env.MAX_IMAGE_BYTES ?? 1_500_000);
  p.check(`decoded size ${Math.round(bytes / 1024)} KB within ${Math.round(max / 1024)} KB`, bytes <= max);
  p.check(`mime "${mime}" allowed`, OK_MIME.includes(mime) ? mime : `rejected: ${mime}`);
  if (bytes > max) return p.done(null, `The image is too large (${Math.round(bytes / 1024)} KB). Limit is ${Math.round(max / 1024)} KB - use the in-app compression or retake the photo.`);
  if (!OK_MIME.includes(mime)) return p.done(null, `Unsupported image type ${mime}. Use JPG, PNG or WebP.`);
  return p.done({ mime, bytes });
}

/* ── contact sanitisation ────────────────────────────────────────────────── */

const OFFICIAL_TLD = /\.(gov\.in|nic\.in|ac\.in|nlsahq\.org|lawmin\.nic\.in)$/i;

export function sanitizeContact(
  contact: Analysis["contact"],
  opts: Opts = {},
): WorkResult<{ designation: string; department: string; email_or_link: string; note: string }> {
  const p = track<{ designation: string; department: string; email_or_link: string; note: string }>("analyze.sanitizeContact", opts);
  let value = (contact.email_or_link ?? "").trim();
  let note = "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const host = new URL(value).hostname;
      if (OFFICIAL_TLD.test(host)) p.check("official domain kept", true, host);
      else {
        p.check("guard fired: non-official link removed", true, `${host} → N/A`);
        value = "N/A";
        note = "The AI suggested a link we cannot verify as an official government domain, so it was removed.";
      }
    } catch {
      p.check("guard fired: malformed link removed", true, value.slice(0, 40));
      value = "N/A";
      note = "The AI produced a malformed link; it was removed.";
    }
  } else if (value && value !== "N/A") {
    // emails and phone numbers: we have no verified directory, so they never pass
    p.check("guard fired: unverifiable contact string removed", true, `${value.slice(0, 24)} → N/A`);
    value = "N/A";
    note = "Do not use an email or phone the assistant could not verify. Look up the office on your state's directory instead.";
  } else {
    p.check("contact was already N/A", true);
    value = "N/A";
  }
  return p.done({ designation: contact.designation, department: contact.department, email_or_link: value, note });
}

/**
 * Replace whatever string the model echoed with the corpus' own label, act name and source URL.
 * The model writes "Section 38" or "rule3" because that is how it saw the list rendered; showing
 * the user "§Section 38" (or a section we cannot link) would be sloppy, and a citation whose act
 * is misremembered would be worse. Unknown sections are passed through untouched so the guard's
 * removal still applies to them.
 */
function enrich(citations: Citation[], pool: Section[]): EnrichedCitation[] {
  const out: EnrichedCitation[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    const key = normSection(c.section);
    const hit = [...pool, ...ALL_SECTIONS].find(
      (s) => s.skey === key && (normAct(s.act) === normAct(c.act) || normAct(s.act).includes(normAct(c.act)) || normAct(c.act).includes(normAct(s.act))),
    );
    const act = hit?.act ?? c.act;
    const section = hit?.section ?? c.section;
    const dedupe = `${normAct(act)}||${section.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      ...c,
      act,
      section,
      act_level: !/[0-9]/.test(section),
      title: c.title?.trim() ? c.title : hit?.title,
      verified: hit?.verified ?? false,
      source_url: hit?.source_url ?? "",
      note: hit?.note ?? (hit ? "" : "not found in the retrieved corpus"),
    });
  }
  return out;
}

/**
 * The letter contract asks for body paragraphs separated by a blank line; gpt-oss-20b
 * sometimes uses single newlines, which prints as one grey wall of text in the UI and in
 * the PDF. If there is no blank line at all but plenty of line breaks, promote them - a
 * display fix only, never a change to the words.
 */
export function spaceParagraphs(text: string | undefined, opts: Opts = {}): string {
  const p = track<string>("analyze.spaceParagraphs", opts);
  if (!text) return "";
  const hasBlankLine = /\n[ \t]*\n/.test(text);
  const lineBreaks = (text.match(/\n/g) ?? []).length;
  if (!hasBlankLine && lineBreaks >= 5) {
    p.check("letter had no blank lines; paragraphs promoted", true, `${lineBreaks} line breaks`);
    return text.replace(/\n/g, "\n\n");
  }
  p.check("letter paragraph structure ok", true, hasBlankLine ? "blank lines present" : "short letter");
  return text;
}

/* ── the two model pipelines ─────────────────────────────────────────────── */

export async function analyzeCase(req: AnalyzeRequest, opts: Opts = {}): Promise<WorkResult<AnalyzeResponse>> {
  const p = track<AnalyzeResponse>("analyze.analyzeCase", opts);
  const startedAt = Date.now();
  const warnings: string[] = [];
  const isRti = req.category === "RTI";
  p.check(`category "${req.category}" recognised`, true, isRti ? "RTI letter pipeline" : "full analysis pipeline");

  const img = validateImage(req.imageBase64, opts);
  if (!img.ok && req.imageBase64) return p.done(null, img.error ?? "image rejected");
  const category = (req.category || "General") as Category;
  const retrieved = await retrieve(req.problem + " " + category, category, opts);
  const sections = p.attach(retrieved, "retrieve")?.sections ?? [];
  p.check(`context has ${sections.length} section(s)`, sections.length > 0 ? sections.map((s) => s.section).join(", ").slice(0, 120) : "empty context - the model will be told to say it is unsure");

  let imageUsed = false;
  if (req.imageBase64) {
    const v = await resolveVisionModel(opts);
    const vision = p.attach(v, "resolveVisionModel");
    if (vision) {
      imageUsed = true;
      p.check("vision model active, photo will be read", true, vision);
    } else {
      warnings.push("Your photo could not be read: this Groq account has no active vision model, so only the text you typed was analysed. Add GROQ_VISION_MODEL or describe the document.");
    }
  }
  // Build the request from whatever slice of the retrieved context still fits. A small shared
  // Groq key has a tokens-per-minute allowance smaller than an unbounded corpus dump (observed
  // live: an 8,334-token prompt against a limit of 8,000 TPM => HTTP 413), so we measure first
  // and drop the lowest-ranked sections until the prompt fits, instead of failing the user.
  const budgetTokens = Number(process.env.GROQ_PROMPT_TOKEN_BUDGET ?? 3600) || 3600;
  // ~3.2 chars/token: conservative for English and deliberately pessimistic for Devanagari
  const estTokens = (s: string) => Math.ceil(s.length / 3.2);
  const buildMessages = (chosen: Section[]): { messages: ChatTurn[]; schema: typeof AnalysisSchema | typeof RtiLetterSchema } => {
    const bodyText = isRti ? rtiUserBody(req, category, chosen) : analysisUser({ problem: req.problem, lang: req.lang, category, city: req.city, sections: chosen });
    const content: ChatTurn["content"] =
      imageUsed && req.imageBase64 ? [{ type: "text", text: bodyText }, { type: "image_url", image_url: { url: req.imageBase64 } }] : bodyText;
    const system = isRti ? rtiSystem({ lang: req.lang, sections: chosen }) : analysisSystem({ lang: req.lang, sections: chosen });
    return { messages: [{ role: "system", content: system }, { role: "user", content }], schema: isRti ? RtiLetterSchema : AnalysisSchema };
  };

  // Trim from the bottom of the ranking until the request fits the account's allowance.
  // Two sections are the floor: below that the answer has no statutory footing at all.
  let chosen = sections;
  let built = buildMessages(chosen);
  let promptTokens = estTokens(JSON.stringify(built.messages));
  let trimmed = 0;
  while (promptTokens > budgetTokens && chosen.length > 2) {
    chosen = chosen.slice(0, -1);
    trimmed += 1;
    built = buildMessages(chosen);
    promptTokens = estTokens(JSON.stringify(built.messages));
  }
  p.check(
    `prompt fits the token budget (${budgetTokens})`,
    promptTokens <= budgetTokens,
    `${promptTokens} tokens estimated${trimmed ? ` - dropped ${trimmed} lowest-ranked section(s) to fit` : ""}`,
  );
  if (trimmed) warnings.push(`Some legal context had to be left out of this request to stay inside the provider's size limit (${trimmed} section(s)). Ask a follow-up if the section you expected is missing.`);
  const { messages, schema } = built;

  const trace: { model?: string; tokens?: { prompt?: number; completion?: number } } = {};
  const out = await chatJson(
    {
      schema,
      messages,
      model: imageUsed ? "vision" : "text",
      json: true,
      temperature: isRti ? 0.3 : 0.2,
      // prompt + completion share the same tokens-per-minute allowance; gpt-oss also spends
      // hidden reasoning tokens from the completion side, so 2,000 was too small and cut the
      // JSON off mid-object (seen live). The client doubles this once if an answer arrives cut.
      maxTokens: Number(process.env.GROQ_MAX_COMPLETION_TOKENS ?? 4000) || 4000,
      signal: opts.signal,
      trace,
      repair: (prev, err) => repairUser(prev, err, `Allowed keys only: ${ANALYSIS_KEYS.join(", ")}.`),
    },
    opts,
  );
  const raw = p.attach(out, "chatJson");
  if (!raw) {
    if (opts.is_working) return p.fixture(fixtureResponse(isRti, sections, req, warnings, startedAt, "fixture"));
    return p.done(null, out.error ?? "the model did not return a valid response");
  }

  const citationsIn = isRti ? (raw as RtiLetter).citations : (raw as Analysis).citations;
  const guard = citationGuard(citationsIn ?? [], chosen, opts);
  const g = p.attach(guard, "citationGuard");
  const kept = g?.kept ?? [];
  const stripped = g?.stripped ?? [];
  // citations the model phrased loosely are re-labelled from the corpus before the guard, so
  // "section 2(11)" and "Sec. 2(11)" both resolve to the canonical "2(11)" of the 2019 Act
  const canonicalised = enrich(kept, chosen);
  if (stripped.length) {
    const real = stripped.filter((s) => (s as { in_corpus_elsewhere?: boolean }).in_corpus_elsewhere).length;
    warnings.push(
      `${stripped.length} section reference(s) were removed because they were not part of the verified text retrieved for this case`
        + (real ? ` (${real} of them are real sections we did not retrieve this time - ask a follow-up question to pull them in)` : " (none of them exist in this app's statute set)"),
    );
  }

  const prec = precedentsFor(category, opts);
  const precSet = p.attach(prec, "precedentsFor") ?? { cases: [], empty: true, pending: 0, label: "Similar published cases" };
  const dl = computeDeadlines(category, startedAt, opts);
  const deadlines = p.attach(dl, "computeDeadlines") ?? [];
  const guide = guidanceFor(category);

  let analysis: Analysis | null = null;
  let rti: RtiLetter | null = null;

  if (isRti) {
    rti = { ...(raw as RtiLetter), letter: spaceParagraphs((raw as RtiLetter).letter, opts), citations: canonicalised.map((c) => ({ act: c.act, section: c.section, title: c.title })) };
  } else {
    const a = raw as Analysis;
    const contact = sanitizeContact(a.contact, opts);
    analysis = {
      ...a,
      letter: spaceParagraphs(a.letter, opts),
      contact: { designation: contact.data?.designation ?? a.contact.designation, department: contact.data?.department ?? a.contact.department, email_or_link: contact.data?.email_or_link ?? "N/A" },
      citations: canonicalised,
      // model-supplied precedents are always discarded - only verified records are shown
      precedents: precSet.cases,
      legalAidCentres: DIRECTORIES.legal_aid.filter((x) => x.url).slice(0, 3).map((x) => ({ name: x.name, type: "Gov", address: x.use, contact: "N/A", url: x.url })),
    };
    if (contact.data?.note) warnings.push(contact.data.note);
  }

  const answerLetter = isRti ? rti?.letter : analysis?.letter;

  if (chosen.some((s) => !s.verified)) {
    warnings.push(`${chosen.filter((s) => !s.verified).length} of the sections quoted here are still awaiting India Code verification - re-check them before you file.`);
  }

  // Asked for Hindi/Marathi but got a Latin-script draft: tell the user instead of letting
  // them print an English letter they did not ask for. Observed live with gpt-oss-20b.
  if (req.lang !== "en" && !/[\u0900-\u097F]/.test(answerLetter ?? "")) {
    warnings.push(
      `The draft came back in English even though you asked for ${req.lang === "hi" ? "Hindi" : "Marathi"}. It is still legally usable, but have it translated and proof-read before you send it.`,
    );
    p.check(`answer is in the requested language (${req.lang})`, false, "fell back to English; the user was told");
  } else if (req.lang !== "en") {
    p.check(`answer is in the requested language (${req.lang})`, true, `${(answerLetter ?? "").length} chars in Devanagari`);
  }

  const retrieve2 = retrieved.data;
  return p.done({
    kind: isRti ? "rti" : "analysis",
    analysis,
    rti,
    citations: canonicalised,
    strippedCitations: stripped,
    precedents: precSet,
    guidance: { deadlines, checklist: guide.checklist, escalation: guide.escalation, review: LETTER_REVIEW_CHECKLIST },
    legalAid: DIRECTORIES.legal_aid.map((x) => ({ name: x.name, url: x.url, use: x.use, status: x.status })),
    meta: {
    model: trace.model ?? (process.env.GROQ_TEXT_MODEL ?? "openai/gpt-oss-20b"),
    warnings,
    retrieval: { count: chosen.length, unverified: chosen.filter((s) => !s.verified).length, why: retrieve2?.why ?? "" },
    imageUsed,
    durationMs: Date.now() - startedAt,
    tokens: trace.tokens,
  },
    disclaimer: DISCLAIMER,
  });
}

function rtiUserBody(req: AnalyzeRequest, category: Category, sections: Section[]): string {
  return rtiUser({
    problem: req.problem,
    lang: req.lang,
    city: req.city,
    applicantName: req.applicant?.name ?? "",
    applicantAddress: [req.applicant?.address, req.applicant?.city, req.applicant?.state, req.applicant?.pin].filter(Boolean).join(", "),
    today: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
    sections,
  });
}

function fixtureResponse(isRti: boolean, sections: Section[], req: AnalyzeRequest, warnings: string[], startedAt: number, tag: string): AnalyzeResponse {
  const precSet = { cases: [], empty: true, pending: 0, label: "Similar published cases (self-test)" };
  const cat = (req.category || "General") as Category;
  // the clocks and checklists are pure local data, so the self-test exercises them for real
  const deadlines = computeDeadlines(cat, startedAt, { is_working: true }).data ?? [];
  return {
    kind: isRti ? "rti" : "analysis",
    analysis: isRti ? null : { ...FIXTURE_ANALYSIS, citations: [], precedents: [] },
    rti: isRti ? FIXTURE_RTI : null,
    citations: [],
    strippedCitations: [],
    precedents: precSet,
    guidance: { deadlines, checklist: guidanceFor(cat).checklist, escalation: guidanceFor(cat).escalation, review: LETTER_REVIEW_CHECKLIST },
    legalAid: DIRECTORIES.legal_aid.map((x) => ({ name: x.name, url: x.url, use: x.use, status: x.status })),
    meta: { model: `self-test (${tag})`, warnings: [...warnings, "self-test response - no tokens were spent"], retrieval: { count: sections.length, unverified: sections.filter((s) => !s.verified).length, why: "self-test" }, imageUsed: false, durationMs: Date.now() - startedAt },
    disclaimer: DISCLAIMER,
  };
}

/* ── fake-notice detector ────────────────────────────────────────────────── */

export async function detectNotice(req: DetectRequest, opts: Opts = {}): Promise<WorkResult<Detection>> {
  const p = track<Detection>("analyze.detectNotice", opts);
  const img = validateImage(req.imageBase64, opts);
  if (!img.ok && req.imageBase64) return p.done(null, img.error ?? "image rejected");
  if (req.imageBase64) {
    p.check("photo attached", true, "vision is not available on this deployment - the text you pasted is analysed, the photo is not");
  }
  const r = await retrieve(req.text, undefined, opts);
  const sections = p.attach(r, "retrieve")?.sections ?? [];
  const out = await chatJson(
    {
      schema: DetectionSchema,
      messages: [
        { role: "system", content: detectSystem({ sections }) },
        { role: "user", content: detectUser(req.text, sections) },
      ],
      model: "fast",
      json: true,
      temperature: 0.1,
      maxTokens: 1500,
      signal: opts.signal,
    },
    opts,
  );
  const d = p.attach(out, "chatJson#detect");
  if (!d) return opts.is_working ? p.fixture({ verdict: "Suspicious", confidence: 0, red_flags: ["self-test fixture"], checks: [], what_to_do: ["Verify at the counter of the issuing office"], law: "" } as unknown as Detection) : p.done(null, out.error ?? "detection failed");
  p.check("verdict is one of the three allowed labels", true, d.verdict);
  p.check("never tells the user to pay", !/pay now|click the link and pay/i.test(JSON.stringify(d)), "checked");
  return p.done(d);
}

export async function selfTest(opts: Opts = {}): Promise<WorkResult<AnalyzeResponse>> {
  const p = track<AnalyzeResponse>("analyze.selfTest", { ...opts, is_working: true });
  const r = await analyzeCase(
    { problem: "Self-test: my washing machine died in warranty and the service centre ignores me", lang: "en", category: "Consumer", city: "Pune", pincode: "", is_working: true },
    { ...opts, is_working: true },
  );
  p.attach(r, "analyzeCase#consumer");
  const rti = await analyzeCase({ problem: "Self-test: how many RTIs were filed to my department last year", lang: "en", category: "RTI", city: "", pincode: "", is_working: true }, { ...opts, is_working: true });
  p.attach(rti, "analyzeCase#rti");
  p.check("rejection of an oversized image is graceful", !validateImage("data:image/png;base64," + "A".repeat(2_400_000), opts).ok);
  p.check("non-image data URL is refused", !validateImage("data:application/pdf;base64,AAAA", opts).ok);
  const sc = sanitizeContact({ designation: "X", department: "Y", email_or_link: "http://evil.example.com/phish" }, opts);
  p.attach(sc, "sanitizeContact");
  p.check("phishing link sanitised", sc.data?.email_or_link === "N/A");
  return p.done(r.data);
}
