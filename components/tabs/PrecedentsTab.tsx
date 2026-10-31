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
  const queued = meta.pending_verification.length;

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle
          eyebrow={t("nav.precedents")}
          title={`${total} verified judgment${total === 1 ? "" : "s"}`}
          sub="The legacy app invented case names, amounts and 'resolved in 42 days' figures. That dataset was deleted. What you see here is limited to judgments a maintainer has opened and checked, and categories with nothing verified say so instead of padding with guesses."
        />
        {/* was: the raw `_meta.display_rule` string from the data file, i.e. an internal
            spec addressed to the maintainer ("UI shows ONLY verified: true entries...") */}
        <p className="text-[0.76rem] text-[var(--color-muted)]">
          {total} of {total + queued} candidate judgments have been checked against the published record so far. The rest stay hidden until they are.
        </p>
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
            <Empty title={t("result.noPrecedents")} body={`Awaiting verification: ${g.set.pending} candidate judgment${g.set.pending === 1 ? "" : "s"} in this category`} />
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

      {queued > 0 ? (
        <Card>
          <SectionTitle
            eyebrow="Not shown yet"
            title={`${queued} further judgment${queued === 1 ? "" : "s"} awaiting verification`}
            sub="These are well-known judgments that could help in categories we do not have a verified record for yet. They stay hidden until someone opens the published text and confirms the title, court, year and citation, because a half-remembered case name in a legal tool does more harm than an empty list."
          />
          {/* deliberately no list of candidate titles / source URLs: that is the maintainer's
              work queue (and it used to render a raw, malformed URL as link text) */}
        </Card>
      ) : null}

      <Disclaimer text="Similar published cases are context, not a prediction. Nothing here states the chance of winning your case, and no outcome can be guaranteed." />
    </div>
  );
}
