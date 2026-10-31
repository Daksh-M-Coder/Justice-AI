"use client";

import { useEffect, useState } from "react";
import { Navbar, type TabKey } from "./Navbar";
import { AnalyseTab } from "./tabs/AnalyseTab";
import { RtiTab } from "./tabs/RtiTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { PrecedentsTab } from "./tabs/PrecedentsTab";
import { HelpTab } from "./tabs/HelpTab";
import { DetectorTab } from "./tabs/DetectorTab";
import { SourcesTab } from "./tabs/SourcesTab";
import { VitalsTab } from "./tabs/VitalsTab";
import { useI18n } from "@/lib/i18n";
import { track } from "@/lib/diag";
import { Disclaimer } from "./ui";

/** Tabs are mirrored in the URL so a phone reload lands where the user left off. */
function readTab(): TabKey {
  const q = new URLSearchParams(window.location.search).get("tab");
  const valid: TabKey[] = ["analyse", "rti", "history", "precedents", "help", "detector", "sources", "vitals"];
  return valid.includes(q as TabKey) ? (q as TabKey) : "analyse";
}

export function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("analyse");
  const [nonce, setNonce] = useState(0);
  // Lazy initialiser rather than a setState inside the effect: navigator.onLine is true during
  // SSR-adjacent first render on every real browser, so server and client markup agree.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  // The PWA shell deliberately opens without a connection (a court corridor, a lift), so the
  // user must be told the difference instead of watching a submit fail with no explanation.
  useEffect(() => {
    // trust the event, and use navigator.onLine only for the initial state: a handler that
    // re-reads navigator.onLine cannot react to an "offline" event at all
    const off = () => setOnline(false);
    const on = () => setOnline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const initial = readTab();
    setTab(initial);
    const p = track("app.mount", { is_working: true });
    p.check("service worker registration attempted", true, "see sw.js registration below");
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => p.check("service worker registered", false, "the browser refused to register the PWA worker"));
    }
  }, []);

  const go = (next: TabKey) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    history.replaceState(null, "", url.toString());
  };

  return (
    <div className="min-h-dvh">
      <Navbar tab={tab} onTab={go} />
      {!online ? (
        <p className="border-b border-[color:var(--color-warn)] bg-[var(--color-brand-soft)] px-4 py-2 text-center text-[0.78rem] font-semibold text-[var(--color-warn)]">
          You are offline. Saved cases and letters still open; anything that needs the assistant will wait for a connection.
        </p>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        {tab === "analyse" ? <AnalyseTab onCaseSaved={() => setNonce((n) => n + 1)} /> : null}
        {tab === "rti" ? <RtiTab /> : null}
        {tab === "history" ? <HistoryTab key={nonce} /> : null}
        {tab === "precedents" ? <PrecedentsTab /> : null}
        {tab === "help" ? <HelpTab /> : null}
        {tab === "detector" ? <DetectorTab /> : null}
        {tab === "sources" ? <SourcesTab /> : null}
        {tab === "vitals" ? <VitalsTab /> : null}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2 no-print">
        <Disclaimer text={t("disclaimer")} />
        <p className="mt-3 text-[0.72rem] text-[var(--color-muted)]">
          JusticeAI · Next.js App Router · Groq (openai/gpt-oss) · Firebase Auth + Firestore · law text from India Code (verification status shown on every citation) ·{" "}
          <button className="underline" onClick={() => go("vitals")}>
            system vitals
          </button>
        </p>
      </footer>
    </div>
  );
}
