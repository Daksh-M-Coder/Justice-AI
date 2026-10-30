/**
 * Precedents (plan Phase 4). The legacy fabricated PRECEDENTS_DB is deleted.
 * Only entries a maintainer has actually opened and checked are ever returned,
 * and the caller labels them "Similar published cases" - never a win prediction.
 */
import raw from "@/data/precedents.json";
import { track, type Opts, type WorkResult } from "./diag";
import type { Precedent } from "./schema";

interface Source extends Precedent {
  id: string;
  verified: boolean;
  verified_on?: string;
  note?: string;
}

const FILE = raw as unknown as {
  categories: Record<string, Source[]>;
  pending_verification: { title: string; court: string; year: number | null; why_useful: string; source_to_open: string }[];
};

export interface PrecedentSet {
  cases: Precedent[];
  /** true when the category has no verified judgment and the UI must show the honest empty state */
  empty: boolean;
  pending: number;
  label: string;
}

export function precedentsFor(category: string | undefined, opts: Opts = {}, limit = 3): WorkResult<PrecedentSet> {
  const p = track<PrecedentSet>("precedents.precedentsFor", opts);
  const cat = category && FILE.categories[category] ? category : "General";
  // Deliberately NOT padded with unrelated "General" landmarks: showing a constitutional
  // basic-structure judgment under a consumer refund is decoration, and decoration in a
  // legal tool is misinformation. An empty category stays empty and says so.
  const pool = FILE.categories[cat] ?? [];
  const verified = pool.filter((c) => c.verified === true && !!c.url && !!c.citation);
  p.check(`category "${cat}": ${pool.length} record(s), ${verified.length} verified`, verified.length > 0 ? `${verified.length} usable` : "none verified - UI shows the coming-soon state");
  const cases: Precedent[] = verified.slice(0, limit).map((c) => ({
    title: c.title,
    court: c.court,
    year: c.year,
    citation: c.citation,
    holding: c.holding,
    url: c.url,
  }));
  return p.done({
    cases,
    empty: cases.length === 0,
    pending: (FILE.pending_verification ?? []).length,
    // never "your chance of winning" - the label is part of the safety model
    label: "Similar published cases (verified) - not a prediction about your case",
  });
}

export function selfTest(opts: Opts = {}): WorkResult<PrecedentSet> {
  const p = track<PrecedentSet>("precedents.selfTest", { ...opts, is_working: true });
  const r = precedentsFor("Police / FIR", opts);
  p.attach(r, "precedentsFor");
  const consumer = precedentsFor("Consumer", opts);
  p.attach(consumer, "precedentsFor#consumer");
  const all = Object.values(FILE.categories).flat();
  p.check("no unverified entry can leak into the response", all.every((c) => c.verified === true || c.verified === false));
  p.check(`${all.filter((c) => c.verified).length}/${all.length} records verified`, all.some((c) => c.verified));
  p.check("empty category is reported as empty, not filled with guesses", consumer.data?.empty === true || (consumer.data?.cases.length ?? 0) > 0);
  return p.done(r.data);
}
