/**
 * POST /api/detect - fake-notice / scam detector (plan step 31: real behaviour, no fake data).
 * Uses the cheap model slot and a strict schema; a photo is only read when a vision
 * model is actually active, otherwise the pasted text is analysed and the user is told.
 */
import { detectNotice } from "@/lib/analyze";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { identify } from "@/lib/identity";
import { consume } from "@/lib/ratelimit";
import { DetectRequestSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const parsed = DetectRequestSchema.safeParse(body);
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const who = await identify(req, opts);
    if (!who.data) return failResponse(who.error ?? "Could not identify the caller.", who.checks, opts.is_working, 401);

    const burst = consume("burst", who.data.quotaKey, opts);
    if (burst.data && !burst.data.allowed) return failResponse("Slow down for a minute, then try again.", burst.checks, opts.is_working, 429);

    const result = await detectNotice(parsed.data, { ...opts, signal: req.signal });
    return respond(result, result.ok ? 200 : undefined, {
      safety: "This check is heuristic. Never act on a notice purely because the assistant called it suspicious - verify at the issuing office counter.",
    });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
