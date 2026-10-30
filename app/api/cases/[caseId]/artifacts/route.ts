/**
 * /api/cases/[caseId]/artifacts - versioned documents (letter, RTI, complaint) per case.
 * The client sends the edited text; the server keeps an incrementing version so a user
 * can see what the AI wrote versus what they actually sent.
 */
import { saveArtifact } from "@/lib/db";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ caseId: string }> };

const ArtifactBody = z.object({
  type: z.enum(["letter", "rti", "pdf", "complaint"]),
  text: z.string().min(20).max(40_000),
  version: z.number().int().positive().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in required.", who.checks, opts.is_working, 401);
    const { caseId } = await ctx.params;

    const parsed = ArtifactBody.safeParse({ type: body.type ?? "letter", text: String(body.text ?? ""), version: body.version });
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const r = await saveArtifact(
      who.data.uid,
      caseId,
      { id, type: parsed.data.type, text: parsed.data.text, version: parsed.data.version ?? 1, createdAt: Date.now() },
      opts,
    );
    return respond(r, r.ok ? 201 : undefined, { caseId, artifactId: id });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
