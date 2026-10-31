"use client";

/**
 * Sources (plan step 31: the fake news ticker is deleted). Primary-record links only,
 * each labelled with whether this repo has confirmed it is reachable.
 */
import { DIRECTORIES } from "@/lib/guidance";
import { Badge, Card, Disclaimer, SectionTitle } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export function SourcesTab() {
  const { t } = useI18n();
  /** `status` is a machine enum; a lay reader has no idea what "needs_check" means. */
  const statusLabel = (s: string) => (s === "verified" ? "link checked by us" : "link not checked yet");
  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle eyebrow={t("nav.sources")} title="Read the record, not a summary" sub="The legacy build shipped a hardcoded 'latest judgments' ticker that was made up. It is gone. This tab links the primary sources; there is no AI-written news in this app." />
        <div className="rounded-xl border border-dashed border-[color:var(--color-warn)] p-3 text-[0.82rem]">
          <p className="font-semibold text-[var(--color-warn)]">There is no case-law news feed here</p>
          <p className="mt-1 text-[var(--color-ink-soft)]">{DIRECTORIES.news_policy.current_behaviour}</p>
          {/* the data file also carries a `roadmap` string ("fetch the RSS server-side with a
              cache...") - that is a maintainer note, not something to show a person in trouble */}
        </div>
      </Card>

      <Card>
        <SectionTitle eyebrow="Where the law text comes from" title="Statute and judgment records" />
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {DIRECTORIES.record_sources.map((s) => (
            <li key={s.name} className="min-w-0 rounded-xl border border-[color:var(--color-line)] p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-snug">{s.name}</p>
                <Badge tone={s.status === "verified" ? "ok" : "warn"}>{statusLabel(s.status)}</Badge>
              </div>
              <p className="mt-1 text-[0.8rem] text-[var(--color-ink-soft)]">{s.use}</p>
              <a className="mt-1.5 inline-block text-[0.76rem] font-semibold underline" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url.replace("https://", "").slice(0, 46)} ↗
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Disclaimer text="A link to a record is not advice about your case. Section numbers quoted by this app must be read in the source before you file anything." />
    </div>
  );
}
