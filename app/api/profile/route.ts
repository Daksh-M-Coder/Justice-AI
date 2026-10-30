/**
 * /api/profile - the applicant details used to pre-fill letters and RTI applications.
 * Stored at users/{uid}/profile/data. Guests keep this in localStorage only.
 */
import { getProfile, upsertProfile } from "@/lib/db";
import { failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { requireUser } from "@/lib/identity";
import { ApplicantSchema } from "@/lib/schema";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = ApplicantSchema.extend({ email: z.string().email().max(200).optional() }).extend({
  email: z.union([z.string().email(), z.literal("")]).default(""),
});

export async function GET(req: Request) {
  const opts = workMode(req, {});
  const who = await requireUser(req, opts);
  if (!who.data) return failResponse(who.error ?? "Sign in to load your saved details.", who.checks, opts.is_working, 401);
  const r = await getProfile(who.data.uid, opts);
  return respond(r, 200, { email: who.data.email ?? "" });
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);
    const who = await requireUser(req, opts);
    if (!who.data) return failResponse(who.error ?? "Sign in to save your details.", who.checks, opts.is_working, 401);

    const parsed = Body.safeParse(body);
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const r = await upsertProfile(who.data.uid, { ...parsed.data, email: who.data.email }, opts);
    return respond(r, r.ok ? 200 : undefined, { saved: r.ok });
  } catch (e) {
    return failResponse(e instanceof Error ? e.message : String(e), [], false, 500);
  }
}
