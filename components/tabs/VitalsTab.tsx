"use client";

/**
 * System Vitals: the visible half of the is_working convention (plan step 41).
 * Left side runs the server self-test registry, right side runs the client-side ones.
 * Nothing here spends tokens or writes data - all of it is is_working: true.
 */
import { useCallback, useState } from "react";
import { health } from "@/lib/apiClient";
import * as guestStore from "@/lib/guestStore";
import * as browser from "@/lib/browser";
import * as pdf from "@/lib/pdf";
import * as fb from "@/lib/firebaseClient";
import { LANGS, coverageReport } from "@/lib/i18n";
import type { HealthReport, WorkCheck } from "@/lib/types";
import { Badge, Btn, Card, SectionTitle, Trace } from "@/components/ui";
import { useWorkMode } from "@/lib/providers";
import { useI18n } from "@/lib/i18n";

interface ClientReport {
  name: string;
  ok: boolean;
  error?: string;
  checks: WorkCheck[];
}

export function VitalsTab() {
  const { t } = useI18n();
  const { working, set } = useWorkMode();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [client, setClient] = useState<ClientReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);

  const runClient = useCallback((): ClientReport[] => {
    const out: ClientReport[] = [];
    const push = (name: string, r: { ok: boolean; error?: string; checks: WorkCheck[] }) => out.push({ name, ok: r.ok, error: r.error, checks: r.checks });

    push("guestStore.selfTest", guestStore.selfTest({ is_working: true }));
    push("browser.selfTest", browser.selfTest({ is_working: true }));
    push("pdf.selfTest", pdf.selfTest({ is_working: true }));
    void fb.selfTest({ is_working: true }).then((r) => setClient((cur) => [...cur, { name: "firebase.selfTest", ok: r.ok, error: r.error, checks: r.checks }]));

    const cov = coverageReport({ is_working: true });
    out.push({
      name: `i18n coverage (${cov.data?.total ?? 0} keys × ${LANGS.length} locales)`,
      ok: (cov.data?.missing.length ?? 0) === 0,
      error: cov.data?.missing.length ? `missing: ${cov.data.missing.slice(0, 8).join(", ")}` : undefined,
      checks: cov.checks,
    });
    return out;
  }, []);

  const runAll = async () => {
    setBusy(true);
    setError(null);
    setClient(runClient());
    const r = await health({ is_working: true });
    setBusy(false);
    if (r.data) {
      setReport(r.data as unknown as HealthReport);
      setAt(new Date().toLocaleTimeString("en-IN"));
    } else setError(r.error ?? "The health endpoint did not answer.");
  };

  const clientFailing = client.flatMap((c) => c.checks.filter((k) => !k.ok));

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle
          eyebrow={t("vitals.title")}
          title="Every function reports whether it is working"
          sub={t("vitals.sub")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => void runAll()} disabled={busy}>
            {busy ? "Probing…" : t("btn.runSelfTest")}
          </Btn>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--color-line)] px-3 py-1.5 text-[0.78rem] font-semibold">
            <input type="checkbox" className="accent-[var(--color-brand)]" checked={working} onChange={(e) => set(e.target.checked)} />
            is_working for the whole app
          </label>
          {at ? <span className="text-[0.76rem] text-[var(--color-muted)]">last run {at}</span> : null}
          {error ? <span className="text-[0.8rem] font-semibold text-[var(--color-danger)]">{error}</span> : null}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle eyebrow="Server" title="Self-test registry" />
          {!report ? <p className="text-[0.85rem] text-[var(--color-muted)]">Not run yet.</p> : null}
          {report ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone={report.ok ? "ok" : "danger"}>
                  {report.ok ? "all required services green" : `${report.services.filter((s) => !s.ok).length} service(s) red`}
                </Badge>
                <Badge tone="neutral">{report.summary.passed} checks passed</Badge>
                <Badge tone={report.summary.failed ? "danger" : "ok"}>{report.summary.failed} checks failed</Badge>
                <Badge tone="gold">{report.summary.skipped} skipped (no spend)</Badge>
                <Badge tone="neutral">{report.services.length} services probed</Badge>
                <Badge tone="neutral">{report.durationMs} ms</Badge>
              </div>
              <ul className="space-y-1.5">
                {report.services.map((s) => (
                  <li key={s.name} className="flex items-start gap-2 text-[0.82rem]">
                    <span className={s.ok ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"} aria-hidden>
                      {s.ok ? "✓" : "✗"}
                    </span>
                    <span className="min-w-0">
                      <span className="font-mono">{s.name}</span>
                      {s.error ? <span className="block text-[var(--color-muted)]">{s.error}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              {report.degraded?.length ? (
                <div className="mt-3 rounded-xl border border-dashed border-[color:var(--color-warn)] p-3 text-[0.78rem]">
                  <p className="font-semibold text-[var(--color-warn)]">Running in degraded mode</p>
                  <ul className="mt-1 list-disc pl-5">
                    {report.degraded.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-3 grid gap-2 text-[0.78rem] sm:grid-cols-2">
                <p>
                  <span className="font-semibold">Corpus:</span> {report.corpus.sections} sections · {report.corpus.acts} acts · {report.corpus.verified} verified ·{" "}
                  <span className="text-[var(--color-warn)]">{report.corpus.unverified} awaiting verification</span>
                </p>
                <p>
                  <span className="font-semibold">Models:</span> {report.models.text} / {report.models.fast} / vision {report.models.vision ?? "none"}
                </p>
                <p className="sm:col-span-2">
                  <span className="font-semibold">Quota:</span> guest {report.quota.guestPerDay}/day · signed-in {report.quota.userPerDay}/day · chat {report.quota.userChatPerDay}/day
                </p>
                {report.models.active.length ? <p className="sm:col-span-2 text-[var(--color-muted)]">Live Groq models: {report.models.active.slice(0, 12).join(", ")}</p> : null}
              </div>
            </>
          ) : null}
        </Card>

        <Card>
          <SectionTitle eyebrow="Client" title="Browser-side self-tests" />
          {client.length === 0 ? <p className="text-[0.85rem] text-[var(--color-muted)]">Not run yet.</p> : null}
          <ul className="space-y-1.5">
            {client.map((c) => (
              <li key={c.name} className="flex items-start gap-2 text-[0.82rem]">
                <span className={c.ok ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"} aria-hidden>
                  {c.ok ? "✓" : "✗"}
                </span>
                <span className="min-w-0">
                  <span className="font-mono">{c.name}</span>
                  {c.error ? <span className="block text-[var(--color-muted)]">{c.error}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {report?.summary?.failing?.length ? <Trace checks={[...report.summary.failing, ...clientFailing] as never} label="failing checks across server + client" open /> : <Trace checks={clientFailing as never} label="failing client checks" />}
        </Card>
      </div>

      <Card>
        <SectionTitle eyebrow="How to read this" title="What a red check means for you" />
        <ul className="list-disc space-y-1.5 pl-5 text-[0.86rem]">
          <li>
            <span className="font-semibold">groq.config / GROQ_API_KEY</span> — the server has no key. Rotate and set it in Vercel; without it nothing can be analysed.
          </li>
          <li>
            <span className="font-semibold">firebaseAdmin / db</span> — the app still works, but history stays on the device only and follow-up chats are not saved.
          </li>
          <li>
            <span className="font-semibold">groq.vision</span> — photo input is refused with a clear message; text still works.
          </li>
          <li>
            <span className="font-semibold">corpus awaiting verification</span> — the citations carry a <span aria-hidden>?</span> chip. Run the verify script and read the sections before you trust a letter.
          </li>
        </ul>
      </Card>
    </div>
  );
}
