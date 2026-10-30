"use client";

/**
 * The result view shared by the Analyse tab and Case History.
 *
 * Order follows what a person actually needs first: the plain summary, where to go, the
 * clock that is running, then the letter. Nothing here is innerHTML - model text goes
 * through React children only (plan step 32).
 */
import { useEffect, useMemo, useState } from "react";
import type { AnalyzeResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useWorkMode } from "@/lib/providers";
import { Badge, Btn, Card, CitationChip, Disclaimer, SectionTitle, Trace } from "./ui";
import * as browser from "@/lib/browser";
import * as pdf from "@/lib/pdf";
import { chat as apiChat } from "@/lib/apiClient";

const CAT_TONE: Record<string, "ok" | "warn" | "danger"> = { Low: "ok", Medium: "warn", High: "danger" };

function useChecklistState(caseId: string, items: string[]) {
  const key = `justiceai_checklist_${caseId}`;
  const [done, setDone] = useState<boolean[]>(() => items.map(() => false));
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setDone((JSON.parse(raw) as boolean[]).slice(0, items.length).concat(Array(Math.max(0, items.length - (JSON.parse(raw) as boolean[]).length)).fill(false)));
    } catch {
      /* ignore a corrupt local list */
    }
  }, [key, items.length]);
  const toggle = (i: number) => {
    setDone((cur) => {
      const next = cur.slice();
      next[i] = !next[i];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode - the tick still works for this session */
      }
      return next;
    });
  };
  return { done, toggle };
}

export function ResultView({
  data,
  caseId,
  checks,
  onRequestChat,
}: {
  data: AnalyzeResponse;
  caseId: string;
  checks?: unknown[];
  onRequestChat?: (question: string) => void;
}) {
  const { t, lang, speechLocale } = useI18n();
  const { working } = useWorkMode();
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRti = data.kind === "rti";
  const a = data.analysis;
  const letter = isRti ? data.rti?.letter : a?.letter;
  const review = isRti ? (data.rti?.review?.length ? data.rti.review : data.guidance.review) : data.guidance.review;
  const cl = useChecklistState(caseId, data.guidance.checklist);
  const citations = useMemo(() => data.citations ?? [], [data.citations]);

  const copy = async () => {
    if (!letter) return;
    const r = await browser.copyText(letter, { is_working: working });
    if (r.ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else setError(r.error ?? "Copy failed");
  };

  const download = async () => {
    if (!letter) return;
    const r = await pdf.exportLetter(
      {
        title: isRti ? "RTI Application under Section 6(1), RTI Act 2005" : (a?.authority ?? "Complaint"),
        subtitle: `${data.meta.model} · generated ${new Date().toLocaleString("en-IN")} · ${t("disclaimer")}`,
        body: letter,
        footer: `${t("disclaimer")}\nCitations used: ${citations.map((c) => `${c.act} §${c.section}`).join(", ") || "none"}`,
        lang,
      },
      { is_working: working },
    );
    if (!r.ok) setError(r.error ?? "Export failed");
  };

  const share = async () => {
    if (!letter) return;
    const r = await browser.shareWhatsApp(`${letter.slice(0, 900)}\n\n— ${t("disclaimer")}`, { is_working: working });
    if (!r.ok) setError(r.error ?? "Share failed");
  };

  const readAloud = async () => {
    if (!letter) return;
    if (reading) {
      browser.stopSpeaking({ is_working: working });
      setReading(false);
      return;
    }
    const r = browser.speak(letter, speechLocale, { is_working: working });
    if (r.ok) setReading(true);
    else setError(r.error ?? "Read-aloud unavailable");
  };

  const tone = a ? CAT_TONE[a.urgency] ?? "neutral" : "neutral";

  return (
    <div className="space-y-5">
      <Card className="rise">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {a ? <Badge tone={tone}>{`${t("result.urgency")}: ${a.urgency}`}</Badge> : <Badge tone="gold">RTI</Badge>}
          {a ? <Badge>{`${t("result.timeline")}: ${a.timeline}`}</Badge> : null}
          <Badge tone={citations.every((c) => c.verified) ? "ok" : "warn"}>
            {citations.length} {t("result.citations")} · {citations.filter((c) => !c.verified).length} unverified
          </Badge>
          <span className="ml-auto text-[0.68rem] text-[var(--color-muted)]">{data.meta.durationMs} ms</span>
        </div>

        {a?.plain_summary ? <p className="mb-3 text-[1.02rem] font-semibold leading-relaxed">{a.plain_summary}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {a ? (
            <Info label={t("result.authority")} value={a.authority} />
          ) : null}
          {a ? <Info label={t("result.law")} value={a.law} /> : null}
          {a ? <Info label={t("result.contact")} value={`${a.contact.designation}, ${a.contact.department}`} sub={a.contact.email_or_link} /> : null}
          {a ? <Info label={t("result.strength")} value={a.strength.score} sub={a.strength.reason} /> : null}
        </div>

        {a?.rights?.length ? (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{t("result.rights")}</h3>
            <ul className="space-y-1 text-[0.9rem]">
              {a.rights.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--color-ok)]" aria-hidden>
                    ✓
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {a?.strength?.tips?.length ? (
          <div className="mt-4 rounded-xl bg-[var(--color-brand-soft)] p-3">
            <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">How to strengthen the file</h3>
            <ul className="list-disc space-y-1 pl-5 text-[0.86rem]">
              {a.strength.tips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {citations.length ? (
        <Card>
          <SectionTitle eyebrow={t("result.citations")} title="Sections this answer relied on" sub="Only sections the app could retrieve from its own verified statute set are shown. ? means the text still awaits an India Code check." />
          <div className="flex flex-wrap gap-2">
            {citations.map((c, i) => (
              <CitationChip key={i} act={c.act} section={c.section} title={c.title} verified={c.verified} source_url={c.source_url} act_level={c.act_level} />
            ))}
          </div>
          {data.strippedCitations.length ? (
            <p className="mt-3 text-[0.75rem] leading-relaxed text-[var(--color-danger)]">
              {t("result.stripped")}:{" "}
              {data.strippedCitations
                .map((c) => `${c.act.replace(/,.*/, "")} §${c.section}${c.in_corpus_elsewhere ? " (real section, not retrieved for this question)" : " (not in the statute set at all)"}`)
                .join(", ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {data.guidance.deadlines.length ? <Deadlines rows={data.guidance.deadlines} /> : null}

      {letter ? (
        <Card>
          <SectionTitle eyebrow={isRti ? t("rti.title") : t("result.letter")} title={isRti ? "Your RTI application" : "Your complaint letter"} />
          <pre className="letter-body max-h-[26rem] overflow-auto rounded-xl border border-[color:var(--color-line)] bg-[var(--color-paper)] p-4">{letter}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={copy} kind="ghost">
              {copied ? t("btn.copied") : t("btn.copy")}
            </Btn>
            <Btn onClick={download} kind="ghost">
              {t("btn.pdf")}
            </Btn>
            <Btn onClick={share} kind="ghost">
              {t("btn.share")}
            </Btn>
            <Btn onClick={readAloud} kind="ghost">
              {reading ? t("btn.stop") : t("btn.read")}
            </Btn>
            {onRequestChat ? (
              <Btn
                kind="ghost"
                onClick={() => onRequestChat("Is there anything in this draft that looks wrong or too strong? Say it plainly.")}
                title="Ask the assistant about this letter"
              >
                💬 {t("chat.title")}
              </Btn>
            ) : null}
          </div>

          <div className="mt-5">
            <h3 className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{t("result.review")}</h3>
            <ul className="space-y-1 text-[0.85rem]">
              {review.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden>☐</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {a?.steps?.length ? (
        <Card>
          <SectionTitle eyebrow={t("result.steps")} title="What to do, in order" />
          <ol className="space-y-3">
            {a.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-brand)] text-[0.72rem] font-bold text-white">{i + 1}</span>
                <span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="block text-[0.88rem] text-[var(--color-ink-soft)]">{s.desc}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card>
        <SectionTitle eyebrow={t("result.checklist")} title="Documents to attach" sub="Tick them off as you collect them. This list is per category and does not change with the model's mood." />
        <ul className="space-y-1.5">
          {data.guidance.checklist.map((item, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-2 text-[0.88rem]">
                <input type="checkbox" className="mt-1 accent-[var(--color-brand)]" checked={!!cl.done[i]} onChange={() => cl.toggle(i)} />
                <span className={cl.done[i] ? "text-[var(--color-muted)] line-through" : ""}>{item}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      {data.guidance.escalation.length ? (
        <Card>
          <SectionTitle eyebrow={t("result.escalation")} title="The ladder: who to approach next" />
          <ol className="space-y-2.5">
            {data.guidance.escalation.map((s) => (
              <li key={s.step} className="rounded-xl border border-[color:var(--color-line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip border bg-[var(--color-brand-soft)]">Step {s.step}</span>
                  <span className="font-semibold">{s.where}</span>
                  {s.portal ? (
                    <a className="text-[0.8rem] font-semibold text-[var(--color-brand)] underline" href={s.portal} target="_blank" rel="noopener noreferrer">
                      open portal ↗
                    </a>
                  ) : null}
                </div>
                {s.note ? <p className="mt-1 text-[0.82rem] text-[var(--color-ink-soft)]">{s.note}</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <PrecedentsBlock data={data} />

      {data.meta.warnings.length ? (
        <Card>
          <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-warn)]">{t("result.warning")}</h3>
          <ul className="list-disc space-y-1 pl-5 text-[0.85rem]">
            {data.meta.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Disclaimer text={data.disclaimer} />
      {error ? <p className="text-[0.8rem] text-[var(--color-danger)]">{error}</p> : null}
      {checks?.length ? <Trace checks={checks as never} label="self-test trace for this answer" /> : null}
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--color-line)] p-3">
      <p className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-semibold leading-snug">{value}</p>
      {sub ? <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--color-ink-soft)]">{sub}</p> : null}
    </div>
  );
}

export function Deadlines({ rows }: { rows: AnalyzeResponse["guidance"]["deadlines"] }) {
  const { t } = useI18n();
  // The server computed dueInMs when the answer was produced. Recompute against the device
  // clock after mount so a case opened tomorrow does not show yesterday's numbers - and
  // start at 0 so the server HTML and the first client render agree (no hydration diff).
  const [wall, setWall] = useState(0);
  useEffect(() => {
    setWall(Date.now());
    const id = setInterval(() => setWall(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Card>
      <SectionTitle eyebrow={t("result.deadlines")} title="Legal clocks on this case" sub="Counted from when the case was started here. Confirm each period against the section named - several are still awaiting verification." />
      <ul className="space-y-2">
        {rows.map((d) => {
          const left = wall > 0 ? d.dueAt - wall : d.dueInMs;
          const abs = Math.abs(left);
          const days = Math.floor(abs / 86_400_000);
          const hours = Math.floor((abs % 86_400_000) / 3_600_000);
          const human = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
          return (
            <li key={d.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--color-line)] p-3">
              <Badge tone={left < 0 ? "danger" : left < 5 * 86_400_000 ? "warn" : "ok"}>{left < 0 ? `lapsed ${human} ago` : `${human} left`}</Badge>
              <span className="font-semibold">{d.label}</span>
              <span className="ml-auto text-[0.76rem] text-[var(--color-muted)]">
                {d.law}
                {d.verify ? " · needs verification" : ""}
              </span>
              <span className="w-full text-[0.76rem] text-[var(--color-ink-soft)]">
                Runs from: {d.from}
                {d.condonation ? ` · condonation: ${d.condonation}` : ""}
                {d.conditional ? ` · only when: ${d.conditional}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function PrecedentsBlock({ data }: { data: AnalyzeResponse }) {
  const { t } = useI18n();
  return (
    <Card>
      <SectionTitle eyebrow={t("result.precedents")} title={data.precedents.label} />
      {data.precedents.empty ? (
        <p className="rounded-xl border border-dashed border-[color:var(--color-line)] p-4 text-[0.86rem] text-[var(--color-muted)]">{t("result.noPrecedents")}</p>
      ) : (
        <ul className="space-y-3">
          {data.precedents.cases.map((c, i) => (
            <li key={i} className="rounded-xl border border-[color:var(--color-line)] p-3">
              <p className="font-semibold leading-snug">{c.title}</p>
              <p className="mt-0.5 text-[0.78rem] text-[var(--color-muted)]">
                {c.court} · {String(c.year)} · {c.citation}
              </p>
              <p className="mt-1.5 text-[0.86rem] leading-relaxed">{c.holding}</p>
              <a className="mt-1.5 inline-block text-[0.78rem] font-semibold text-[var(--color-brand)] underline" href={c.url} target="_blank" rel="noopener noreferrer">
                read the source ↗
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.74rem] text-[var(--color-muted)]">
        These are published judgments about similar facts. They are not a prediction about your case, and they are not authority for what to file.
      </p>
    </Card>
  );
}

/** Small chat panel used on a case (plan step 30). */
export function ChatPanel({ caseId, caseContext, category }: { caseId: string; caseContext: string; category?: string }) {
  const { t } = useI18n();
  const { working } = useWorkMode();
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async (text = input) => {
    const q = text.trim();
    if (!q) return;
    setInput("");
    setErr(null);
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    const r = await apiChat({ messages: [...msgs, { role: "user", content: q }].slice(-8), caseContext, caseId, ...(category ? { category } : {}) }, { is_working: working });
    setBusy(false);
    const reply = (r.data?.data as { reply?: string } | null)?.reply;
    if (reply) {
      setMsgs((m) => [...m, { role: "assistant", content: reply }]);
      void fetch(`/api/cases/${encodeURIComponent(caseId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }, { role: "assistant", content: reply }] }),
      }).catch(() => undefined);
    } else setErr(r.error ?? "No answer received");
  };

  return (
    <Card>
      <SectionTitle eyebrow={t("chat.title")} title="Ask about this case" sub={t("chat.empty")} />
      <div className="max-h-72 space-y-2 overflow-auto pr-1">
        {msgs.map((m, i) => (
          <p key={i} className={`max-w-[92%] rounded-xl px-3 py-2 text-[0.88rem] ${m.role === "user" ? "ml-auto bg-[var(--color-brand)] text-white" : "border border-[color:var(--color-line)]"}`}>
            {m.content}
          </p>
        ))}
        {busy ? <p className="text-[0.8rem] text-[var(--color-muted)]">{working ? "self-test: no token spent…" : "thinking…"}</p> : null}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="field" value={input} placeholder={t("chat.ph")} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && void send()} />
        <Btn onClick={() => void send()} disabled={busy || !input.trim()}>
          {t("chat.send")}
        </Btn>
      </div>
      {err ? <p className="mt-2 text-[0.78rem] text-[var(--color-danger)]">{err}</p> : null}
    </Card>
  );
}

export type { AnalyzeResponse };
