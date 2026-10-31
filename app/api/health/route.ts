/**
 * GET /api/health - the aggregate self-test (plan step 41).
 * No tokens are spent, no writes happen; safe to poll and safe to expose the summary.
 * Detailed checks are only included with ?full=1 so a probe does not leak internals by default.
 */
import { runSelfTests } from "@/lib/health";
import { track } from "@/lib/diag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const started = Date.now();
  try {
    const report = await runSelfTests({ is_working: url.searchParams.get("is_working") !== "0" });
    const full = url.searchParams.get("full") === "1";
    const p = track("health.GET", { is_working: true });
    p.check(`report produced in ${Date.now() - started}ms`, true, `${report.services.length} services probed`);
    return Response.json(
      {
        ok: report.ok,
        degraded: report.degraded,
        at: report.at,
        durationMs: report.durationMs,
        summary: report.summary,
        corpus: report.corpus,
        models: report.models,
        // pool counts and slot labels only - keypool.status() never returns a secret
        keys: report.keys,
        quota: report.quota,
        services: report.services.map((s) => ({
          name: s.name,
          ok: s.ok,
          error: s.error,
          checks: full ? s.checks : s.checks.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: c.detail })),
        })),
        selfChecks: p.done(null).checks,
      },
      { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    // A probe that itself threw is an outage signal, not a caller error: /api/health must
    // answer 200 or 503 so monitoring can keep using one rule ("503 means degraded").
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), degraded: ["health probe threw"], services: [] },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
