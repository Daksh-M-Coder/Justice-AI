"use client";

/**
 * Case History (plan steps 29 + 36): Firestore for signed-in users, localStorage for
 * guests, and a one-click move of the guest cases into the account (plan step 15).
 */
import { useCallback, useEffect, useState } from "react";
import { casesApi } from "@/lib/apiClient";
import { exportForMigration, listCases as listLocal, removeCase as removeLocal, saveCase as saveLocal, type StoredCase } from "@/lib/guestStore";
import { useAuth, useWorkMode } from "@/lib/providers";
import { useI18n } from "@/lib/i18n";
import type { AnalyzeResponse, CaseListItem } from "@/lib/types";
import { Badge, Btn, Card, Empty, SectionTitle, Trace } from "@/components/ui";
import { ChatPanel, Deadlines, ResultView } from "@/components/ResultView";

const STATUSES = ["open", "filed", "waiting", "resolved", "saved"] as const;

function hydrateLocal(c: StoredCase): CaseListItem {
  return { id: c.id, problem: c.problem, category: c.category, status: c.status, createdAt: c.createdAt, lang: c.lang, city: c.city, result: (c.result as AnalyzeResponse) ?? null, guest: true };
}

export function HistoryTab() {
  const { t, tOr } = useI18n();
  const { working } = useWorkMode();
  const { user } = useAuth();
  const [rows, setRows] = useState<CaseListItem[]>([]);
  const [open, setOpen] = useState<CaseListItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checks, setChecks] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const local = (listLocal({ is_working: true }).data ?? []).map(hydrateLocal);
    if (!user) {
      setRows(local);
      setLoading(false);
      return;
    }
    const r = await casesApi.list({ is_working: true });
    const server: CaseListItem[] = ((r.data?.data as CaseListItem[] | undefined) ?? []).map((c) => ({
      ...c,
      result: ((c as { analysis?: AnalyzeResponse }).analysis as AnalyzeResponse) ?? null,
    }));
    const seen = new Set(server.map((s) => s.id));
    setRows([...server, ...local.filter((l) => !seen.has(l.id))]);
    setChecks(r.data?.checks ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const migrate = async () => {
    const payload = exportForMigration({ is_working: working }).data ?? [];
    if (!payload.length) {
      setNote("Nothing to move - your guest history on this browser is empty.");
      return;
    }
    const r = await casesApi.migrate(payload, { is_working: working });
    setNote(r.ok ? `Moved ${payload.length} guest case(s) into your account.` : r.error ?? "The move failed.");
    if (r.ok) {
      payload.forEach((p) => removeLocal(p.id, { is_working: true }));
      void load();
    }
    setChecks(r.data?.checks ?? r.checks);
  };

  const setStatus = async (row: CaseListItem, status: string) => {
    if (row.guest || !user) {
      const existing = (listLocal({ is_working: true }).data ?? []).find((c) => c.id === row.id);
      if (existing) saveLocal({ ...existing, status, updatedAt: Date.now() }, { is_working: working });
      setOpen(null);
      setNote("Status saved on this device.");
      void load();
      return;
    }
    const r = await casesApi.patch(row.id, { status }, { is_working: working });
    setNote(r.ok ? `Status set to ${status}.` : r.error ?? "Could not update the status.");
    void load();
  };

  const remove = async (row: CaseListItem) => {
    if (row.guest || !user) {
      removeLocal(row.id, { is_working: working });
    } else {
      await casesApi.remove(row.id, { is_working: working });
    }
    setOpen(null);
    void load();
  };

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle
          eyebrow={t("history.title")}
          title={user ? "Your cases, synced" : "Cases on this device"}
          sub={user ? "Stored under your account in Firestore. Opening a case also starts the follow-up chat from where you left off." : t("history.guest")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn kind="ghost" onClick={() => void load()} disabled={loading}>
            ↻ Refresh
          </Btn>
          {user ? (
            <Btn kind="ghost" onClick={() => void migrate()} title="Plan step 15">
              {t("history.migrate")}
            </Btn>
          ) : null}
          {note ? <span className="text-[0.8rem] text-[var(--color-ink-soft)]">{note}</span> : null}
        </div>
      </Card>

      {rows.length === 0 && !loading ? (
        <Card>
          <Empty title={t("history.empty")} body="Analyse a case and it appears here." />
        </Card>
      ) : null}

      <div className="grid gap-3">
        {rows.map((r) => {
          const res = r.result;
          const nextDeadline = res?.guidance?.deadlines?.filter((d) => !d.lapsed)[0];
          return (
            <Card key={r.id} className="!p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.problem}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.76rem] text-[var(--color-muted)]">
                    <Badge title={r.category}>{tOr(`cat.${r.category}`, r.category)}</Badge>
                    <Badge tone={r.status === "resolved" ? "ok" : r.status === "filed" ? "gold" : "neutral"}>{tOr(`history.status.${r.status}`, r.status)}</Badge>
                    {r.guest ? <Badge tone="warn">device only</Badge> : <Badge tone="ok">in your account</Badge>}
                    <span>{new Date(r.createdAt).toLocaleDateString("en-IN")}</span>
                    {nextDeadline ? <span>· next clock: {nextDeadline.label}</span> : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Btn kind="ghost" onClick={() => setOpen(open?.id === r.id ? null : r)}>
                    {open?.id === r.id ? "Close" : "Open"}
                  </Btn>
                  <Btn kind="ghost" onClick={() => void remove(r)} title="Delete">
                    ✕
                  </Btn>
                </div>
              </div>

              {open?.id === r.id ? (
                <div className="mt-4 space-y-4 border-t border-[color:var(--color-line)] pt-4">
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => void setStatus(r, s)}
                        className={`rounded-full border px-3 py-1 text-[0.75rem] font-semibold ${r.status === s ? "border-[color:var(--color-brand)] bg-[var(--color-brand)] text-white dark:text-[var(--color-paper)]" : "border-[color:var(--color-line)]"}`}
                      >
                        {t(`history.status.${s}`)}
                      </button>
                    ))}
                  </div>

                  {res ? (
                    <>
                      <ResultView data={res} caseId={r.id} />
                      <ChatPanel caseId={r.id} category={r.category} caseContext={`${r.category}: ${r.problem}\n\n${res.analysis?.letter ?? res.rti?.letter ?? ""}`.slice(0, 3000)} />
                    </>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-[0.84rem] text-[var(--color-muted)]">
                        This case has no stored analysis (it came from the legacy app or a device-only draft). The clocks below still apply to the category.
                      </p>
                      {r.createdAt ? <DeadlinesFallback createdAt={r.createdAt} /> : null}
                    </div>
                  )}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {checks.length ? <Trace checks={checks as never} label="Firestore read trace" /> : null}
    </div>
  );
}

/** When a case has no cached analysis we can still show the generic clocks for it. */
function DeadlinesFallback({ createdAt }: { createdAt: number }) {
  const [rows, setRows] = useState<AnalyzeResponse["guidance"]["deadlines"]>([]);
  useEffect(() => {
    void fetch(`/api/health?full=0`)
      .then(() => import("@/lib/guidance"))
      .then((g) => setRows(g.computeDeadlines("General", createdAt, { is_working: true }).data ?? []))
      .catch(() => setRows([]));
  }, [createdAt]);
  return rows.length ? <Deadlines rows={rows} /> : null;
}
