/**
 * POST /api/analyze - the case analysis endpoint.
 *
 * Thin on purpose: parse -> identify -> quota -> engine -> persist -> respond.
 * Add ?is_working=1 (or "is_working": true in the body) to run the whole chain in
 * self-test mode: no completion is issued, no Firestore write happens, and the
 * response carries the list of checks that were performed.
 */
import { analyzeCase } from "@/lib/analyze";
import { saveArtifact, saveCase } from "@/lib/db";
import { track } from "@/lib/diag";
import { errorResponse, failResponse, issueText, readBody, respond, workMode } from "@/lib/http";
import { identify } from "@/lib/identity";
import { consume } from "@/lib/ratelimit";
import { AnalyzeRequestSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const opts = workMode(req, body);

    const parsed = AnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) return failResponse(issueText(parsed.error.issues), [], opts.is_working, 400);

    const id = await identify(req, opts);
    if (!id.data) return failResponse(id.error ?? "Could not identify the caller.", id.checks, opts.is_working, 401);

    const burst = consume("burst", id.data.quotaKey, opts);
    if (burst.data && !burst.data.allowed) {
      return failResponse("You are sending requests very fast. Wait a minute and try again.", [...burst.checks], opts.is_working, 429);
    }
    const kind = id.data.kind === "user" ? "user_analyze" : "guest_analyze";
    const quota = consume(kind, id.data.quotaKey, opts);
    if (quota.data && !quota.data.allowed) {
      const msg =
        id.data.kind === "user"
          ? `You have used all ${quota.data.limit} analyses for today. Your allowance renews in ${Math.ceil(quota.data.resetInMs / 3_600_000)} hours.`
          : `Free guests get ${quota.data.limit} analyses a day. Sign in for ${process.env.USER_MAX_ANALYSES_PER_DAY ?? 20} a day - your cases are then saved to your account.`;
      return failResponse(msg, [...quota.checks], opts.is_working, 429);
    }

    const result = await analyzeCase(parsed.data, { ...opts, signal: req.signal });
    if (!result.ok || !result.data) return respond(result);

    const caseId = newId("c");
    let saved = false;
    const saveChecks = [] as unknown[];
    const letter = result.data.kind === "rti" ? result.data.rti?.letter : result.data.analysis?.letter;

    if (id.data.kind === "user" && !opts.is_working) {
      const rec = {
        id: caseId,
        problem: parsed.data.problem,
        category: String(parsed.data.category || "General"),
        lang: parsed.data.lang,
        city: parsed.data.city,
        status: "open",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        analysis: result.data,
      };
      const w = await saveCase(id.data.uid, rec, opts);
      saveChecks.push(...w.checks);
      if (letter) {
        const a = await saveArtifact(id.data.uid, caseId, { id: newId("a"), type: result.data.kind === "rti" ? "rti" : "letter", text: letter, version: 1, createdAt: Date.now() }, opts);
        saveChecks.push(...a.checks);
      }
      saved = w.ok;
      if (!saved) {
        const p = track("analyze.persist", opts);
        p.check("case saved to your account", false, w.error ?? "the write was refused");
        // the analysis itself succeeded - tell the user it is only in this browser
        return respond(result, 200, { caseId, saved: false, storageNote: w.error ?? "Could not save to your account", checks: [...result.checks, ...p.done(null).checks, ...saveChecks], quota: quota.data && { remaining: quota.data.remaining, limit: quota.data.limit } });
      }
    }

    return respond(result, 200, {
      caseId,
      saved,
      storageNote: id.data.kind === "guest" ? "Guest mode: this case is stored in this browser only. Sign in to sync it to your account." : undefined,
      checks: [...result.checks, ...saveChecks],
      quota: quota.data && { remaining: quota.data.remaining, limit: quota.data.limit, resetsInHours: Math.ceil(quota.data.resetInMs / 3_600_000) },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/analyze?is_working=1 - cheap probe of the whole analysis chain. */
export async function GET(req: Request) {
  const opts = workMode(req, {});
  const probe = track<{ probe: true }>("analyze.GET", opts);
  probe.check("POST is the real entry point", true, "GET only reports the self-test summary");
  const result = await analyzeCase(
    AnalyzeRequestSchema.parse({ problem: "Probe: my new washing machine failed within the warranty period and the seller refuses to respond", category: "Consumer", lang: "en", is_working: true }),
    { ...opts, is_working: true },
  );
  return respond(result, 200, { note: probe.done({ probe: true }).checks });
}
