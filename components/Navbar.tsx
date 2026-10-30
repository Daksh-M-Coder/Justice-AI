"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth, useTheme, useWorkMode } from "@/lib/providers";
import { LANGS, useI18n } from "@/lib/i18n";
import { Btn } from "./ui";

export type TabKey = "analyse" | "rti" | "history" | "precedents" | "help" | "detector" | "sources" | "vitals";

export const TABS: { key: TabKey; labelKey: string; icon: string }[] = [
  { key: "analyse", labelKey: "nav.analyse", icon: "⚖️" },
  { key: "rti", labelKey: "nav.rti", icon: "📩" },
  { key: "history", labelKey: "nav.history", icon: "🗂" },
  { key: "precedents", labelKey: "nav.precedents", icon: "📚" },
  { key: "help", labelKey: "nav.aid", icon: "🤝" },
  { key: "detector", labelKey: "nav.detector", icon: "🔍" },
  { key: "sources", labelKey: "nav.sources", icon: "🏛" },
  { key: "vitals", labelKey: "nav.vitals", icon: "🩺" },
];

/**
 * The navbar is a client component; the theme flash is avoided by the inline script in
 * the root layout rather than by delaying the paint here.
 */
export function Navbar({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, ready, configured, signOutNow } = useAuth();
  const { working, set } = useWorkMode();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <nav className="sticky top-0 z-30 border-b border-[color:var(--color-line)] bg-[var(--color-card)]/95 backdrop-blur no-print">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <button className="flex items-center gap-2 text-left" onClick={() => onTab("analyse")} aria-label="JusticeAI home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-brand)] text-[1.05rem] text-white" aria-hidden>
            ⚖
          </span>
          <span className="hidden sm:block">
            <span className="serif block text-[1.05rem] font-bold leading-none">JusticeAI</span>
            <span className="block text-[0.66rem] tracking-wide text-[var(--color-muted)]">{t("app.tagline")}</span>
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* is_working switch: every call the app makes then runs in self-test mode */}
          <label
            className="hidden cursor-pointer items-center gap-1.5 rounded-lg border border-[color:var(--color-line)] px-2 py-1 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--color-muted)] md:flex"
            title="Self-test mode: no tokens are spent, no data is written"
          >
            <input type="checkbox" className="accent-[var(--color-brand)]" checked={working} onChange={(e) => set(e.target.checked)} />
            is_working
          </label>

          <select
            aria-label={t("lbl.lang")}
            className="field w-auto py-1 text-[0.78rem]"
            value={lang}
            onChange={(e) => setLang(e.target.value as (typeof LANGS)[number]["code"])}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </select>

          <button className="field w-auto px-2.5 py-1 text-[0.9rem]" onClick={toggle} aria-label="Toggle dark mode" title={theme === "dark" ? "Light" : "Dark"}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {ready && user ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-[9rem] truncate text-[0.74rem] text-[var(--color-muted)] lg:inline" title={user.email}>
                {user.name || user.email}
              </span>
              <Btn kind="ghost" onClick={() => void signOutNow()} className="!py-1 !text-[0.78rem]">
                {t("nav.logout")}
              </Btn>
            </div>
          ) : configured ? (
            <Link href="/login" className="btn btn-primary !py-1.5 !text-[0.78rem]">
              {t("nav.login")}
            </Link>
          ) : (
            <span className="chip border border-dashed" title="NEXT_PUBLIC_FIREBASE_* is not set - the app runs in guest mode">
              {t("nav.guest")}
            </span>
          )}

          <button className="field w-auto px-2.5 py-1 md:hidden" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>

      <div className={`${menu ? "flex" : "hidden"} mx-auto max-w-6xl flex-wrap gap-1 px-4 pb-3 md:flex`}>
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => {
              onTab(x.key);
              setMenu(false);
            }}
            className={`rounded-lg px-3 py-1.5 text-[0.8rem] font-semibold transition ${
              tab === x.key ? "bg-[var(--color-brand)] text-white dark:text-[var(--color-paper)]" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-brand-soft)]"
            }`}
          >
            <span aria-hidden className="mr-1">
              {x.icon}
            </span>
            {t(x.labelKey)}
          </button>
        ))}
      </div>
    </nav>
  );
}
