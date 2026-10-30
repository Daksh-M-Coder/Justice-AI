/**
 * Single source of truth for every JSON that crosses a trust boundary.
 *
 * Rule of the codebase: nothing from the model is ever `JSON.parse`d and used
 * directly — it is parsed here first. A failure triggers one retry (see
 * lib/groq.ts `chatJson`), and if the retry still fails we return a clean error.
 */
import { z } from "zod";

/* ── normalisers ─────────────────────────────────────────────────────────── */

const ci = <T extends string>(allowed: readonly [T, ...T[]], fallback: T) =>
  z
    .unknown()
    .transform((v): T => {
      const s = String(v ?? "").trim().toLowerCase();
      if (!s) return fallback; // never let "" prefix-match its way into the first option
      const compact = s.replace(/[^a-z0-9]/g, "");
      const hit = allowed.find((a) => {
        const k = a.toLowerCase().replace(/[^a-z0-9]/g, "");
        return k === s.replace(/\s+/g, "") || k === compact || (compact.length >= 3 && k.startsWith(compact));
      });
      return (hit ?? fallback) as T;
    });

/** Model sometimes answers with an array of strings for a single-field value. */
const textish = (min: number) =>
  z.unknown().transform((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).trim()).pipe(z.string().min(min));

const stringList = (min = 1) =>
  z
    .unknown()
    .transform((v) => (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []))
    .pipe(z.array(textish(1)).min(min).catch([]));

/* ── model output: case analysis ─────────────────────────────────────────── */

export const CitationSchema = z.object({
  act: textish(2),
  section: textish(1),
  title: z.string().optional(),
  source_url: z.string().optional(),
});

/**
 * Citation lists are tolerant by design. The model sometimes emits empty placeholder
 * objects ({act:"", section:""}) - especially in Hindi/Marathi answers - and throwing away
 * a usable RTI draft over an empty entry is the wrong trade. An entry with no act or no
 * section carries no claim, so dropping it cannot mislead anyone.
 */
export const CitationListSchema = z
  .unknown()
  .transform((v) =>
    (Array.isArray(v) ? v : []).filter(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        String((c as { act?: unknown }).act ?? "").trim().length >= 2 &&
        String((c as { section?: unknown }).section ?? "").trim().length >= 1,
    ),
  )
  .pipe(z.array(CitationSchema));

export const PrecedentSchema = z.object({
  title: textish(3),
  court: z.string().default("Unknown court"),
  year: z.union([z.number(), z.string()]).default(""),
  citation: z.string().default(""),
  holding: z.string().default(""),
  url: z.string().default(""),
});

export const StrengthSchema = z.object({
  score: ci(["Strong", "Moderate", "Weak"] as const, "Moderate"),
  reason: textish(10),
  tips: stringList(1),
});

export const StepSchema = z.object({
  title: textish(2),
  desc: textish(2),
});

export const ContactSchema = z.object({
  designation: textish(2),
  department: textish(2),
  email_or_link: z.string().default("N/A"),
});

export const LegalAidCentreSchema = z.object({
  name: textish(2),
  type: z.string().default("Gov"),
  address: z.string().default(""),
  contact: z.string().default("N/A"),
  url: z.string().optional(),
});

/** Models return this as 730, "730" or "2 years", or omit it. Only a real number survives,
 *  and a bad one must never discard an otherwise-good letter (observed live). */
const daysNumber = z
  .unknown()
  .transform((v) => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v) > 0 && Math.round(v) <= 3650 ? Math.round(v) : undefined;
    const m = String(v ?? "").replace(/,/g, "").match(/\d+/);
    if (!m) return undefined;
    const n = Number(m[0]);
    return n > 0 && n <= 3650 ? n : undefined; // a "limitation" of 40,000 days is not a limitation
  })
  .optional();

/** Required fields are enforced; unknown extra keys are stripped by zod's default
 *  behaviour — a cosmetic drift from the model must never nuke the user's result,
 *  but a missing field must. */
export const AnalysisSchema = z
  .object({
    authority: textish(3),
    law: textish(3),
    urgency: ci(["Low", "Medium", "High"] as const, "Medium"),
    timeline: textish(2),
    rights: stringList(2),
    strength: StrengthSchema,
    contact: ContactSchema,
    letter: textish(80),
    steps: z.array(StepSchema).min(1),
    citations: CitationListSchema,
    legalAidCentres: z.array(LegalAidCentreSchema).catch([]),
    /** never taken from the model — the server overwrites it with verified data only */
    precedents: z.array(PrecedentSchema).catch([]),
    plain_summary: z.string().default(""),
    limitation_days: daysNumber,
  });

export type Analysis = z.infer<typeof AnalysisSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type Precedent = z.infer<typeof PrecedentSchema>;

/* ── model output: RTI letter ────────────────────────────────────────────── */

export const RtiLetterSchema = z.object({
  letter: textish(120),
  citations: CitationListSchema,
  // optional on purpose: the UI falls back to the standard letter-review checklist, and
  // failing a whole RTI draft because the model skipped one array would be user-hostile
  review: stringList(0).default([]),
});

export type RtiLetter = z.infer<typeof RtiLetterSchema>;

/* ── model output: fake-notice / scam detector ───────────────────────────── */

export const DetectionSchema = z
  .object({
    verdict: ci(["LikelyGenuine", "Suspicious", "LikelyFraud"] as const, "Suspicious"),
    confidence: z.unknown().transform((v) => Math.min(1, Math.max(0, Number(v ?? 0)))).pipe(z.number()),
    red_flags: z.array(z.string()).default([]),
    checks: z
      .array(z.object({ claim: textish(2), status: ci(["ok", "mismatch", "unknown"] as const, "unknown"), note: z.string().default("") }))
      .default([]),
    what_to_do: stringList(1),
    law: z.string().default(""),
  });

export type Detection = z.infer<typeof DetectionSchema>;

/* ── API request bodies ──────────────────────────────────────────────────── */

export const LangSchema = ci(["en", "hi", "mr"] as const, "en");
export type Lang = z.infer<typeof LangSchema>;

export const CATEGORY_VALUES = [
  "Consumer",
  "RTI",
  "Tenant / Housing",
  "Workplace / Labour",
  "Police / FIR",
  "Banking / Fraud",
  "Cyber Fraud",
  "Family / Marriage",
  "General",
] as const;

export const CategorySchema = ci(CATEGORY_VALUES, "General");
export type Category = z.infer<typeof CategorySchema>;

export const CaseStatusSchema = ci(["open", "filed", "waiting", "resolved", "saved"] as const, "open");
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const ApplicantSchema = z.object({
  name: z.string().max(120).default(""),
  address: z.string().max(300).default(""),
  city: z.string().max(80).default(""),
  state: z.string().max(80).default(""),
  pin: z.string().max(12).default(""),
  phone: z.string().max(20).default(""),
});
export type Applicant = z.infer<typeof ApplicantSchema>;

const ImageBase64Schema = z.string().max(2_400_000, "Image too large (keep it under ~1.7 MB of base64)");

export const AnalyzeRequestSchema = z.object({
  problem: z.string().trim().min(12, "Describe your problem in at least a dozen characters"),
  lang: LangSchema.default("en"),
  category: z.union([CategorySchema, z.literal("")]).default("General"),
  city: z.string().max(80).default(""),
  pincode: z.string().max(12).default(""),
  applicant: ApplicantSchema.optional(),
  imageBase64: ImageBase64Schema.optional(),
  is_working: z.boolean().default(false),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ChatMessageSchema = z.object({
  role: ci(["user", "assistant"] as const, "user"),
  content: z.string().trim().min(1).max(6000),
});

export const ChatRequestSchema = z.object({
  caseId: z.string().min(1).max(120).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(20),
  caseContext: z.string().max(6000).default(""),
  lang: LangSchema.default("en"),
  is_working: z.boolean().default(false),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const DetectRequestSchema = z
  .object({
    text: z.string().trim().max(8000).default(""),
    imageBase64: ImageBase64Schema.optional(),
    is_working: z.boolean().default(false),
  })
  .refine((v) => v.text.length >= 10 || !!v.imageBase64, {
    message: "Paste the notice text (10+ chars) or attach a photo",
  });

export type DetectRequest = z.infer<typeof DetectRequestSchema>;

/* ── Firestore documents (data model, plan step 13) ──────────────────────── */

export const CaseDocSchema = z.object({
  id: z.string(),
  problem: z.string(),
  category: z.string(),
  status: CaseStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number().optional(),
  analysis: z.unknown().nullish(),
  artifacts: z.array(z.object({ id: z.string(), type: z.string(), text: z.string(), version: z.number() })).default([]),
});

export type CaseDoc = z.infer<typeof CaseDocSchema>;

export const MessageDocSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  createdAt: z.number(),
});

export type MessageDoc = z.infer<typeof MessageDocSchema>;

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Strip code fences / leading prose that models occasionally add before JSON. */
export function extractJson(raw: string): string {
  const t = raw.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export function parseWith<S extends z.ZodType>(schema: S, raw: string): z.infer<S> | { parseError: string } {
  try {
    return schema.parse(JSON.parse(extractJson(raw)));
  } catch (e) {
    const issue = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ") : String(e);
    return { parseError: issue };
  }
}

export function isParseError(v: unknown): v is { parseError: string } {
  return typeof v === "object" && v !== null && "parseError" in v;
}
