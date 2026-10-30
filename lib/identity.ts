/**
 * Who is calling? Every API route calls identify() before it does anything else.
 * Signed-in users are authenticated with a real Firebase ID token; guests are
 * identified by IP and get a strictly smaller quota.
 */
import { track, type Opts, type WorkResult } from "./diag";
import { verifyIdToken } from "./firebaseAdmin";
import { clientIp } from "./ratelimit";

/** Discriminated on `kind` so a route can narrow `uid` to string after a user check. */
export type Identity =
  | { kind: "user"; uid: string; email?: string; name?: string; ip: string; quotaKey: string }
  | { kind: "guest"; uid?: never; email?: never; name?: never; ip: string; quotaKey: string };

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export async function identify(req: Request, opts: Opts = {}): Promise<WorkResult<Identity>> {
  const p = track<Identity>("identity.identify", opts);
  const ip = clientIp(req);
  const token = bearerToken(req);

  if (!token) {
    p.check("no Authorization header", true, "treated as guest: stricter quota, no Firestore writes");
    return p.done({ kind: "guest", ip, quotaKey: `ip:${ip}` });
  }

  const v = await verifyIdToken(token, opts);
  const claims = p.attach(v, "verifyIdToken");
  if (!claims) {
    // a bearer token that does not verify is an error, never a silent downgrade to guest
    return p.done(null, v.error ?? "token could not be verified");
  }
  p.check(`signed in as ${claims.email ?? claims.uid.slice(0, 8)}`, true);
  return p.done({
    kind: "user",
    uid: claims.uid,
    email: claims.email,
    name: claims.name,
    ip,
    quotaKey: `uid:${claims.uid}`,
  });
}

/** Throw-free guard for routes that require a signed-in user. */
export type UserIdentity = Extract<Identity, { kind: "user" }>;

export async function requireUser(req: Request, opts: Opts = {}): Promise<WorkResult<UserIdentity>> {
  const p = track<UserIdentity>("identity.requireUser", opts);
  const id = await identify(req, opts);
  const data = p.attach(id, "identify");
  if (!data) return p.done(null, id.error ?? "identification failed");
  if (data.kind !== "user") return p.done(null, "This action needs an account. Please sign in - the guest version stores history only on this device.");
  return p.done(data);
}
