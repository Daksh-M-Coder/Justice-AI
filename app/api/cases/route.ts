/**
 * /api/cases - the signed-in user's case list (plan steps 13 + 29).
 * Guests never reach this: their history lives in localStorage until they sign up
 * and POST it to /api/cases/migrate.
 */
import { listCases, saveCase } from "@/lib/db";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { CaseStatusSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const opts = workMode(req, {});
  const who = await requireUser(req, opts);
  if (!who.data) return failResponse(who.error ?? "Sign in to see your saved cases.", who.checks, opts.is_working, 401);
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const r = await listCases(who.data.uid, { ...opts, limit });
  return respond(r, 200, { uid: who.data.uid.slice(0, 6) });
}

/** Manual save (e.g. a user edits a letter in the app and wants that version stored). */
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in to save cases.", who.checks, opts.is_working, 401);

    const id = typeof body.id === "string" && body.id ? body.id : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const rec = {
      id,
      problem: String(body.problem ?? "").slice(0, 6000),
      category: String(body.category ?? "General").slice(0, 60),
      lang: String(body.lang ?? "en").slice(0, 8),
      city: String(body.city ?? "").slice(0, 80),
      status: CaseStatusSchema.parse(body.status ?? "open"),
      createdAt: Number(body.createdAt) || Date.now(),
      updatedAt: Date.now(),
      analysis: body.analysis ?? null,
    };
    if (rec.problem.length < 4) return failResponse(issueText([{ path: ["problem"], message: "A saved case needs the problem text" }]), [], opts.is_working, 400);

    const r = await saveCase(who.data.uid, rec, opts);
    return respond(r, r.ok ? 201 : undefined, { case: rec });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
