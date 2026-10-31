/**
 * POST /api/chat - follow-up conversation on one case.
 * Signed-in users get the exchange persisted to
 * users/{uid}/cases/{caseId}/messages; guests get an ephemeral reply.
 */
import { continueCase } from "@/lib/chat";
import { appendMessage, listMessages } from "@/lib/db";
import { errorResponse, failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { identify } from "@/lib/identity";
import { consume } from "@/lib/ratelimit";
import { ChatRequestSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const who = await identify(req, opts);
    if (!who.data) return failResponse(who.error ?? "Could not identify the caller.", who.checks, opts.is_working, 401);

    const burst = consume("burst", who.data.quotaKey, opts);
    if (burst.data && !burst.data.allowed) return failResponse("Too many messages at once. Pause for a minute.", burst.checks, opts.is_working, 429);

    if (who.data.kind === "user") {
      const quota = consume("user_chat", who.data.quotaKey, opts);
      if (quota.data && !quota.data.allowed) {
        return failResponse(`You have sent ${quota.data.limit} questions for today. Your allowance renews in ${Math.ceil(quota.data.resetInMs / 3_600_000)} hours.`, quota.checks, opts.is_working, 429);
      }
    }

    const result = await continueCase(parsed.data, body.category ? String(body.category) : undefined, { ...opts, signal: req.signal });
    if (!result.ok || !result.data) return respond(result);

    let persisted = false;
    const checks = [...result.checks];
    if (who.data.kind === "user" && parsed.data.caseId && !opts.is_working) {
      const userMsg = parsed.data.messages[parsed.data.messages.length - 1];
      const a = await appendMessage(who.data.uid, parsed.data.caseId, { id: id(), role: userMsg.role, content: userMsg.content, createdAt: Date.now() }, opts);
      checks.push(...a.checks);
      const b = await appendMessage(who.data.uid, parsed.data.caseId, { id: id(), role: "assistant", content: result.data.reply, createdAt: Date.now() + 1 }, opts);
      checks.push(...b.checks);
      persisted = a.ok && b.ok;
    }

    return respond(result, 200, { persisted, caseId: parsed.data.caseId ?? null, checks });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/cases/[caseId]/messages is the read path; this keeps chat probeable. */
export async function GET(req: Request) {
  const opts = workMode(req, {});
  const who = await identify(req, opts);
  if (!who.data) return failResponse(who.error ?? "sign in required", who.checks, opts.is_working, 401);
  const caseId = new URL(req.url).searchParams.get("caseId") ?? "";
  if (!caseId) return failResponse("caseId query parameter is required", [], opts.is_working, 400);
  if (who.data.kind !== "user") return failResponse("Guest chats are not stored on the server.", [], opts.is_working, 401);
  const r = await listMessages(who.data.uid, caseId, opts);
  return respond(r);
}
