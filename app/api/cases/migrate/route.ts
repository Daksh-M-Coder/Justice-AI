/**
 * POST /api/cases/migrate - plan step 15: a guest who signs up hands over the cases that
 * were sitting in localStorage, and they become real Firestore documents under their uid.
 * The client's ids are ignored unless well formed; the server is the authority.
 */
import { migrateGuestCases } from "@/lib/db";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        problem: z.string().min(4).max(6000),
        category: z.string().max(60).optional(),
        lang: z.string().max(8).optional(),
        city: z.string().max(80).optional(),
        status: z.string().max(20).optional(),
        createdAt: z.number().optional(),
        analysis: z.unknown().optional(),
      }),
    )
    .max(200),
});

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in first, then move your guest cases.", who.checks, opts.is_working, 401);

    const parsed = Body.safeParse(body);
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const r = await migrateGuestCases(who.data.uid, parsed.data.cases, opts);
    return respond(r, r.ok ? 200 : undefined, {
      note: "Re-open Case History: these cases are now stored against your account and will appear on any device you sign in on.",
    });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
