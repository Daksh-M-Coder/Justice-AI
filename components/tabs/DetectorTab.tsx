"use client";

/** Fake-notice / scam detector (legacy tab, rebuilt on the real /api/detect endpoint). */
import { useState } from "react";
import { detect as apiDetect } from "@/lib/apiClient";
import { compressImage } from "@/lib/browser";
import { useI18n } from "@/lib/i18n";
import { useWorkMode } from "@/lib/providers";
import type { DetectionResult } from "@/lib/types";
import { Badge, Btn, Card, Disclaimer, SectionTitle, SkeletonBlock, Trace } from "@/components/ui";

/** Plain-language renderings of the machine enums. "LikelyFraud" / "mismatch" are answers for
 *  the schema, not sentences a person in a police-station corridor should have to decode. */
const VERDICT_LABEL: Record<string, string> = {
  LikelyGenuine: "Looks like a real notice",
  Suspicious: "Needs checking before you act",
  LikelyFraud: "Has the marks of a fraud",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "matches a real notice",
  mismatch: "does not match",
  unknown: "cannot confirm",
};

export function DetectorTab() {
  const { t } = useI18n();
  const { working } = useWorkMode();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [checks, setChecks] = useState<unknown[]>([]);

  const run = async () => {
    if (text.trim().length < 10 && !image) {
      setError("Paste at least a sentence of the notice, or attach a photo.");
      return;
    }
    setError(null);
    setBusy(true);
    setResult(null);
    const r = await apiDetect({ text: text.trim(), ...(image ? { imageBase64: image } : {}) }, { is_working: working });
    setBusy(false);
    setChecks(r.data?.checks ?? []);
    if (!r.ok || !r.data?.data) {
      setError(r.error ?? "The check could not be completed.");
      return;
    }
    setResult(r.data.data as DetectionResult);
  };

  const tone = (v: string) => (v === "LikelyFraud" ? "danger" : v === "Suspicious" ? "warn" : "ok");

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle eyebrow={t("detector.title")} title="Is this notice real or a fraud?" sub={t("detector.sub")} />
        <textarea className="field min-h-[10rem] resize-y leading-relaxed" maxLength={8000} value={text} placeholder={t("detector.ph")} onChange={(e) => setText(e.target.value)} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn onClick={run} disabled={busy}>
            {busy ? "Checking…" : working ? "run the check (self-test)" : t("detector.title")}
          </Btn>
          <label className="btn btn-ghost cursor-pointer">
            📎 {t("btn.attach")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const r = await compressImage(f, 1000, { is_working: true });
                if (r.data) setImage(r.data.dataUrl);
                else setError(r.error ?? "Photo unusable");
              }}
            />
          </label>
          {image ? <Badge tone="gold">photo attached</Badge> : null}
          {error ? <span className="text-[0.8rem] font-semibold text-[var(--color-danger)]">{error}</span> : null}
        </div>
        <p className="mt-2 text-[0.74rem] text-[var(--color-muted)]">
          A photo is only read if this deployment has an active vision model. Without one, the text you paste is what gets checked — and that is stated in the result.
        </p>
      </Card>

      {busy ? (
        <Card>
          <SkeletonBlock />
        </Card>
      ) : null}

      {result ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone(result.verdict)}>{VERDICT_LABEL[result.verdict] ?? result.verdict}</Badge>
            {/* a 0 confidence beside a red badge read as "0% sure, and it is fraud" - the model
                simply did not state one, so say nothing rather than contradict the badge */}
            {result.confidence > 0 ? <span className="text-[0.78rem] text-[var(--color-muted)]">model confidence {Math.round(result.confidence * 100)}%</span> : null}
            {result.law ? <span className="chip border">{result.law}</span> : null}
          </div>

          {result.red_flags.length ? (
            <ul className="mt-3 space-y-1.5">
              {result.red_flags.map((f, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-[var(--color-brand-soft)] px-3 py-2 text-[0.86rem]">
                  <span className="text-[var(--color-danger)]" aria-hidden>
                    ⚠
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[0.86rem] text-[var(--color-ink-soft)]">No obvious red flags found in the text you pasted. That is not proof it is genuine.</p>
          )}

          {result.checks.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">Point by point</h3>
              <ul className="space-y-1.5">
                {result.checks.map((c, i) => (
                  <li key={i} className="flex flex-wrap gap-2 text-[0.84rem]">
                    <Badge tone={c.status === "ok" ? "ok" : c.status === "mismatch" ? "danger" : "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                    <span>{c.claim}</span>
                    {c.note ? <span className="text-[var(--color-muted)]">— {c.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.what_to_do.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">What to do</h3>
              <ol className="list-decimal space-y-1 pl-5 text-[0.86rem]">
                {result.what_to_do.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="mt-4">
            <Disclaimer text="This is a heuristic check on the text you provided. Never pay money because of a message, and never ignore a notice you have only checked here - confirm it at the issuing office counter or on the department's own portal." />
          </div>
          {checks.length ? <Trace checks={checks as never} label="detector self-test" /> : null}
        </Card>
      ) : null}
    </div>
  );
}
