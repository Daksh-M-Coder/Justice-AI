/**
 * Category guidance: legal clocks, document checklists, escalation ladders and the
 * letter-review checklist (plan Phase 6). Static JSON on purpose - these are the parts
 * a human can verify, so they are not delegated to the model.
 */
import guidance from "@/data/guidance.json";
import directories from "@/data/directories.json";
import { track, type Opts, type WorkResult } from "./diag";

export interface DeadlineSpec {
  key: string;
  label: string;
  days?: number;
  hours?: number;
  from: string;
  law: string;
  verify: boolean;
  conditional?: string;
  condonation?: string;
  extension?: string;
  note?: string;
}

export interface EscalationStep {
  step: number;
  where: string;
  portal: string;
  note: string;
}

interface GuidanceCategory {
  deadlines: DeadlineSpec[];
  checklist: string[];
  escalation: EscalationStep[];
}

const DATA = guidance as unknown as { categories: Record<string, GuidanceCategory>; letter_review_checklist: string[] };
const DIRS = directories as unknown as typeof directories;

export const LETTER_REVIEW_CHECKLIST: string[] = DATA.letter_review_checklist;
export const DIRECTORIES = DIRS;

export function guidanceFor(category: string | undefined): GuidanceCategory {
  const key = category && DATA.categories[category] ? category : "General";
  return DATA.categories[key] ?? DATA.categories.General;
}

export interface Countdown extends DeadlineSpec {
  /** ms until it is due, computed from the case start date; negative = already lapsed */
  dueInMs: number;
  dueAt: number;
  lapsed: boolean;
  urgent: boolean;
}

/** Turns a spec into a live countdown for one case (plan step 34). */
export function computeDeadlines(category: string | undefined, startedAt: number, opts: Opts = {}): WorkResult<Countdown[]> {
  const p = track<Countdown[]>("guidance.computeDeadlines", opts);
  const g = guidanceFor(category);
  const now = Date.now();
  const rows: Countdown[] = [];
  for (const d of g.deadlines) {
    const msSpan = d.hours != null ? d.hours * 3_600_000 : (d.days ?? 0) * 86_400_000;
    const dueAt = startedAt + msSpan;
    const dueInMs = dueAt - now;
    rows.push({ ...d, dueAt, dueInMs, lapsed: dueInMs < 0, urgent: dueInMs >= 0 && dueInMs < 5 * 86_400_000 });
  }
  p.check(`${rows.length} clock(s) computed for "${category ?? "General"}"`, rows.length > 0 ? `${rows.filter((r) => r.lapsed).length} lapsed` : "no clocks defined for this category");
  p.check("every clock names its statutory source", rows.every((r) => !!r.law) ? "all sourced" : "one or more lack a law reference");
  return p.done(rows);
}

/** Human "3 days left" / "lapsed 2 months ago" string for the UI. */
export function formatCountdown(d: Countdown, lang = "en"): string {
  const abs = Math.abs(d.dueInMs);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const unit = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  if (lang === "hi") return d.lapsed ? `${unit} पार हो चुका` : `${unit} शेष`;
  if (lang === "mr") return d.lapsed ? `${unit} झाले` : `${unit} बाकी`;
  return d.lapsed ? `lapsed ${unit} ago` : `${unit} left`;
}

export function selfTest(opts: Opts = {}): WorkResult<{ categories: string[]; clocks: number }> {
  const p = track<{ categories: string[]; clocks: number }>("guidance.selfTest", { ...opts, is_working: true });
  const cats = Object.keys(DATA.categories);
  p.check(`guidance covers ${cats.length} categories`, cats.length >= 8, cats.join(", "));
  const total = cats.reduce((n, c) => n + DATA.categories[c].deadlines.length, 0);
  p.check(`${total} legal clocks defined`, total >= 20, `${total} clocks; all marked verify=${Object.values(DATA.categories).every((c) => c.deadlines.every((d) => d.verify !== false)) ? "flagged for human verification" : "mixed"}`);
  p.check("escalation portals are https or empty", cats.every((c) => DATA.categories[c].escalation.every((e) => e.portal === "" || e.portal.startsWith("https://"))));
  p.check("letter review checklist present", LETTER_REVIEW_CHECKLIST.length >= 8, `${LETTER_REVIEW_CHECKLIST.length} items`);
  const cd = computeDeadlines("RTI", Date.now() - 10 * 86_400_000, opts);
  p.attach(cd, "computeDeadlines");
  p.check("RTI 30-day clock fires for a 10-day-old case", cd.data ? cd.data.some((r) => r.key === "rti_reply" && !r.lapsed) : false);
  return p.done({ categories: cats, clocks: total });
}
