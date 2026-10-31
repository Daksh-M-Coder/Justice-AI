"use client";

/**
 * The only way the UI talks to the backend.
 *  - always sends the envelope-shaped request and reads the envelope-shaped response
 *  - attaches the Firebase ID token when there is a session (plan step 11)
 *  - `is_working` is forwarded from the app-wide Vitals toggle so any action can be
 *    probed without spending tokens
 */
import { track, type Opts, type WorkCheck, type WorkResult } from "./diag";
import { currentIdToken } from "./firebaseClient";

export interface Envelope<T> {
  ok: boolean;
  data: T | null;
  checks: WorkCheck[];
  error?: string;
  is_working: boolean;
  [key: string]: unknown;
}

export function workModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("justiceai_is_working") === "1" || new URLSearchParams(window.location.search).get("is_working") === "1";
  } catch {
    return false;
  }
}

export function setWorkMode(on: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("justiceai_is_working", on ? "1" : "0");
}

export interface ApiCall {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  opts?: Opts;
}

export async function call<T>({ path, method = "POST", body = {}, opts = {} }: ApiCall): Promise<WorkResult<Envelope<T>>> {
  const p = track<Envelope<T>>(`api.${method} ${path}`, opts);
  const isWorking = opts.is_working ?? workModeEnabled();
  try {
    const tokenRes = await currentIdToken({ is_working: isWorking });
    // `merge`, never `attach`: a guest legitimately has no token, and attach() would copy the
    // child's not-ok as *our* error, invalidating a request the server actually answered fine.
    p.merge(tokenRes.checks, "currentIdToken");
    const token = tokenRes.data;
    p.check("identity for this call", true, token ? "bearer ID token attached" : "no token - the server treats this as a guest call");

    const payload = { ...body, is_working: isWorking };
    const res = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(payload),
    });
    const env = (await res.json()) as Envelope<T>;
    p.check(`HTTP ${res.status}`, res.ok || res.status === 400 || res.status === 429, env.error ?? "");
    if (env.checks?.length) p.merge(env.checks, "server");
    if (!res.ok && env.error) p.check("server reported an error", false, env.error);
    return p.done(env, env.ok ? undefined : env.error ?? `request failed (HTTP ${res.status})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    p.check("network reachable", false, msg);
    return p.done(null, /Failed to fetch|NetworkError|fetch failed/i.test(msg) ? "Could not reach the server. Check your connection." : msg);
  }
}

export async function analyze(payload: Record<string, unknown>, opts: Opts = {}): Promise<WorkResult<Envelope<unknown>>> {
  return call({ path: "/api/analyze", body: payload, opts });
}

export async function chat(payload: Record<string, unknown>, opts: Opts = {}): Promise<WorkResult<Envelope<unknown>>> {
  return call({ path: "/api/chat", body: payload, opts });
}

export async function detect(payload: Record<string, unknown>, opts: Opts = {}): Promise<WorkResult<Envelope<unknown>>> {
  return call({ path: "/api/detect", body: payload, opts });
}

export async function health(opts: Opts = {}): Promise<WorkResult<Envelope<Record<string, unknown>>>> {
  const p = track<Envelope<Record<string, unknown>>>("api.health", opts);
  const isWorking = opts.is_working ?? workModeEnabled();
  try {
    // was a dead ternary (`? "1" : "1"`), so the mode the UI asked for and the mode the
    // server ran could disagree without anyone noticing
    const res = await fetch(`/api/health?full=1&is_working=${isWorking ? "1" : "0"}`, { headers: { accept: "application/json" } });
    const json = (await res.json()) as Envelope<Record<string, unknown>>;
    // Reachability and health are two different assertions: 503 means "reachable but
    // degraded". Collapsing them into one passing check meant a red board always read green.
    p.check(`probe reached the server (HTTP ${res.status})`, res.status === 200 || res.status === 503, res.status === 503 ? "reachable, reporting degraded" : "reachable");
    const requiredRed = ((json.services ?? []) as { name: string; ok: boolean }[]).filter((s) => s.ok === false && !/^firebaseAdmin\.|^db\.|^groq\.vision$|^reminders\./.test(s.name));
    p.check("all required services green", requiredRed.length === 0, requiredRed.length ? requiredRed.map((s) => s.name).join(", ") : "no required service is red");
    return p.done(json, undefined);
  } catch (e) {
    return p.caught(e);
  }
}

export const casesApi = {
  list: (opts: Opts = {}) => call<unknown[]>({ path: "/api/cases", method: "GET", opts }),
  save: (body: Record<string, unknown>, opts: Opts = {}) => call({ path: "/api/cases", body, opts }),
  patch: (caseId: string, body: Record<string, unknown>, opts: Opts = {}) => call({ path: `/api/cases/${encodeURIComponent(caseId)}`, method: "PATCH", body, opts }),
  remove: (caseId: string, opts: Opts = {}) => call({ path: `/api/cases/${encodeURIComponent(caseId)}`, method: "DELETE", body: {}, opts }),
  messages: (caseId: string, opts: Opts = {}) => call<unknown[]>({ path: `/api/cases/${encodeURIComponent(caseId)}/messages`, method: "GET", opts }),
  postMessages: (caseId: string, messages: unknown[], opts: Opts = {}) => call({ path: `/api/cases/${encodeURIComponent(caseId)}/messages`, body: { messages }, opts }),
  artifact: (caseId: string, body: Record<string, unknown>, opts: Opts = {}) => call({ path: `/api/cases/${encodeURIComponent(caseId)}/artifacts`, body, opts }),
  migrate: (cases: unknown[], opts: Opts = {}) => call({ path: "/api/cases/migrate", body: { cases }, opts }),
  profile: {
    get: (opts: Opts = {}) => call<Record<string, unknown>>({ path: "/api/profile", method: "GET", opts }),
    save: (body: Record<string, unknown>, opts: Opts = {}) => call({ path: "/api/profile", body, opts }),
  },
  reminders: {
    get: (opts: Opts = {}) => call<unknown[]>({ path: "/api/reminders", method: "GET", opts }),
    email: (opts: Opts = {}) => call({ path: "/api/reminders", body: { email: true }, opts }),
  },
};
