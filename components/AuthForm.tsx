"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn, signInWithGoogle, signUp } from "@/lib/firebaseClient";
import { casesApi } from "@/lib/apiClient";
import { exportForMigration } from "@/lib/guestStore";
import { useI18n } from "@/lib/i18n";
import { useWorkMode } from "@/lib/providers";
import { Btn, Card, Disclaimer, Field, SectionTitle, Trace } from "./ui";

/**
 * One form for both sign-in and sign-up. After a successful sign-up we offer to move the
 * guest cases sitting in this browser into the new account (plan step 15) - the user
 * triggers it, because silently uploading someone's notes is not acceptable.
 */
export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const { t } = useI18n();
  const { working } = useWorkMode();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState(false);
  const [trace, setTrace] = useState<unknown[]>([]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = mode === "signup" ? await signUp(email, password, name, { is_working: working }) : await signIn(email, password, { is_working: working });
    setBusy(false);
    setTrace(r.checks);
    if (!r.ok || !r.data) {
      setError(r.error ?? "That did not work.");
      return;
    }
    const guests = (exportForMigration({ is_working: true }).data ?? []).length;
    if (mode === "signup" && guests > 0) setOffer(true);
    else router.push("/?tab=history");
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    const r = await signInWithGoogle({ is_working: working });
    setBusy(false);
    setTrace(r.checks);
    if (!r.ok) setError(r.error ?? "Google sign-in failed.");
    else router.push("/?tab=history");
  };

  const migrate = async () => {
    const payload = exportForMigration({ is_working: working }).data ?? [];
    const r = await casesApi.migrate(payload, { is_working: working });
    setTrace([...(trace as never[]), ...(r.data?.checks ?? r.checks)]);
    router.push(r.ok ? "/?tab=history" : "/?tab=history");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card className="rise">
        <SectionTitle
          eyebrow={mode === "signup" ? t("nav.signup") : t("nav.login")}
          title={mode === "signup" ? "Create your JusticeAI account" : "Sign in to JusticeAI"}
          sub={
            mode === "signup"
              ? "Your cases, letters and follow-up chats are stored under your own uid in Firestore. Nobody else can read them - the rules enforce it."
              : "Sign in to sync the cases this device has, and to keep your letters after you clear the browser."
          }
        />

        <div className="space-y-3">
          {mode === "signup" ? <Field label="Name (used to fill letters)" value={name} onChange={setName} maxLength={120} placeholder="Asha Pawar" /> : null}
          <Field label="Email" type="email" value={email} onChange={setEmail} maxLength={200} placeholder="you@example.com" />
          <Field label="Password" type="password" value={password} onChange={setPassword} maxLength={64} placeholder={mode === "signup" ? "at least 8 characters" : ""} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Btn onClick={submit} disabled={busy || !email || !password}>
            {busy ? "Working…" : mode === "signup" ? t("nav.signup") : t("nav.login")}
          </Btn>
          <Btn kind="ghost" onClick={() => void google()} disabled={busy}>
            Google
          </Btn>
          <Link href={mode === "signup" ? "/login" : "/signup"} className="btn btn-ghost">
            {mode === "signup" ? "I have an account" : "New here?"}
          </Link>
        </div>

        {error ? <p className="mt-3 text-[0.82rem] font-semibold text-[var(--color-danger)]">{error}</p> : null}

        {offer ? (
          <div className="mt-4 rounded-xl border border-[color:var(--color-brand)] p-3">
            <p className="text-[0.86rem] font-semibold">Move the cases from this browser into your new account?</p>
            <p className="mt-1 text-[0.8rem] text-[var(--color-ink-soft)]">
              {exportForMigration({ is_working: true }).data?.length ?? 0} case(s) are stored locally on this device. They will be copied to your account and removed from this browser.
            </p>
            <div className="mt-2 flex gap-2">
              <Btn onClick={() => void migrate()}>Move them</Btn>
              <Btn kind="ghost" onClick={() => router.push("/?tab=history")}>
                Leave them here
              </Btn>
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          <Disclaimer text="An account does not create a lawyer-client relationship. Nothing here is legal advice." />
        </div>
        {trace.length ? <Trace checks={trace as never} label="auth trace" /> : null}
      </Card>
    </main>
  );
}
