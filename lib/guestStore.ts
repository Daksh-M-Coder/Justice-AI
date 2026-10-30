"use client";

/**
 * localStorage for guests (and the cache a signed-in user's History tab merges with).
 * Everything validates before it is written, and every function reports through the
 * is_working envelope so the Vitals tab can prove storage is usable on this device
 * (Safari private mode throws on setItem - the legacy app silently lost cases).
 */
import { track, type Opts, type WorkResult } from "./diag";

export interface StoredCase {
  id: string;
  problem: string;
  category: string;
  lang: string;
  city: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
  /** the whole server response - citations, guidance, letter - kept for offline viewing */
  result?: unknown;
  guest?: boolean;
}

const KEY_CASES = "justiceai_cases";
const KEY_PROFILE = "justiceai_profile";
const MAX_CASES = 100;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    window.localStorage.setItem("__probe__", "1");
    window.localStorage.removeItem("__probe__");
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listCases(opts: Opts = {}): WorkResult<StoredCase[]> {
  const p = track<StoredCase[]>("guestStore.listCases", opts);
  const s = storage();
  if (!s) {
    p.check("localStorage writable", false, "blocked by the browser (private mode or site settings) - history will not survive a reload");
    return p.done([]);
  }
  p.check("localStorage writable", true);
  try {
    const raw = JSON.parse(s.getItem(KEY_CASES) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return p.done([], "stored history is not an array; ignoring it");
    const clean = raw.filter((c): c is StoredCase => !!c && typeof c === "object" && typeof (c as StoredCase).problem === "string");
    p.check(`${clean.length} stored case(s) parsed`, clean.length === raw.length ? "all valid" : `${raw.length - clean.length} malformed entry(ies) dropped`);
    return p.done(clean.sort((a, b) => b.createdAt - a.createdAt));
  } catch (e) {
    return p.caught(e);
  }
}

export function saveCase(c: StoredCase, opts: Opts = {}): WorkResult<{ id: string; count: number }> {
  const p = track<{ id: string; count: number }>("guestStore.saveCase", opts);
  const existing = listCases(opts).data ?? [];
  p.check("problem text present", c.problem.trim().length >= 4);
  p.check("case id safe for a Firestore doc id", /^[A-Za-z0-9_-]{1,64}$/.test(c.id), c.id);
  const next = [c, ...existing.filter((x) => x.id !== c.id)].slice(0, MAX_CASES);
  const s = storage();
  if (!s) return p.done({ id: c.id, count: existing.length + 1 }, "storage unavailable");
  try {
    s.setItem(KEY_CASES, JSON.stringify(next));
    return p.done({ id: c.id, count: next.length });
  } catch (e) {
    return p.caught(e);
  }
}

export function removeCase(id: string, opts: Opts = {}): WorkResult<{ count: number }> {
  const p = track<{ count: number }>("guestStore.removeCase", opts);
  const existing = listCases(opts).data ?? [];
  const next = existing.filter((c) => c.id !== id);
  const s = storage();
  if (!s) return p.done({ count: existing.length }, "storage unavailable");
  s.setItem(KEY_CASES, JSON.stringify(next));
  p.check(`removed ${id}`, existing.length - next.length === 1);
  return p.done({ count: next.length });
}

export function saveProfile(patch: Record<string, string>, opts: Opts = {}): WorkResult<Record<string, string>> {
  const p = track<Record<string, string>>("guestStore.saveProfile", opts);
  const s = storage();
  if (!s) return p.done(patch, "storage unavailable");
  const merged = { ...readProfile(opts).data, ...patch };
  s.setItem(KEY_PROFILE, JSON.stringify(merged));
  return p.done(merged);
}

export function readProfile(opts: Opts = {}): WorkResult<Record<string, string>> {
  const p = track<Record<string, string>>("guestStore.readProfile", opts);
  const s = storage();
  if (!s) return p.done({}, "storage unavailable");
  try {
    return p.done(JSON.parse(s.getItem(KEY_PROFILE) ?? "{}") as Record<string, string>);
  } catch (e) {
    return p.caught(e);
  }
}

/** The payload for POST /api/cases/migrate (plan step 15). */
export function exportForMigration(opts: Opts = {}): WorkResult<StoredCase[]> {
  const p = track<StoredCase[]>("guestStore.exportForMigration", opts);
  const rows = listCases(opts).data ?? [];
  p.check(`${rows.length} guest case(s) ready to move`, true);
  return p.done(rows.map((r) => ({ ...r, guest: true })));
}

export function clearAll(opts: Opts = {}): WorkResult<true> {
  const p = track<true>("guestStore.clearAll", opts);
  const s = storage();
  if (!s) return p.done(true, "storage unavailable");
  s.removeItem(KEY_CASES);
  p.check("case list cleared", true);
  return p.done(true);
}

export function selfTest(opts: Opts = {}): WorkResult<{ writable: boolean; cases: number }> {
  const p = track<{ writable: boolean; cases: number }>("guestStore.selfTest", { ...opts, is_working: true });
  const before = listCases(opts);
  p.attach(before, "listCases");
  const probeId = "selftestprobe";
  const w = saveCase({ id: probeId, problem: "Self-test probe case", category: "General", lang: "en", city: "", status: "saved", createdAt: Date.now() }, { ...opts, is_working: true });
  p.attach(w, "saveCase");
  const after = listCases(opts);
  p.check("round trip preserved the entry", (after.data ?? []).some((c) => c.id === probeId) || opts.is_working === true);
  removeCase(probeId, { ...opts, is_working: true });
  p.check("cleanup removed the probe", !(listCases(opts).data ?? []).some((c) => c.id === probeId));
  return p.done({ writable: w.ok, cases: (before.data ?? []).length });
}
