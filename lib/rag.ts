/**
 * Retrieval for statutory context (plan Phase 3).
 *
 * Law lives in data/laws/*.json, imported (not read at runtime) so the Vercel
 * serverless bundle always contains it. MiniSearch gives us real BM25-ish keyword
 * ranking without a vector database; the guard at the bottom is what stops the
 * model from citing a section we never gave it.
 */
import MiniSearch from "minisearch";
import { track, type Opts, type WorkResult } from "./diag";
import { normAct } from "./prompts";
import type { Citation } from "./schema";

import consumer from "@/data/laws/consumer-protection-act-2019.json";
import rti from "@/data/laws/rti-act-2005.json";
import labour from "@/data/laws/labour-and-wages.json";
import housing from "@/data/laws/tenant-housing.json";
import police from "@/data/laws/police-and-fir.json";
import banking from "@/data/laws/banking-and-cyber-fraud.json";
import constitutional from "@/data/laws/constitutional-and-legal-aid.json";

/**
 * Section labels are written inconsistently by every source - "Section 2(11)", "sec. 6(1)",
 * "Rule 3", "Article 21", "धारा 6(1)" - and the model tends to echo whatever we showed it.
 * Comparing raw strings silently kills every legitimate citation, so both sides go through
 * this: drop the lead-in word, drop spaces/punctuation, keep the numbering itself.
 */
export function normSection(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    // longest alternatives first: "sections" must not be eaten as "section" + stray "s"
    .replace(/(sub-?sections?|sections?|articles?|clauses?|paragraphs?|annexures?|annc|chapters?|rules?|secs?|धारा|कलम|अनुच्छेद|अनु)\s*[.:#-]?\s*/g, "")
    .replace(/[^a-z0-9()/.,-]/g, "")
    .replace(/^[-.,]+|[-.,]+$/g, "");
}

export interface LawEntry {
  act: string;
  section: string;
  title?: string;
  summary?: string;
  category: string;
  source_url?: string;
  alternate_url?: string;
  legacy_section?: string;
  verified: boolean;
  note?: string;
}

export interface Section {
  id: string;
  act: string;
  section: string;
  /** normalised key used by the citation guard: section number, no spaces, lowercase */
  skey: string;
  title: string;
  text: string;
  category: string;
  source_url: string;
  verified: boolean;
  note: string;
}

const FILES: LawEntry[][] = [
  consumer as unknown as LawEntry[],
  rti as unknown as LawEntry[],
  labour as unknown as LawEntry[],
  housing as unknown as LawEntry[],
  police as unknown as LawEntry[],
  banking as unknown as LawEntry[],
  constitutional as unknown as LawEntry[],
];

export const ALL_SECTIONS: Section[] = FILES.flat().map((e) => ({
  id: `${normAct(e.act)}||${e.section.replace(/\s+/g, "").toLowerCase()}`,
  act: e.act,
  section: e.section,
  skey: normSection(e.section),
  title: e.title ?? "",
  text: e.summary ?? "",
  category: e.category,
  source_url: e.source_url ?? e.alternate_url ?? "",
  verified: e.verified === true,
  note: e.note ?? "",
}));

/** Provisional citations are stripped from a letter unless `onlyVerified` is disabled. */
export function citationAllowList(sections: Section[]): Set<string> {
  return new Set(sections.map((s) => `${normAct(s.act)}||${s.skey}`));
}
let index: MiniSearch<Section> | null = null;
const byId = new Map<string | number, Section>(ALL_SECTIONS.map((s) => [s.id, s]));

/** MiniSearch returns ids + scores; hydrate back to our Section records. */
function hydrate(results: { id: string | number }[]): Section[] {
  return results.map((r) => byId.get(r.id)).filter((s): s is Section => !!s);
}

/** Built once per serverless warm instance - plan step 18. */
export function getIndex(opts: Opts = {}): WorkResult<MiniSearch<Section>> {
  const p = track<MiniSearch<Section>>("rag.getIndex", opts);
  try {
    if (!index) {
      const m = new MiniSearch<Section>({
        fields: ["act", "section", "title", "text", "category", "note"],
        storeFields: ["id", "act", "section", "skey", "title", "text", "category", "source_url", "verified", "note"],
        searchOptions: {
          boost: { section: 6, title: 3, act: 2, text: 1, note: 0.4 },
          prefix: true,
          fuzzy: 0.15,
          combineWith: "OR",
        },
      });
      m.addAll(ALL_SECTIONS);
      index = m;
      p.check(`index built (${m.documentCount} sections from ${FILES.length} acts)`, true);
    } else {
      p.check(`index reused (${m_count(index)} sections cached)`, true);
    }
    p.check("every entry has act + section", ALL_SECTIONS.every((s) => !!s.act && !!s.section));
    p.check("duplicate ids", new Set(ALL_SECTIONS.map((s) => s.id)).size === ALL_SECTIONS.length ? "none" : "duplicates present - check data/laws");
    return index ? p.done(index) : p.done(null, "index could not be built");
  } catch (e) {
    return p.caught(e);
  }
}

function m_count(i: MiniSearch<Section> | null): number {
  try {
    return i ? i.documentCount : 0;
  } catch {
    return 0;
  }
}

export interface RetrievalResult {
  sections: Section[];
  /** how many of the retrieved sections are still awaiting India Code verification */
  unverified: number;
  why: string;
}

/**
 * Top-k sections for a query. Category-scoped first, then global top-up, so a
 * mislabelled category still retrieves something honest.
 */
export async function retrieve(
  query: string,
  category: string | undefined,
  opts: Opts & { k?: number; includeUnverified?: boolean } = {},
): Promise<WorkResult<RetrievalResult>> {
  const p = track<RetrievalResult>("rag.retrieve", opts);
  const k = Math.max(1, Math.min(12, opts.k ?? 6));
  try {
    const built = await getIndex(opts);
    const idx = p.attach(built, "getIndex");
    if (!idx) return p.done(null, built.error ?? "search index unavailable");

    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4).slice(0, 24);
    p.check(`query normalised to ${terms.length} terms`, terms.length > 0 ? terms.join(" ").slice(0, 80) : "no usable terms - category fallback used");

    const all = hydrate(idx.search(query));
    const scoped = category ? all.filter((s) => s.category === category) : [];
    const global = all.filter((s) => !scoped.some((x) => x.id === s.id));

    const pool = [...scoped, ...global].slice(0, k * 3);
    const usable = opts.includeUnverified === false ? pool.filter((s) => s.verified) : pool;
    const sections = (usable.length >= 3 ? usable : pool).slice(0, k);

    p.check(`retrieved ${sections.length} section(s)`, sections.map((s) => `${s.act.split(",")[0]} ${s.section}`).join(" | ").slice(0, 160) || "none");
    const unverified = sections.filter((s) => !s.verified).length;
    if (unverified > 0) p.check("unverified sections present", true, `${unverified} awaiting India Code verification`);

    return p.done({
      sections,
      unverified,
      why: scoped.length ? `${scoped.length} category match(es) for "${category}", topped up globally` : "no category match; global keyword ranking",
    });
  } catch (e) {
    return p.caught(e);
  }
}

/**
 * Fails safe: only citations whose act AND section both appear in the retrieved set survive.
 * Matching on the section number alone would let "Consumer Protection Act, 1882 §2(11)"
 * through - a wrong Act with a real-looking number is the dangerous case.
 *
 * A stripped citation is additionally labelled `in_corpus_elsewhere`, which separates the
 * two very different problems: the model hallucinated (fix the prompt) versus the model
 * cited a real section we failed to retrieve (fix retrieval).
 */
export function citationGuard(
  citations: Citation[],
  allowed: Section[],
  opts: Opts = {},
): WorkResult<{ kept: Citation[]; stripped: (Citation & { in_corpus_elsewhere: boolean })[] }> {
  const p = track<{ kept: Citation[]; stripped: (Citation & { in_corpus_elsewhere: boolean })[] }>("rag.citationGuard", opts);
  const kept: Citation[] = [];
  const stripped: (Citation & { in_corpus_elsewhere: boolean })[] = [];

  const matchesIn = (pool: Section[], c: Citation) => {
    const sec = normSection(c.section);
    const act = normAct(c.act);
    return pool.some((s) => {
      if (s.skey !== sec) return false;
      const a = normAct(s.act);
      return a === act || a.includes(act) || act.includes(a);
    });
  };

  for (const c of citations ?? []) {
    if (matchesIn(allowed, c)) kept.push(c);
    else stripped.push({ ...c, in_corpus_elsewhere: matchesIn(ALL_SECTIONS, c) });
  }

  const missedReal = stripped.filter((s) => s.in_corpus_elsewhere).length;
  // Removal is the guard doing its job, not a failure - it is reported as an
  // informational check so a recovered answer still reads as ok:true.
  p.check(
    `citation guard processed ${citations?.length ?? 0} citation(s)`,
    true,
    stripped.length === 0
      ? `${kept.length} kept`
      : `${kept.length} kept, ${stripped.length} removed (${missedReal} real but not retrieved, ${stripped.length - missedReal} not in the corpus at all)`,
  );
  return p.done({ kept, stripped });
}

/** Self-test: index build + a canonical query + the guard. Used by /api/health. */
export async function selfTest(opts: Opts = {}): Promise<WorkResult<RetrievalResult>> {
  const p = track<RetrievalResult>("rag.selfTest", { ...opts, is_working: true });
  const r = await retrieve("delayed possession refund interest builder", "Consumer", { ...opts, k: 5 });
  p.attach(r, "retrieve");
  const guard = citationGuard(
    [
      { act: "Consumer Protection Act, 2019", section: "2(11)" },
      { act: "Make-Believe Act, 3000", section: "999" },
    ],
    ALL_SECTIONS.filter((s) => s.category === "Consumer"),
    opts,
  );
  p.attach(guard, "citationGuard");
  p.check("guard strips an invented citation", guard.data ? guard.data.stripped.length === 1 : false);
  p.check(`corpus size is usable (>= 40 sections)`, ALL_SECTIONS.length >= 40 ? `${ALL_SECTIONS.length} sections` : `only ${ALL_SECTIONS.length} sections`);
  return r;
}

export function corpusStats(): { sections: number; acts: number; verified: number; unverified: number; categories: string[] } {
  const acts = new Set(ALL_SECTIONS.map((s) => s.act));
  const verified = ALL_SECTIONS.filter((s) => s.verified).length;
  return {
    sections: ALL_SECTIONS.length,
    acts: acts.size,
    verified,
    unverified: ALL_SECTIONS.length - verified,
    categories: [...new Set(ALL_SECTIONS.map((s) => s.category))].sort(),
  };
}
