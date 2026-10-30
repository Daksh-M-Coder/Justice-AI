/**
 * /api/reminders - the legal-clock digest for a signed-in user's cases (plan step 37).
 * GET  -> the list, sorted by urgency
 * POST -> { email: true } asks for an email too; if the channel is not configured the
 *         response says so instead of pretending a mail went out.
 */
import { renderReminderMail, sendEmail, upcoming } from "@/lib/reminders";
import { listCases } from "@/lib/db";
import { failResponse, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const opts = workMode(req, {});
  const who = await requireUser(req, opts);
  if (!who.data) return failResponse(who.error ?? "Sign in to see your deadlines.", who.checks, opts.is_working, 401);
  const cases = await listCases(who.data.uid, opts);
  if (!cases.data) return respond(cases);
  const r = upcoming(cases.data.map((c) => ({ id: c.id, category: c.category, createdAt: c.createdAt })), opts);
  return respond(r, 200, { checkedCases: cases.data.length });
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in first.", who.checks, opts.is_working, 401);

    const cases = await listCases(who.data.uid, opts);
    const rows = upcoming((cases.data ?? []).map((c) => ({ id: c.id, category: c.category, createdAt: c.createdAt })), opts);
    if (!rows.data || rows.data.length === 0) return respond(rows, 200, { email: { sent: false, channel: "none", reason: "There are no open clocks to remind you about." } });

    const mail = renderReminderMail(rows.data, who.data.name ?? who.data.email ?? "there");
    const to = String(body.email ?? who.data.email ?? "");
    const sent = await sendEmail(to, mail.subject, mail.text, opts);
    return respond(rows, 200, { email: sent.data, emailError: sent.error, subject: mail.subject });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
