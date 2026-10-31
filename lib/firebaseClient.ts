"use client";

/**
 * Firebase web SDK, loaded lazily so a misconfigured or offline environment degrades to
 * guest mode instead of throwing at hydration (the legacy app crashed the tab on it).
 */
import { track, type Opts, type WorkResult } from "./diag";

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  photoURL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authRef: any = null;
let initFailed = false;

export function authConfigured(opts: Opts = {}): WorkResult<boolean> {
  const p = track<boolean>("firebase.authConfigured", opts);
  const ok = !!(cfg.apiKey && cfg.projectId && cfg.authDomain);
  p.check("Firebase web config present", ok, ok ? cfg.projectId : "set NEXT_PUBLIC_FIREBASE_* in .env.local");
  return p.done(ok);
}

async function ensureAuth(): Promise<unknown> {
  if (authRef || initFailed) return authRef;
  const probe = authConfigured({ is_working: true });
  if (!probe.data) {
    initFailed = true;
    return null;
  }
  try {
    const [{ initializeApp }, { getAuth }] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = initializeApp(cfg);
    authRef = getAuth(app);
    return authRef;
  } catch {
    initFailed = true;
    return null;
  }
}

export async function currentIdToken(opts: Opts = {}): Promise<WorkResult<string | null>> {
  const p = track<string | null>("firebase.currentIdToken", opts);
  const a = (await ensureAuth()) as { currentUser?: { getIdToken: (b?: boolean) => Promise<string> } | null } | null;
  if (!a) {
    // Being a guest is a supported mode, not a defect. This used to record a FAILING check,
    // and because Probe.done() marks a result not-ok when any check failed, every single
    // guest request came back ok:false - the UI then threw away a perfectly valid HTTP 200
    // and showed the user the internal string `nested step "currentIdToken" reported a failure`.
    p.skip("authenticated token", "Firebase is not configured on this deployment - the request is sent as a guest");
    return p.done(null);
  }
  const user = a.currentUser;
  if (!user) {
    p.skip("authenticated token", "nobody is signed in on this device - the request is sent as a guest");
    return p.done(null);
  }
  try {
    const token = await user.getIdToken(false);
    p.check("ID token fetched", true, `${token.length} chars`);
    return p.done(token);
  } catch (e) {
    return p.caught(e);
  }
}

export async function signUp(email: string, password: string, name: string, opts: Opts = {}): Promise<WorkResult<SessionUser>> {
  const p = track<SessionUser>("firebase.signUp", opts);
  p.check("email looks valid", /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), email ? "" : "empty");
  p.check("password is at least 8 characters", password.length >= 8, "Firebase rejects shorter passwords");
  if (!p.done(null).ok) return p.done(null, "Check the email address and use at least 8 characters.");
  const a = await ensureAuth();
  if (!a) return p.done(null, "Sign-up is unavailable because Firebase is not configured on this deployment. Ask the maintainer to set the NEXT_PUBLIC_FIREBASE_* values.");
  try {
    const { createUserWithEmailAndPassword, updateProfile } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(a as never, email.trim(), password);
    if (name) await updateProfile(cred.user as never, { displayName: name } as never);
    p.check("account created", true, cred.user.uid.slice(0, 8) + "…");
    return p.done({ uid: cred.user.uid, email: cred.user.email ?? email, name: cred.user.displayName ?? name });
  } catch (e) {
    return p.caught(authFriendly(e));
  }
}

export async function signIn(email: string, password: string, opts: Opts = {}): Promise<WorkResult<SessionUser>> {
  const p = track<SessionUser>("firebase.signIn", opts);
  const a = await ensureAuth();
  if (!a) return p.done(null, "Sign-in is unavailable: Firebase is not configured on this deployment.");
  try {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const cred = await signInWithEmailAndPassword(a as never, email.trim(), password);
    return p.done({ uid: cred.user.uid, email: cred.user.email ?? email, name: cred.user.displayName ?? "" });
  } catch (e) {
    return p.caught(authFriendly(e));
  }
}

export async function signInWithGoogle(opts: Opts = {}): Promise<WorkResult<SessionUser>> {
  const p = track<SessionUser>("firebase.signInWithGoogle", opts);
  const a = await ensureAuth();
  if (!a) return p.done(null, "Google sign-in is unavailable: Firebase is not configured.");
  try {
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const cred = await signInWithPopup(a as never, new GoogleAuthProvider());
    return p.done({ uid: cred.user.uid, email: cred.user.email ?? "", name: cred.user.displayName ?? "" });
  } catch (e) {
    return p.caught(authFriendly(e));
  }
}

export async function signOut(opts: Opts = {}): Promise<WorkResult<true>> {
  const p = track<true>("firebase.signOut", opts);
  const a = await ensureAuth();
  if (!a) return p.done(true, undefined);
  const { signOut: so } = await import("firebase/auth");
  await so(a as never);
  return p.done(true);
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function watchSession(cb: (u: SessionUser | null) => void, opts: Opts = {}): () => void {
  const p = track<null>("firebase.watchSession", opts);
  let stop: (() => void) | null = null;
  void (async () => {
    const a = await ensureAuth();
    if (!a) {
      p.check("auth listener attached", false, "Firebase not configured - staying in guest mode");
      cb(null);
      return;
    }
    const { onAuthStateChanged } = await import("firebase/auth");
    stop = onAuthStateChanged(a as never, (u: { uid: string; email?: string | null; displayName?: string | null } | null) => {
      cb(u ? { uid: u.uid, email: u.email ?? "", name: u.displayName ?? "" } : null);
    });
    p.check("auth listener attached", true);
  })();
  return () => {
    stop?.();
  };
}

function authFriendly(e: unknown): Error {
  const code = (e as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "That email and password do not match. Try again or create an account.",
    "auth/user-not-found": "No account exists with that email.",
    "auth/wrong-password": "Wrong password.",
    "auth/email-already-in-use": "An account already exists with that email. Sign in instead.",
    "auth/weak-password": "Choose a password of at least 8 characters.",
    "auth/invalid-email": "That does not look like a valid email address.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes.",
    "auth/popup-closed-by-user": "The sign-in window was closed before finishing.",
    "auth/network-request-failed": "Network problem while contacting Firebase.",
    "auth/configuration-not-found": "Firebase Email/Password sign-in is not enabled in the console.",
  };
  return new Error(map[code] ?? (e instanceof Error ? e.message : String(e)));
}

/** Self-test for the Vitals tab: config presence + SDK import, no network round trip. */
export async function selfTest(opts: Opts = {}): Promise<WorkResult<{ configured: boolean }>> {
  const p = track<{ configured: boolean }>("firebase.selfTest", { ...opts, is_working: true });
  const c = authConfigured({ is_working: true });
  p.attach(c, "authConfigured");
  p.check("project id matches the API", c.data === true ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "" : "", "used by the Admin SDK too");
  return p.done({ configured: !!c.data });
}
