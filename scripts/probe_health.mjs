#!/usr/bin/env node
/**
 * Probes a running instance's /api/health and prints the self-test table.
 *   npm run selftest                      # against http://localhost:3000
 *   BASE=https://justice-ai.vercel.app npm run selftest
 */
const BASE = process.env.BASE || "http://localhost:3000";

async function main() {
  let res;
  try {
    res = await fetch(`${BASE}/api/health?full=1&is_working=1`, { headers: { accept: "application/json" } });
  } catch (e) {
    console.error(`Cannot reach ${BASE}. Start it first:  npm run dev`);
    console.error(String(e.message || e));
    process.exit(2);
  }
  const j = await res.json();
  console.log(`\nJusticeAI self-test @ ${BASE}  (HTTP ${res.status})`);
  console.log(`overall: ${j.ok ? "OK" : "NOT OK"}   probed in ${j.durationMs}ms   corpus: ${j.corpus?.sections} sections / ${j.corpus?.acts} acts (${j.corpus?.verified} verified, ${j.corpus?.unverified} awaiting verification)`);
  if (j.degraded?.length) console.log(`degraded (optional services): \n  - ${j.degraded.join("\n  - ")}`);
  console.log("");
  for (const s of j.services ?? []) {
    const bad = (s.checks ?? []).filter((c) => !c.ok);
    console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.name}${s.error ? `  (${s.error})` : ""}`);
    for (const c of bad) console.log(`        ! ${c.name}: ${c.detail}`);
  }
  console.log(`\nmodels: text=${j.models?.text} fast=${j.models?.fast} vision=${j.models?.vision ?? "none"} (${j.models?.note})`);
  console.log(`quota : guest ${j.quota?.guestPerDay}/day, user ${j.quota?.userPerDay}/day, chat ${j.quota?.userChatPerDay}/day`);
  console.log(`\n${j.summary?.failed ?? 0} failing check(s) of ${j.summary?.total ?? 0}. Full JSON: ${BASE}/api/health?full=1`);
  process.exit(j.ok ? 0 : 1);
}

main();
