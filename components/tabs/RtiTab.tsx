"use client";

/**
 * RTI tab (plan step 28): draft the application, then keep the statutory clocks for
 * each filing you actually sent. The tracker is local to the device and states exactly
 * which section each clock comes from.
 */
import { useEffect, useMemo, useState } from "react";
import { analyze as apiAnalyze, casesApi } from "@/lib/apiClient";
import { readProfile, saveProfile } from "@/lib/guestStore";
import { useAuth, useWorkMode } from "@/lib/providers";
import { useI18n } from "@/lib/i18n";
import type { AnalyzeResponse } from "@/lib/types";
import { Badge, Btn, Card, Disclaimer, SectionTitle, SkeletonBlock, Trace } from "@/components/ui";
import { ResultView } from "@/components/ResultView";

interface Filing {
  id: string;
  authority: string;
  subject: string;
  filedOn: number;
}

const KEY = "justiceai_rti_filings";

const DAY = 86_400_000;

/** English fallbacks for the applicant fields. The real labels come from the locale
 *  dictionary (field.*), so a missing translation degrades to English, never to "pin". */
const FIELD_LABELS: Record<string, string> = {
  name: "Full name",
  address: "Address",
  city: "City",
  state: "State",
  pin: "PIN code",
  phone: "Phone",
};

export function RtiTab() {
  const { t, tOr, lang } = useI18n();
  const { working } = useWorkMode();
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [checks, setChecks] = useState<unknown[]>([]);
  const [profile, setProfile] = useState({ name: "", address: "", city: "", state: "", pin: "", phone: "" });
  const [filings, setFilings] = useState<Filing[]>([]);
  const [authority, setAuthority] = useState("");

  useEffect(() => {
    const local = readProfile({ is_working: true }).data ?? {};
    setProfile((p) => ({ ...p, ...local }));
    try {
      setFilings(JSON.parse(localStorage.getItem(KEY) ?? "[]") as Filing[]);
    } catch {
      setFilings([]);
    }
    if (user) {
      void casesApi.profile.get({ is_working: true }).then((r) => {
        if (r.data?.data) setProfile((p) => ({ ...p, ...(r.data!.data as typeof p) }));
      });
    }
  }, [user]);

  const persistProfile = () => {
    saveProfile(profile, { is_working: working });
    if (user) void casesApi.profile.save(profile, { is_working: working });
  };

  const generate = async () => {
    if (subject.trim().length < 12) {
      setError(t("err.empty"));
      return;
    }
    setError(null);
    setBusy(true);
    setResult(null);
    const res = await apiAnalyze({ problem: subject.trim(), lang, category: "RTI", city: profile.city, applicant: profile });
    setBusy(false);
    setChecks(res.data?.checks ?? []);
    if (!res.ok || !res.data?.data) {
      setError(res.error ?? "The RTI could not be drafted.");
      return;
    }
    setResult(res.data.data as AnalyzeResponse);
    setCaseId(typeof res.data.caseId === "string" ? res.data.caseId : `rti${Date.now().toString(36)}`);
  };

  const addFiling = () => {
    if (!authority.trim() || !subject.trim()) {
      setError("Name the public authority and the subject before you start tracking.");
      return;
    }
    const next = [{ id: `f${Date.now().toString(36)}`, authority: authority.trim(), subject: subject.trim().slice(0, 200), filedOn: Date.now() }, ...filings].slice(0, 60);
    setFilings(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    setError(null);
  };

  const removeFiling = (id: string) => {
    const next = filings.filter((f) => f.id !== id);
    setFilings(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  const clocks = useMemo(
    () => (f: Filing) => [
      { label: "PIO reply due (RTI Act §7(1))", at: f.filedOn + 30 * DAY },
      { label: "First appeal window closes (§12/§19(1))", at: f.filedOn + 60 * DAY },
      { label: "Second appeal window closes (§19(3))", at: f.filedOn + 150 * DAY },
    ],
    [],
  );

  // `now` must come from state, not Date.now() in the render body: a render function that
  // reads the clock produces different markup on server and client (hydration mismatch).
  // 0 means "not mounted yet" - the filing list is empty until then anyway.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle eyebrow={t("rti.title")} title="Draft an RTI application" sub={t("rti.sub")} />
        <label className="block">
          <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">What information do you want?</span>
          <textarea
            className="field min-h-[8rem] resize-y leading-relaxed"
            value={subject}
            maxLength={3000}
            placeholder={t("ph.rti")}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>

        <details className="mt-3 rounded-xl border border-[color:var(--color-line)] p-3">
          <summary className="cursor-pointer text-[0.82rem] font-semibold">Applicant details (used to fill the letter — saved on this device{user ? " and in your account" : ""})</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(Object.keys(profile) as (keyof typeof profile)[]).map((k) => (
              <label key={k} className="block">
                {/* the object key was rendered straight as the label, so every language showed
                    "name" / "address" / "pin" - now a translated label with a safe fallback */}
                <span className="mb-1 block text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{tOr(`field.${k}`, FIELD_LABELS[k] ?? k)}</span>
                <input
                  className="field"
                  value={profile[k]}
                  maxLength={k === "address" ? 300 : 120}
                  onChange={(e) => setProfile((p) => ({ ...p, [k]: e.target.value }))}
                  onBlur={persistProfile}
                />
              </label>
            ))}
          </div>
        </details>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn onClick={generate} disabled={busy}>
            {busy ? t("btn.analysing") : working ? `${t("btn.rti")} · self-test` : t("btn.rti")}
          </Btn>
          {error ? <p className="text-[0.8rem] font-semibold text-[var(--color-danger)]">{error}</p> : null}
        </div>
        <div className="mt-4">
          <Disclaimer />
        </div>
      </Card>

      {busy ? (
        <Card>
          <SkeletonBlock />
        </Card>
      ) : null}

      {result && caseId ? <ResultView data={result} caseId={caseId} checks={checks} /> : null}

      <Card>
        <SectionTitle eyebrow="RTI tracker" title="Track the filings you have actually sent" sub="Enter the date you posted each application; the clocks below are the statutory periods, counted from that date." />
        <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
          <input className="field" placeholder="Public authority (e.g. BMC Water Department)" value={authority} onChange={(e) => setAuthority(e.target.value)} />
          <input className="field" placeholder="Subject of this RTI" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Btn onClick={addFiling} kind="ghost">
            Add filing
          </Btn>
        </div>

        <ul className="mt-4 space-y-3">
          {filings.length === 0 ? <li className="text-[0.85rem] text-[var(--color-muted)]">No filings tracked yet.</li> : null}
          {filings.map((f) => (
            <li key={f.id} className="rounded-xl border border-[color:var(--color-line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{f.authority}</span>
                <span className="text-[0.78rem] text-[var(--color-muted)]">{new Date(f.filedOn).toLocaleDateString("en-IN")}</span>
                <button className="ml-auto text-[0.76rem] text-[var(--color-danger)]" onClick={() => removeFiling(f.id)}>
                  remove
                </button>
              </div>
              <p className="mt-1 text-[0.84rem] text-[var(--color-ink-soft)]">{f.subject}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {clocks(f).map((c) => {
                  const left = c.at - now;
                  return (
                    <Badge key={c.label} tone={left < 0 ? "danger" : left < 5 * DAY ? "warn" : "ok"}>
                      {c.label}: {left < 0 ? `passed ${Math.round(-left / DAY)}d ago` : `${Math.round(left / DAY)}d left`}
                    </Badge>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {checks.length ? <Trace checks={checks as never} label="server self-test" /> : null}
    </div>
  );
}
