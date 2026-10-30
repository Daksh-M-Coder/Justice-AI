/**
 * HTTP plumbing shared by every route: safe body reading, the WorkResult -> Response
 * mapping, and the is_working switch that can also be set with ?is_working=1 so the
 * frontend (and curl) can probe any endpoint without spending money.
 */
import type { WorkResult } from "./diag";

export const MAX_BODY_BYTES = 4_000_000; // ~4 MB: enough for a compressed photo, no more

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new ApiError(`Request body too large (limit ${Math.round(MAX_BODY_BYTES / 1024)} KB)`, 413);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError("Request body too large", 413);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new ApiError(`Body is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, 400);
  }
}

/** `?is_working=1` in the URL, or `is_working: true` in the body, both enable self-test mode. */
export function workMode(req: Request, body: Record<string, unknown>): { is_working: boolean } {
  const url = new URL(req.url);
  const q = url.searchParams.get("is_working");
  return { is_working: q === "1" || q === "true" || body.is_working === true };
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  checks: unknown;
  error?: string;
  is_working: boolean;
}

/** Messages that mean "the caller sent something unusable", not "the server broke". */
const CLIENT_HINTS = /not a readable image|too large|unsupported image|describe your problem|at least a dozen|image too large|paste the notice|required|malformed|not valid json/i;

const STATUS_HINTS: [RegExp, number][] = [
  [/not configured|service account|api key/i, 503],
  [/sign in|expired|invalid token|invalid or is invalid|author/i, 401],
  [/quota|limit.*(reached|exceeded)|too many|slow down/i, 429],
  [/groq|upstream|timed out|50[023]/i, 502],
];

export function respond<T>(result: WorkResult<T>, explicitStatus?: number, extra: Record<string, unknown> = {}): Response {
  // A self-test never reports a server error: the caller reads `ok` and `checks`.
  const status = explicitStatus ?? (result.is_working ? 200 : result.ok ? 200 : classify(result.error ?? ""));
  const body: ApiEnvelope<T> & Record<string, unknown> = {
    ok: result.ok,
    data: result.data,
    checks: result.checks,
    is_working: result.is_working,
    ...extra,
  };
  if (result.error) body.error = result.error;
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-is-working": String(result.is_working) },
  });
}

function classify(error: string): number {
  if (error && CLIENT_HINTS.test(error)) return 400;
  for (const [re, code] of STATUS_HINTS) if (error && re.test(error)) return code;
  return 500;
}

export function unauthorized(msg: string): Response {
  return failResponse(msg, [], false, 401);
}

/** A failure that never came from a probe (validation, quota, auth) still uses the envelope. */
export function failResponse(error: string, checks: unknown[] = [], isWorking = false, status?: number): Response {
  return Response.json(
    { ok: false, data: null, checks, error, is_working: isWorking },
    { status: status ?? classify(error), headers: { "cache-control": "no-store" } },
  );
}

/** Zod issues -> one readable line for a non-technical user. */
export function issueText(issues: readonly { path: readonly unknown[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
}
