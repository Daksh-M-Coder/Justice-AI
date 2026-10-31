"use client";

/**
 * Analyse tab: the main flow (plan step 27). Text, photo, dictation in -> a verified,
 * cited, deadline-bearing result out. Guest and signed-in paths are both handled; the
 * only difference is where the case is stored.
 */
import { useCallback, useRef, useState } from "react";
import { analyze as apiAnalyze } from "@/lib/apiClient";
import { CATEGORY_VALUES } from "@/lib/schema";
import { saveCase } from "@/lib/guestStore";
import { compressImage, speechRecognitionSupported, startDictation } from "@/lib/browser";
import { useI18n } from "@/lib/i18n";
import { useAuth, useWorkMode } from "@/lib/providers";
import type { AnalyzeResponse } from "@/lib/types";
import { Badge, Btn, Card, Disclaimer, SectionTitle, SkeletonBlock, Trace } from "@/components/ui";
import { ChatPanel, ResultView } from "@/components/ResultView";

/** One source of truth: the same enum the API validates against. */
export const CATEGORIES = CATEGORY_VALUES;

export function AnalyseTab({ onCaseSaved }: { onCaseSaved?: () => void }) {
  const { t, lang, speechLocale } = useI18n();
  const { working } = useWorkMode();
  const { user } = useAuth();
  const [problem, setProblem] = useState("");
  const [category, setCategory] = useState<string>("Consumer");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [checks, setChecks] = useState<unknown[]>([]);
  const [quota, setQuota] = useState<{ remaining: number; limit: number } | null>(null);
  const [listening, setListening] = useState(false);
  const dictRef = useRef<{ stop: () => void } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImage = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const r = await compressImage(file, 1200, { is_working: working });
      if (r.data) {
        setImage(r.data.dataUrl);
        setImageNote(`Photo ready (${Math.round(r.data.bytes / 1024)} KB). Whether it is actually read depends on a vision model being available.`);
      } else {
        setImage(null);
        setImageNote(r.error ?? "That photo could not be used.");
      }
    },
    [working],
  );

  const dictate = () => {
    const supported = speechRecognitionSupported({ is_working: working });
    if (!supported.data) {
      setError("This browser cannot dictate. Please type instead.");
      return;
    }
    if (listening) {
      dictRef.current?.stop();
      setListening(false);
      return;
    }
    const r = startDictation(speechLocale, (text) => setProblem(text), { is_working: working });
    if (r.data) {
      dictRef.current = r.data;
      setListening(true);
      setError(null);
    } else setError(r.error ?? "Dictation unavailable");
  };

  const submit = async () => {
    // Two different messages: an empty box and a 5-word box need different hints. Saying
    // "describe what happened first" to someone who wrote 11 characters is just confusing.
    if (!problem.trim()) {
      setError(t("err.empty"));
      return;
    }
    if (problem.trim().length < 12) {
      setError(t("err.tooshort"));
      return;
    }
    setError(null);
    setBusy(true);
    setResult(null);
    const res = await apiAnalyze({
      problem: problem.trim(),
      lang,
      category,
      city,
      pincode,
      ...(image ? { imageBase64: image } : {}),
    });
    setBusy(false);
    setChecks(res.data?.checks ?? []);
    if (!res.ok || !res.data?.data) {
      setError(res.error ?? "Something went wrong. Try again in a minute.");
      return;
    }
    const payload = res.data.data as AnalyzeResponse;
    setResult(payload);
    setCaseId(typeof res.data.caseId === "string" ? res.data.caseId : `local${Date.now().toString(36)}`);
    const q = res.data.quota as { remaining: number; limit: number } | undefined;
    if (q) setQuota(q);

    // guests keep the case locally; signed-in cases are already in Firestore (plan step 13)
    if (!user && !working && caseId) {
      saveCase({
        id: caseId,
        problem: problem.trim(),
        category,
        lang,
        city,
        status: "open",
        createdAt: Date.now(),
        result: payload,
        guest: true,
      });
    }
    onCaseSaved?.();
  };

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle eyebrow={t("app.step1")} title={t("app.hero")} sub={t("app.sub")} />

        <div className="mb-4 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              title={c}
              // without this the selected chip is invisible to a screen reader: the only
              // signal was a background colour
              aria-pressed={category === c}
              type="button"
              className={`rounded-full border px-3 py-1 text-[0.78rem] font-semibold transition ${
                category === c ? "border-[color:var(--color-brand)] bg-[var(--color-brand)] text-white dark:text-[var(--color-paper)]" : "border-[color:var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-brand-soft)]"
              }`}
            >
              {t(`cat.${c}`)}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{t("lbl.problem")}</span>
          <textarea
            className="field min-h-[9rem] resize-y leading-relaxed"
            value={problem}
            maxLength={4000}
            placeholder={t("ph.problem")}
            onChange={(e) => {
              setProblem(e.target.value);
              // the validation message used to sit there even after the user fixed the text
              if (error === t("err.empty") || error === t("err.tooshort")) setError(null);
            }}
          />
          <span className="mt-1 flex items-center justify-between text-[0.7rem] text-[var(--color-muted)]">
            <span>{problem.length} / 4000</span>
            <span>{listening ? "listening…" : ""}</span>
          </span>
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{t("lbl.city")}</span>
            <input className="field" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} placeholder="Pune" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{t("lbl.pincode")}</span>
            <input className="field" value={pincode} maxLength={6} inputMode="numeric" onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} placeholder="411001" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* Test mode must keep the button LIVE: the point of is_working is to exercise the
              whole UI path against a fixture. Disabling it here made the result view
              unreachable exactly when the checklist said to use it. */}
          <Btn onClick={submit} disabled={busy}>
            {busy ? t("btn.analysing") : working ? `${t("btn.analyse")} · self-test` : t("btn.analyse")}
          </Btn>
          <Btn kind="ghost" onClick={dictate} title="Voice input">
            🎙 {listening ? t("btn.stop") : t("btn.listen")}
          </Btn>
          <Btn kind="ghost" onClick={() => fileRef.current?.click()}>
            📎 {t("btn.attach")}
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              void pickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {image ? (
            <Btn
              kind="ghost"
              onClick={() => {
                setImage(null);
                setImageNote(null);
              }}
            >
              ✕ {t("btn.clearImage")}
            </Btn>
          ) : null}
          {quota ? (
            <Badge tone={quota.remaining > 0 ? "ok" : "danger"}>
              {quota.remaining} {t("quota.left")}
            </Badge>
          ) : null}
        </div>

        {imageNote ? <p className="mt-2 text-[0.78rem] text-[var(--color-muted)]">{imageNote}</p> : null}
        {error ? <p className="mt-2 text-[0.82rem] font-semibold text-[var(--color-danger)]">{error}</p> : null}
        <div className="mt-4">
          <Disclaimer />
        </div>
      </Card>

      {busy ? (
        <Card>
          <SkeletonBlock />
        </Card>
      ) : null}

      {result && caseId ? (
        <>
          <ResultView data={result} caseId={caseId} checks={checks} />
          <ChatPanel caseId={caseId} category={category} caseContext={`${category} case: ${result.analysis?.law ?? "RTI"}\n\n${(result.analysis?.letter ?? result.rti?.letter ?? "").slice(0, 1200)}`} />
          <Trace checks={checks as never} label="full server self-test" />
        </>
      ) : null}
    </div>
  );
}
