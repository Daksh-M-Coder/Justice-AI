/**
 * /api/cases/[caseId] - read, change status (plan step 36), delete.
 * Ownership is enforced by requiring the uid from the verified token to be the path owner;
 * firestore.rules enforces the same thing at the database layer.
 */
import { deleteCase, getCase, patchCase } from "@/lib/db";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { CaseStatusSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ caseId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const opts = workMode(req, {});
  const who = await requireUser(req, opts);
  if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
  const { caseId } = await ctx.params;
  const r = await getCase(who.data.uid, caseId, opts);
  return respond(r);
}

/** PATCH: { status } - open | filed | waiting | resolved | saved */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
    const { caseId } = await ctx.params;

    const status = CaseStatusSchema.safeParse(body.status);
    if (!status.success) return failResponse(issueText(status.error.issues), [], opts.is_working, 400);

    const r = await patchCase(who.data.uid, caseId, { status: status.data, updatedAt: Date.now() }, opts);
    return respond(r, 200, { caseId, status: status.data });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const opts = workMode(req, {});
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
    const { caseId } = await ctx.params;
    const r = await deleteCase(who.data.uid, caseId, opts);
    return respond(r, 200, { caseId });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
