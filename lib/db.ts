/**
 * Firestore data model (plan step 13). Every path is namespaced by uid, which is what
 * makes the rules in firestore.rules enforceable:
 *
 *   users/{uid}/profile
 *   users/{uid}/cases/{caseId}
 *   users/{uid}/cases/{caseId}/messages/{msgId}
 *   users/{uid}/cases/{caseId}/artifacts/{artifactId}
 *
 * In `is_working` mode nothing is written; the probe validates the uid, the shape and
 * the Admin connection instead.
 */
import { track, type Opts, type WorkResult } from "./diag";
import { getAdmin } from "./firebaseAdmin";
import { CaseStatusSchema } from "./schema";

export interface CaseRecord {
  id: string;
  problem: string;
  category: string;
  lang: string;
  city: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  analysis: unknown;
  strippedCitations?: unknown[];
  guest?: boolean;
}

export interface ChatRecord {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}

export interface ArtifactRecord {
  id: string;
  type: string;
  text: string;
  version: number;
  createdAt: number;
}

const UID = /^[A-Za-z0-9_-]{6,128}$/;
const DOCID = /^[A-Za-z0-9_-]{1,64}$/;

/** Minimal shape of the pieces of the Firestore API this file uses. */
type Dialect = {
  collection: (name: string) => Dialect;
  doc: (id: string) => Dialect;
  orderBy: (field: string, dir: "asc" | "desc") => Dialect;
  limit: (n: number) => Dialect;
  get: () => Promise<{ docs: Array<{ data: () => never; ref: { delete: () => Promise<unknown> } }>; size: number }>;
  set: (data: object, options?: { merge?: boolean }) => Promise<unknown>;
  delete: () => Promise<unknown>;
};

type WorkCheck = import("./diag").WorkCheck;

function guard(uid: string, caseId?: string, docId?: string): string | null {
  if (!UID.test(uid)) return "malformed uid";
  if (caseId !== undefined && !DOCID.test(caseId)) return "malformed case id";
  if (docId !== undefined && !DOCID.test(docId)) return "malformed document id";
  return null;
}

async function col(uid: string, _path: string, opts: Opts): Promise<{ ok: boolean; error: string | null; checks: WorkCheck[]; db: Dialect | null }> {
  const admin = await getAdmin(opts);
  if (!admin.data) return { ok: false, error: admin.error ?? "Firestore unavailable", checks: admin.checks, db: null };
  const bad = guard(uid);
  if (bad) return { ok: false, error: bad, checks: admin.checks, db: null };
  return { ok: true, error: null, checks: admin.checks, db: admin.data.db as Dialect };
}

/* ── profile ─────────────────────────────────────────────────────────────── */

export async function upsertProfile(
  uid: string,
  patch: { name?: string; phone?: string; address?: string; city?: string; state?: string; pin?: string; email?: string; updatedAt?: number },
  opts: Opts = {},
): Promise<WorkResult<{ ref: string }>> {
  const p = track<{ ref: string }>("db.upsertProfile", opts);
  const c = await col(uid, "profile", opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const ref = `users/${uid}/profile`;
  if (opts.is_working) return p.fixture({ ref }, "is_working: profile write skipped");
  try {
    await c.db!.collection("users").doc(uid).collection("profile").doc("data").set({ ...patch, updatedAt: Date.now() }, { merge: true });
    return p.done({ ref });
  } catch (e) {
    return p.caught(e);
  }
}

export interface ProfileRecord {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  email?: string;
  updatedAt?: number;
}

export async function getProfile(uid: string, opts: Opts = {}): Promise<WorkResult<ProfileRecord | null>> {
  const p = track<ProfileRecord | null>("db.getProfile", opts);
  const c = await col(uid, "profile", opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  if (opts.is_working) return p.fixture(null, "is_working: read skipped");
  try {
    const snap = (await c.db!.collection("users").doc(uid).collection("profile").doc("data").get()) as unknown as {
      exists: boolean;
      data: () => ProfileRecord;
    };
    p.check("profile row exists", snap.exists, snap.exists ? "loaded" : "none yet - the form will be empty");
    return p.done(snap.exists ? snap.data() : null);
  } catch (e) {
    return p.caught(e);
  }
}

/* ── cases ───────────────────────────────────────────────────────────────── */

export async function saveCase(uid: string, rec: CaseRecord, opts: Opts = {}): Promise<WorkResult<CaseRecord>> {
  const p = track<CaseRecord>("db.saveCase", opts);
  const c = await col(uid, `cases/${rec.id}`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  p.check("case id well formed", DOCID.test(rec.id) ? "ok" : `rejected: "${rec.id}"`);
  p.check("status is a known value", CaseStatusSchema.safeParse(rec.status).success ? rec.status : `unknown status "${rec.status}"`);
  const ref = `users/${uid}/cases/${rec.id}`;
  if (opts.is_working) return p.fixture({ ...rec }, "is_working: case write skipped");
  try {
    await c.db!.collection("users").doc(uid).collection("cases").doc(rec.id).set(rec);
    p.check(`written to ${ref}`, true);
    return p.done(rec);
  } catch (e) {
    return p.caught(e);
  }
}

export async function listCases(uid: string, opts: Opts & { limit?: number } = {}): Promise<WorkResult<CaseRecord[]>> {
  const p = track<CaseRecord[]>("db.listCases", opts);
  const c = await col(uid, "cases", opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  if (opts.is_working) return p.fixture([], "is_working: read skipped");
  try {
    const snap = await c.db!.collection("users").doc(uid).collection("cases").orderBy("createdAt", "desc").limit(Math.min(100, opts.limit ?? 50)).get();
    const rows = snap.docs.map((d) => d.data() as CaseRecord);
    p.check(`${rows.length} case(s) read`, rows.length >= 0 ? "ok" : "read failed");
    return p.done(rows);
  } catch (e) {
    return p.caught(e);
  }
}

export async function getCase(uid: string, caseId: string, opts: Opts = {}): Promise<WorkResult<CaseRecord | null>> {
  const p = track<CaseRecord | null>("db.getCase", opts);
  const c = await col(uid, `cases/${caseId}`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId);
  if (bad) return p.done(null, bad);
  if (opts.is_working) return p.fixture(null, "is_working: read skipped");
  try {
    const snap = (await c.db!.collection("users").doc(uid).collection("cases").doc(caseId).get()) as unknown as {
      exists: boolean;
      data: () => CaseRecord;
    };
    p.check("case exists for this owner", snap.exists, snap.exists ? "found" : "no such case");
    return p.done(snap.exists ? snap.data() : null);
  } catch (e) {
    return p.caught(e);
  }
}

export async function patchCase(
  uid: string,
  caseId: string,
  patch: { status?: string; updatedAt?: number },
  opts: Opts = {},
): Promise<WorkResult<{ ref: string }>> {
  const p = track<{ ref: string }>("db.patchCase", opts);
  const c = await col(uid, `cases/${caseId}`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId);
  if (bad) return p.done(null, bad);
  const ref = `users/${uid}/cases/${caseId}`;
  if (opts.is_working) return p.fixture({ ref }, "is_working: patch skipped");
  try {
    await c.db!.collection("users").doc(uid).collection("cases").doc(caseId).set({ ...patch, updatedAt: Date.now() }, { merge: true });
    return p.done({ ref });
  } catch (e) {
    return p.caught(e);
  }
}

export async function deleteCase(uid: string, caseId: string, opts: Opts = {}): Promise<WorkResult<{ ref: string }>> {
  const p = track<{ ref: string }>("db.deleteCase", opts);
  const c = await col(uid, `cases/${caseId}`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId);
  if (bad) return p.done(null, bad);
  const ref = `users/${uid}/cases/${caseId}`;
  if (opts.is_working) return p.fixture({ ref }, "is_working: delete skipped");
  try {
    const doc = c.db!.collection("users").doc(uid).collection("cases").doc(caseId);
    const msgs = await doc.collection("messages").get();
    const arts = await doc.collection("artifacts").get();
    await Promise.all([...msgs.docs, ...arts.docs].map((d) => d.ref.delete()));
    await doc.delete();
    p.check("subcollections removed before the parent", true, `${msgs.size + arts.size} child doc(s)`);
    return p.done({ ref });
  } catch (e) {
    return p.caught(e);
  }
}

/* ── messages ────────────────────────────────────────────────────────────── */

export async function appendMessage(uid: string, caseId: string, msg: ChatRecord, opts: Opts = {}): Promise<WorkResult<{ ref: string }>> {
  const p = track<{ ref: string }>("db.appendMessage", opts);
  const c = await col(uid, `cases/${caseId}/messages`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId, msg.id);
  if (bad) return p.done(null, bad);
  p.check("content within limit", msg.content.length <= 6000, `${msg.content.length} chars`);
  const ref = `users/${uid}/cases/${caseId}/messages/${msg.id}`;
  if (opts.is_working) return p.fixture({ ref }, "is_working: message write skipped");
  try {
    await c.db!.collection("users").doc(uid).collection("cases").doc(caseId).collection("messages").doc(msg.id).set(msg);
    return p.done({ ref });
  } catch (e) {
    return p.caught(e);
  }
}

export async function listMessages(uid: string, caseId: string, opts: Opts & { limit?: number } = {}): Promise<WorkResult<ChatRecord[]>> {
  const p = track<ChatRecord[]>("db.listMessages", opts);
  const c = await col(uid, `cases/${caseId}/messages`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId);
  if (bad) return p.done(null, bad);
  if (opts.is_working) return p.fixture([], "is_working: read skipped");
  try {
    const snap = await c.db!
      .collection("users")
      .doc(uid)
      .collection("cases")
      .doc(caseId)
      .collection("messages")
      .orderBy("createdAt", "asc")
      .limit(Math.min(200, opts.limit ?? 100))
      .get();
    return p.done(snap.docs.map((d) => d.data() as ChatRecord));
  } catch (e) {
    return p.caught(e);
  }
}

/* ── artifacts (letters, RTI drafts, PDFs) ───────────────────────────────── */

export async function saveArtifact(uid: string, caseId: string, a: ArtifactRecord, opts: Opts = {}): Promise<WorkResult<{ ref: string }>> {
  const p = track<{ ref: string }>("db.saveArtifact", opts);
  const c = await col(uid, `cases/${caseId}/artifacts`, opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const bad = guard(uid, caseId, a.id);
  if (bad) return p.done(null, bad);
  p.check("artifact type known", ["letter", "rti", "pdf", "complaint"].includes(a.type) ? a.type : `unexpected type "${a.type}"`);
  const ref = `users/${uid}/cases/${caseId}/artifacts/${a.id}`;
  if (opts.is_working) return p.fixture({ ref }, "is_working: artifact write skipped");
  try {
    await c.db!.collection("users").doc(uid).collection("cases").doc(caseId).collection("artifacts").doc(a.id).set(a);
    return p.done({ ref });
  } catch (e) {
    return p.caught(e);
  }
}

export interface GuestCaseInput {
  id?: string;
  problem: string;
  category?: string;
  lang?: string;
  city?: string;
  status?: string;
  createdAt?: number;
  analysis?: unknown;
}

/**
 * Plan step 15: move a guest's localStorage cases into the account.
 * The client sends the array; the server stamps uid, re-validates and never trusts ids.
 */
export async function migrateGuestCases(
  uid: string,
  cases: GuestCaseInput[],
  opts: Opts = {},
): Promise<WorkResult<{ migrated: number; skipped: number; ids: string[] }>> {
  const p = track<{ migrated: number; skipped: number; ids: string[] }>("db.migrateGuestCases", opts);
  const c = await col(uid, "cases", opts);
  p.merge(c.checks, "getAdmin");
  if (c.error) return p.done(null, c.error);
  const batch = (cases ?? []).slice(0, 200);
  p.check(`guest payload size (${batch.length} cases)`, batch.length <= 200);
  const ids: string[] = [];
  let skipped = 0;
  for (const raw of batch) {
    const id = raw.id && DOCID.test(raw.id) ? raw.id : `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!raw.problem || String(raw.problem).length < 4) {
      skipped += 1;
      continue;
    }
    const rec: CaseRecord = {
      id,
      problem: String(raw.problem).slice(0, 6000),
      category: String(raw.category ?? "General").slice(0, 60),
      lang: String(raw.lang ?? "en").slice(0, 8),
      city: String(raw.city ?? "").slice(0, 80),
      status: CaseStatusSchema.parse(raw.status ?? "open"),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Date.now(),
      analysis: raw.analysis ?? null,
      guest: true,
    };
    if (!opts.is_working) {
      try {
        await c.db!.collection("users").doc(uid).collection("cases").doc(id).set(rec);
        ids.push(id);
      } catch (e) {
        p.check(`write ${id}`, false, e instanceof Error ? e.message : String(e));
        skipped += 1;
      }
    } else {
      ids.push(id);
    }
  }
  if (opts.is_working) p.skip("writes", `is_working: ${ids.length} case(s) validated but not written`);
  p.check("migrated", true, `${ids.length} in, ${skipped} skipped`);
  return p.done({ migrated: ids.length, skipped, ids });
}

export async function selfTest(opts: Opts = {}): Promise<WorkResult<{ ready: boolean }>> {
  const p = track<{ ready: boolean }>("db.selfTest", { ...opts, is_working: true });
  const admin = await getAdmin({ ...opts, is_working: true });
  p.attach(admin, "getAdmin");
  const bad = guard("not-a-valid-uid!!");
  p.check("uid guard rejects malformed ids", bad !== null, bad ?? "accepted - BUG");
  const r = await listCases("a-valid-uid123", { ...opts, is_working: true });
  p.attach(r, "listCases#probe");
  return p.done({ ready: admin.ok });
}
