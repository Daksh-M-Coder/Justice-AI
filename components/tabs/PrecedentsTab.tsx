"use client";

/**
 * Published cases tab (plan steps 22-25). Reads the same verified-only dataset the API
 * uses, so nothing invented can appear here even if a user opens the tab offline.
 */
import { useMemo } from "react";
import { precedentsFor } from "@/lib/precedents";
import { CATEGORIES } from "./AnalyseTab";
import { Badge, Card, Disclaimer, Empty, SectionTitle } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import raw from "@/data/precedents.json";

export function PrecedentsTab() {
  const { t } = useI18n();
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        category: c,
        set: precedentsFor(c, { is_working: true }).data ?? { cases: [], empty: true, pending: 0, label: "" },
      })),
    [],
  );
  const meta = raw as unknown as { _meta: { verification_standard: string; display_rule: string }; pending_verification: { title: string; why_useful: string; source_to_open: string }[] };
  const total = groups.reduce((n, g) => n + g.set.cases.length, 0);

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle
          eyebrow={t("nav.precedents")}
          title={`${total} verified judgment${total === 1 ? "" : "s"}`}
          sub="The legacy app invented case names, amounts and 'resolved in 42 days' figures. That dataset was deleted. What you see here is limited to judgments a maintainer has opened and checked, and categories with nothing verified say so instead of padding with guesses."
        />
        <p className="text-[0.76rem] text-[var(--color-muted)]">{meta._meta.display_rule}</p>
      </Card>

      {groups.map((g) => (
        <Card key={g.category}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-[1.05rem] font-semibold" title={g.category}>
              {t(`cat.${g.category}`)}
            </h3>
            {g.set.empty ? <Badge tone="warn">coming soon</Badge> : <Badge tone="ok">{g.set.cases.length}</Badge>}
          </div>
          {g.set.empty ? (
            <Empty title={t("result.noPrecedents")} body={`Awaiting verification: ${g.set.pending} candidate(s) queued in data/precedents.json`} />
          ) : (
            <ul className="space-y-3">
              {g.set.cases.map((c) => (
                <li key={c.title} className="rounded-xl border border-[color:var(--color-line)] p-3">
                  <p className="font-semibold leading-snug">{c.title}</p>
                  <p className="mt-0.5 text-[0.76rem] text-[var(--color-muted)]">
                    {c.court} · {String(c.year)} · {c.citation}
                  </p>
                  <p className="mt-1.5 text-[0.86rem] leading-relaxed">{c.holding}</p>
                  <a className="mt-1.5 inline-block text-[0.78rem] font-semibold underline" href={c.url} target="_blank" rel="noopener noreferrer">
                    open the source ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}

      <Card>
        <SectionTitle eyebrow="Queued for verification" title="Candidates not yet shown" sub="These are real, well-known judgments that have not been opened and confirmed against the source in this repo's verification pass, so they stay hidden." />
        <ul className="space-y-2 text-[0.84rem]">
          {meta.pending_verification.map((p) => (
            <li key={p.title} className="rounded-xl border border-dashed border-[color:var(--color-line)] p-3">
              <p className="font-semibold">{p.title}</p>
              <p className="mt-1 text-[var(--color-ink-soft)]">{p.why_useful}</p>
              <a className="mt-1 inline-block text-[0.76rem] underline" href={p.source_to_open.startsWith("http") ? p.source_to_open : undefined} target="_blank" rel="noopener noreferrer">
                {p.source_to_open.slice(0, 90)}
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.78rem] text-[var(--color-muted)]">Run <code className="rounded bg-[var(--color-brand-soft)] px-1">npm run verify:precedents -- --write</code> after reading each source.</p>
      </Card>

      <Disclaimer text="Similar published cases are context, not a prediction. Nothing here states the chance of winning your case, and no outcome can be guaranteed." />
    </div>
  );
}
