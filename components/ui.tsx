"use client";

import type { ReactNode } from "react";
import type { WorkCheck } from "@/lib/diag";
import { useI18n } from "@/lib/i18n";

/**
 * The shared primitives. Server/model/user text is always rendered as React children -
 * never innerHTML - which is what removes the legacy XSS surface (plan step 32).
 */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 md:p-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <header className="mb-5">
      {eyebrow ? <p className="mb-1 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--color-muted)]">{eyebrow}</p> : null}
      <h2 className="text-2xl leading-tight md:text-[1.7rem]">{title}</h2>
      {sub ? <p className="mt-2 max-w-3xl text-[0.92rem] leading-relaxed text-[var(--color-ink-soft)]">{sub}</p> : null}
    </header>
  );
}

export function Btn({
  children,
  onClick,
  kind = "primary",
  disabled,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={`btn ${kind === "primary" ? "btn-primary" : "btn-ghost"} ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "danger" | "gold"; title?: string }) {
  const map: Record<string, string> = {
    neutral: "text-[var(--color-ink-soft)] border-[color:var(--color-line)] bg-[var(--color-brand-soft)]",
    ok: "text-[var(--color-ok)] border-[color:var(--color-ok)]",
    warn: "text-[var(--color-warn)] border-[color:var(--color-warn)]",
    danger: "text-[var(--color-danger)] border-[color:var(--color-danger)]",
    gold: "text-[var(--color-gold)] border-[color:var(--color-gold)]",
  };
  return (
    <span className={`chip border ${map[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</span>
      <input
        className="field"
        type={type}
        value={value}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * A citation chip: links out to the official source, and says out loud when the
 * section has not been verified against India Code yet (plan step 19 + 20).
 */
export function CitationChip({ act, section, verified, source_url, title, act_level }: { act: string; section: string; verified: boolean; source_url: string; title?: string; act_level?: boolean }) {
  // "§act-level" is noise; say what it actually is - the whole Act, usually state law
  const short = act.replace(/,.*/, "");
  const numbered = /^[0-9(]/.test(section); // "38", "2(11)" get the section sign; "Rule 3" does not
  const label = act_level ? `${short} (whole Act)` : numbered ? `${short} §${section}` : `${short} ${section}`;
  const inner = (
    <span className="chip" title={`${act} section ${section}${title ? ` - ${title}` : ""}`}>
      {label}
      <span className={verified ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"} aria-hidden>
        {verified ? "✓" : "?"}
      </span>
    </span>
  );
  return source_url ? (
    <a href={source_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

/** Renders the is_working trace. Collapsed by default; the Vitals tab expands it. */
export function Trace({ checks, label = "what happened", open = false }: { checks: WorkCheck[]; label?: string; open?: boolean }) {
  if (!checks?.length) return null;
  const failed = checks.filter((c) => !c.ok);
  return (
    <details open={open} className="mt-4 rounded-xl border border-[color:var(--color-line)] bg-[var(--color-card)] p-3">
      <summary className="cursor-pointer select-none text-[0.76rem] font-semibold text-[var(--color-muted)]">
        {label} · {checks.length} checks
        {failed.length ? <span className="ml-2 text-[var(--color-danger)]">{failed.length} failed</span> : <span className="ml-2 text-[var(--color-ok)]">all passed</span>}
      </summary>
      <ul className="mt-2 space-y-1">
        {checks.map((c, i) => (
          <li key={`${c.fn}-${i}`} className="flex flex-wrap gap-x-2 text-[0.72rem] leading-relaxed">
            <span className={c.ok ? "text-[var(--color-ok)]" : "text-[var(--color-danger)]"} aria-hidden>
              {c.skipped ? "○" : c.ok ? "✓" : "✗"}
            </span>
            <span className="font-mono text-[var(--color-muted)]">{c.fn}</span>
            <span className="text-[var(--color-ink-soft)]">{c.name}</span>
            {c.detail ? <span className="text-[var(--color-muted)]">— {c.detail}</span> : null}
            {c.ms > 0 ? <span className="text-[var(--color-muted)]">({c.ms}ms)</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Disclaimer({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <p className="rounded-lg border border-dashed border-[color:var(--color-warn)] px-3 py-2 text-[0.74rem] leading-relaxed text-[var(--color-warn)]">
      {text ?? t("disclaimer")}
    </p>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--color-line)] p-6 text-center">
      <p className="font-semibold">{title}</p>
      {body ? <p className="mt-1 text-[0.85rem] text-[var(--color-muted)]">{body}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-[0.85rem] text-[var(--color-muted)]">
      <span className="h-2 w-2 animate-ping rounded-full bg-[var(--color-brand)]" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonBlock() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="skeleton w-2/3" />
      <div className="skeleton" />
      <div className="skeleton w-5/6" />
      <div className="skeleton w-1/3" />
    </div>
  );
}
