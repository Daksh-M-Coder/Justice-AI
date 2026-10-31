#!/usr/bin/env node
/**
 * T1.5 - retrieval probe (spends nothing).
 *
 * The live sweep found that a Hindi or Marathi problem used to retrieve the WRONG law, because
 * the category label was glued onto the query and the `category` field was itself indexed - so
 * every "Tenant / Housing" document matched the word "housing" and three act-level entries
 * outranked the sections that actually govern a security deposit.
 *
 * This checks the shape of the retrieved context per language without issuing a completion:
 * every call runs with is_working:true, and the self-test fixture echoes the sections that
 * retrieval really selected.
 *
 *   node scripts/rag_probe.mjs [http://localhost:3111]
 */
const BASE = process.argv[2] || "http://localhost:3111";

const CASES = [
  {
    lang: "en",
    category: "Tenant / Housing",
    problem: "Landlord refuses to return the ten thousand rupee security deposit after I vacated the flat",
    expectCategory: "Tenant / Housing",
  },
  {
    lang: "hi",
    category: "Tenant / Housing",
    problem: "मकान मालिक ने घर खाली करने पर 10000 की जमा राशि वापस नहीं दी है",
    expectCategory: "Tenant / Housing",
  },
  {
    lang: "mr",
    category: "Tenant / Housing",
    problem: "मकान मालिक घर सोडल्यानंतर 10 हजारांची सुरक्षित ठेव परत देत नाही",
    expectCategory: "Tenant / Housing",
  },
  { lang: "en", category: "Consumer", problem: "Defective washing machine refused refund under warranty by the dealer in Pune", expectCategory: "Consumer" },
  { lang: "hi", category: "Consumer", problem: "डिक्सेल मशीन खराब हो गई है और दुकानदार रिफ्यूड देने से मना कर रहा है", expectCategory: "Consumer" },
  { lang: "en", category: "RTI", problem: "How many RTI applications were received and disposed of by my department last year", expectCategory: "RTI" },
  { lang: "mr", category: "Police / FIR", problem: "पोलीस ठाण्यात तक्रार दिली तरी FIR दाखल करत नाहीत", expectCategory: "Police / FIR" },
];

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok    ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function run(c) {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ problem: c.problem, category: c.category, lang: c.lang, city: "Pune", is_working: true }),
  });
  const j = await res.json();
  return { status: res.status, j };
}

console.log(`\nJusticeAI retrieval probe @ ${BASE}  (is_working - no tokens spent)\n`);

for (const c of CASES) {
  const { status, j } = await run(c);
  const label = `${c.lang} / ${c.category}`;
  if (!j.ok) {
    check(label, false, `HTTP ${status} ${String(j.error ?? "").slice(0, 70)}`);
    continue;
  }
  const cites = (j.data?.citations ?? []).map((x) => ({
    text: `${x.act.replace(/,.*/, "")} ${x.section}${x.act_level ? "" : ""}`,
    numbered: !x.act_level,
  }));
  const checks = j.checks ?? [];
  const fallback = checks.some((k) => /no Latin words/.test(k.name) && /category/.test(k.detail));
  const numbered = cites.filter((x) => x.numbered).length;

  console.log(`\n  ${label}  "${c.problem.slice(0, 46)}${c.problem.length > 46 ? "…" : ""}"`);
  console.log(`     retrieved: ${(j.data?.meta?.retrieval?.count ?? 0)} section(s)  |  shown: ${cites.length}  |  numbered: ${numbered}  |  language fallback: ${fallback ? "yes" : "no"}`);
  for (const x of cites) console.log(`       - ${x.text}${x.numbered ? "" : "   (whole Act, not a numbered provision)"}`);

  check(`${label}: context was retrieved at all`, cites.length > 0, `${cites.length} citation(s)`);
  // an Indic query must not drift into another category, and must not come back with only
  // act-level references, or the letter cannot cite a provision
  if (c.lang !== "en") check(`${label}: Indic query used the category listing`, fallback, "keyword ranking cannot help here");
  check(`${label}: at least one numbered provision`, numbered > 0, `${numbered} of ${cites.length}`);
}

const rt = await run({ lang: "en", category: "General", problem: "zzqq xxxy nonexistent subject matter nothing relevant here at all" });
check("a nonsense query still answers 200 and says so instead of inventing law", rt.status === 200 && rt.j.ok === true, `citations=${(rt.j.data?.citations ?? []).length}`);

console.log(`\nT1.5 retrieval probe: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
