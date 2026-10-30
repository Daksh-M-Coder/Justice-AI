"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nProvider } from "./i18n";
import { setWorkMode, workModeEnabled } from "./apiClient";
import { selfTest as firebaseSelfTest, watchSession, type SessionUser } from "./firebaseClient";
import { track, type WorkResult } from "./diag";

/* ── theme (plan step 26) ────────────────────────────────────────────────── */

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

function applyTheme(t: Theme): WorkResult<Theme> {
  const p = track<Theme>("theme.apply", { is_working: false });
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("justiceai_theme", t);
    p.check(`data-theme=${t} written to <html>`, document.documentElement.dataset.theme === t);
  }
  return p.done(t);
}

export function useTheme() {
  return useContext(ThemeCtx);
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem("justiceai_theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const next: Theme = saved === "dark" || (!saved && prefersDark) ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

/* ── auth ────────────────────────────────────────────────────────────────── */

interface AuthValue {
  user: SessionUser | null;
  ready: boolean;
  configured: boolean;
  signOutNow: () => Promise<void>;
}
const AuthCtx = createContext<AuthValue>({ user: null, ready: false, configured: true, signOutNow: async () => {} });
export function useAuth() {
  return useContext(AuthCtx);
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    void firebaseSelfTest({ is_working: true }).then((r) => setConfigured(!!r.data?.configured));
    const stop = watchSession((u) => {
      setUser(u);
      setReady(true);
    });
    const timer = setTimeout(() => setReady(true), 2500); // never leave the UI hanging on a slow SDK
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      configured,
      signOutNow: async () => {
        const { signOut } = await import("./firebaseClient");
        await signOut({ is_working: false });
        setUser(null);
      },
    }),
    [user, ready, configured],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ── is_working switch (drives every client call) ─────────────────────────── */

const WorkCtx = createContext<{ working: boolean; set: (v: boolean) => void }>({ working: false, set: () => {} });
export function useWorkMode() {
  return useContext(WorkCtx);
}

function WorkModeProvider({ children }: { children: ReactNode }) {
  const [working, setWorking] = useState(false);
  useEffect(() => setWorking(workModeEnabled()), []);
  const set = useCallback((v: boolean) => {
    setWorking(v);
    setWorkMode(v);
  }, []);
  return <WorkCtx.Provider value={{ working, set }}>{children}</WorkCtx.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <WorkModeProvider>{children}</WorkModeProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
