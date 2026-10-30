/**
 * Client-side mirrors of the server responses. Deliberately loose where the server is
 * the authority (everything arrives validated from zod on the server), but typed enough
 * that a renamed field breaks the build instead of showing "undefined" to a user.
 */
import type { Opts, WorkCheck } from "./diag";
import { track, type WorkResult } from "./diag";

export type { WorkCheck };

export interface Citation {
  act: string;
  section: string;
  title?: string;
  verified: boolean;
  source_url: string;
  note?: string;
  /** set on stripped citations: the section exists in the corpus, it just was not retrieved */
  in_corpus_elsewhere?: boolean;
  /** the corpus entry cites a whole Act (state law, rules) rather than a numbered section */
  act_level?: boolean;
}

export interface Deadline {
  key: string;
  label: string;
  days?: number;
  hours?: number;
  from: string;
  law: string;
  verify: boolean;
  dueAt: number;
  dueInMs: number;
  lapsed: boolean;
  urgent: boolean;
  note?: string;
  condonation?: string;
  conditional?: string;
}

export interface EscalationStep {
  step: number;
  where: string;
  portal: string;
  note: string;
}

export interface Precedent {
  title: string;
  court: string;
  year: number | string;
  citation: string;
  holding: string;
  url: string;
}

export interface AnalysisResult {
  authority: string;
  law: string;
  urgency: "Low" | "Medium" | "High";
  timeline: string;
  rights: string[];
  strength: { score: "Strong" | "Moderate" | "Weak"; reason: string; tips: string[] };
  contact: { designation: string; department: string; email_or_link: string };
  letter: string;
  steps: { title: string; desc: string }[];
  citations: Citation[];
  legalAidCentres: { name: string; type: string; address: string; contact: string; url?: string }[];
  plain_summary: string;
  limitation_days?: number;
  precedents: Precedent[];
}

export interface AnalyzeResponse {
  kind: "analysis" | "rti";
  analysis: AnalysisResult | null;
  rti: { letter: string; citations: Citation[]; review: string[] } | null;
  citations: Citation[];
  strippedCitations: Citation[];
  precedents: { cases: Precedent[]; empty: boolean; pending: number; label: string };
  guidance: { deadlines: Deadline[]; checklist: string[]; escalation: EscalationStep[]; review: string[] };
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

export interface DetectionResult {
  verdict: "LikelyGenuine" | "Suspicious" | "LikelyFraud";
  confidence: number;
  red_flags: string[];
  checks: { claim: string; status: "ok" | "mismatch" | "unknown"; note: string }[];
  what_to_do: string[];
  law: string;
}

export interface CaseListItem {
  id: string;
  problem: string;
  category: string;
  status: string;
  createdAt: number;
  lang?: string;
  city?: string;
  result?: AnalyzeResponse | null;
  analysis?: unknown;
  guest?: boolean;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
}

export interface HealthReport {
  ok: boolean;
  degraded?: string[];
  at: string;
  durationMs: number;
  summary: { ok: boolean; total: number; passed: number; failed: number; skipped: number; failing: WorkCheck[] };
  services: { name: string; ok: boolean; error?: string; checks: { name: string; ok: boolean; detail: string; skipped?: boolean }[] }[];
  corpus: { sections: number; acts: number; verified: number; unverified: number; categories: string[] };
  models: { text: string; fast: string; vision: string | null; active: string[]; note: string };
  quota: { guestPerDay: number; userPerDay: number; userChatPerDay: number };
}

/** A tiny helper so components can call anything with is_working and render the trace. */
export function probe<T>(name: string, fn: (o: Opts) => WorkResult<T> | Promise<WorkResult<T>>, opts: Opts = {}) {
  const p = track<T>(`probe(${name})`, opts);
  void p;
  return fn({ ...opts, is_working: opts.is_working ?? true });
}
