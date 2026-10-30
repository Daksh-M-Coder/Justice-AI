/**
 * Firebase Admin (server side). Never imported from a client component.
 *
 * Without a service account the app still runs: writes to Firestore are refused with a
 * clear message and case history stays in localStorage (guest mode). Everything is
 * reported through the is_working checks so /api/health tells you what is missing.
 */
import { track, type Opts, type WorkResult } from "./diag";

export interface AdminBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  projectId: string;
}

let bundle: AdminBundle | null = null;
let attempted = false;

function readServiceAccount(): { json: string | null; source: string } {
  const b64 = (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_B64 ?? "").trim();
  const raw = (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (b64) {
    try {
      return { json: Buffer.from(b64, "base64").toString("utf8"), source: "FIREBASE_ADMIN_SERVICE_ACCOUNT_B64" };
    } catch {
      return { json: null, source: "b64-decode-failed" };
    }
  }
  if (raw) return { json: raw, source: "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON" };
  return { json: null, source: "none" };
}

/** Lazy, memoised init. Safe to call on every request. */
export async function getAdmin(opts: Opts = {}): Promise<WorkResult<AdminBundle>> {
  const p = track<AdminBundle>("firebaseAdmin.getAdmin", opts);
  if (bundle) {
    p.check("admin app already initialised", true, `project ${bundle.projectId}`);
    return p.done(bundle);
  }
  if (attempted) return p.done(null, "Firebase Admin failed to initialise earlier in this instance");

  const { json, source } = readServiceAccount();
  p.check(`service account available (${source})`, !!json, json ? "loaded" : "set FIREBASE_ADMIN_SERVICE_ACCOUNT_B64 (base64 of the service-account JSON) to enable Firestore writes and token verification");
  if (!json) return p.done(null, "Firebase Admin is not configured");

  attempted = true;
  try {
    const account = JSON.parse(json) as { project_id?: string; client_email?: string; private_key?: string };
    p.check("service-account JSON has client_email + private_key", !!(account.client_email && account.private_key));
    if (!account.client_email || !account.private_key) return p.done(null, "The service-account JSON is missing client_email or private_key");
    const [{ getApps, initializeApp, cert }, { getAuth }, { getFirestore }] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/auth"),
      import("firebase-admin/firestore"),
    ]);
    const projectId = (process.env.FIREBASE_PROJECT_ID ?? account.project_id ?? "").trim();
    const existing = getApps();
    const app = existing.length
      ? existing[0]
      : initializeApp({
          credential: cert({ projectId, clientEmail: account.client_email, privateKey: account.private_key }),
          projectId,
          storageBucket: `${projectId}.appspot.com`,
        });
    bundle = { app, auth: getAuth(app), db: getFirestore(app), projectId };
    p.check(`initialised for project ${projectId}`, true);
    return p.done(bundle);
  } catch (e) {
    bundle = null;
    return p.caught(e);
  }
}

/** Verify a Firebase ID token. Returns the uid, or an explanation of why it failed. */
export async function verifyIdToken(
  token: string,
  opts: Opts = {},
): Promise<WorkResult<{ uid: string; email?: string; name?: string; email_verified?: boolean }>> {
  const p = track<{ uid: string; email?: string; name?: string; email_verified?: boolean }>("firebaseAdmin.verifyIdToken", opts);
  const admin = await getAdmin(opts);
  const b = p.attach(admin, "getAdmin");
  if (!b) return p.done(null, admin.error ?? "cannot verify the sign-in token: Firebase Admin is not configured");
  try {
    const decoded = await b.auth.verifyIdToken(token, true);
    p.check("token signature + expiry valid", true, `uid ${String(decoded.uid).slice(0, 6)}…`);
    p.check("token not revoked", !decoded.firebase?.token_created_at || decoded.firebase.token_created_at > 0, "checked with revoked-token lookup");
    return p.done({ uid: decoded.uid, email: decoded.email, name: decoded.name, email_verified: decoded.email_verified });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.check("token accepted", false, msg.split("\n")[0]?.slice(0, 160) ?? "invalid token");
    return p.done(null, "Your sign-in has expired or is invalid. Please sign in again.");
  }
}

export async function selfTest(opts: Opts = {}): Promise<WorkResult<AdminBundle>> {
  const p = track<AdminBundle>("firebaseAdmin.selfTest", { ...opts, is_working: true });
  const r = await getAdmin({ ...opts, is_working: true });
  p.attach(r, "getAdmin");
  p.check("auth middleware can verify tokens", r.ok ? "ready" : r.error ?? "not ready");
  return p.done(r.data);
}
