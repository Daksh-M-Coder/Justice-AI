/**
 * /api/cases/[caseId]/messages - chat history persisted per case (plan step 30).
 * POST writes both turns (the question and the answer are passed by the client after
 * /api/chat answered, so a failed completion never leaves a dangling user turn).
 */
import { appendMessage, listMessages } from "@/lib/db";
import type { WorkCheck } from "@/lib/diag";
import { errorResponse, failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { ChatMessageSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ caseId: string }> };
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function GET(req: Request, ctx: Ctx) {
  const opts = workMode(req, {});
  const who = await requireUser(req, opts);
  if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
  const { caseId } = await ctx.params;
  const r = await listMessages(who.data.uid, caseId, opts);
  return respond(r, 200, { caseId });
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
    const { caseId } = await ctx.params;

    const turns = Array.isArray(body.messages) ? body.messages : [];
    if (turns.length === 0 || turns.length > 4) return failResponse(issueText([{ path: ["messages"], message: "Send 1 to 4 messages per call" }]), [], opts.is_working, 400);

    const checks = [] as WorkCheck[];
    const ids = [] as string[];
    for (const t of turns) {
      const parsed = ChatMessageSchema.safeParse(t);
      if (!parsed.success) return failResponse(issueText(parsed.error.issues), checks, opts.is_working, 400);
      const id = nid("m");
      const r = await appendMessage(who.data.uid, caseId, { id, role: parsed.data.role, content: parsed.data.content, createdAt: Date.now() + ids.length }, opts);
      checks.push(...r.checks);
      if (!r.ok) return respond(r, undefined, { caseId });
      ids.push(id);
    }
    return respond({ ok: true, data: { ids, caseId }, checks, is_working: opts.is_working }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
