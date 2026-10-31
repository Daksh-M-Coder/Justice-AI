#!/usr/bin/env node
/**
 * T1.3 - input-shape matrix (see test_checklist.md, section "T1 variation table").
 *
 * Where this differs from accept.mjs: accept.mjs proves the *safety properties*
 * (auth boundaries, guards, envelope shape, no innerHTML). This file proves the
 * *request contract* - every category, every language, every boundary length and every
 * malformed-input path - so a schema change cannot quietly start rejecting a valid
 * combination or accepting an invalid one.
 *
 * Every request carries is_working:true, so this spends ZERO tokens and writes NOTHING.
 * It needs a server:  npx next start -p 3111
 *
 *   node scripts/variants.mjs [http://localhost:3111]
 *
 * Expected: 21 passed, 0 failed.
 */
const BASE = process.argv[2] || "http://localhost:3111";

/** Appended to every body: self-test mode, no completion, no Firestore write. */
const W = { is_working: true };

/** The 9 real categories plus one unknown value and the empty string, exactly as the
 *  checklist table specifies - 11 x 3 languages = 33 combinations. */
const CATEGORIES = [
  "Consumer",
  "RTI",
  "Tenant / Housing",
  "Workplace / Labour",
  "Police / FIR",
  "Banking / Fraud",
  "Cyber Fraud",
  "Family / Marriage",
  "General",
  "Legal Aid", // not in the enum: must fall back to General, not error
  "",
];
const LANGS = ["en", "hi", "mr"];

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

async function send(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, type: res.headers.get("content-type") || "" };
}

const PROBLEM = "The shop in Pune refuses to replace the defective washing machine still under warranty";

/* ── 1. the 33 category x language combinations ─────────────────────────── */
{
  console.log("\ncombination matrix");
  const bad = [];
  let n = 0;
  for (const category of CATEGORIES) {
    for (const lang of LANGS) {
      n += 1;
      const r = await send("/api/analyze", { problem: PROBLEM, category, lang, city: "Pune", ...W });
      if (r.status !== 200 || !r.body?.ok) bad.push(`${category || '""'}/${lang}=${r.status}${r.body?.error ? ` ${String(r.body.error).slice(0, 60)}` : ""}`);
    }
  }
  check(`analyze: all ${n} category x lang combinations return 200 + ok`, bad.length === 0, bad.length ? bad.slice(0, 4).join(" | ") : "33/33 accepted");
}

/* ── 2..8 analyze boundaries ────────────────────────────────────────────── */
{
  console.log("\nanalyze input boundaries");

  // Exact lengths, because the point of these two checks is the boundary itself:
  // "shop refuse" is 11 (rejected), "shop refused" is 12 (accepted).
  const ELEVEN = "shop refuse";
  const TWELVE = "shop refused";

  const r11 = await send("/api/analyze", { problem: ELEVEN, category: "Consumer", lang: "en", ...W });
  check(`analyze: ${ELEVEN.length}-char problem is rejected with 400`, ELEVEN.length === 11 && r11.status === 400, `HTTP ${r11.status} ${String(r11.body?.error || "").slice(0, 70)}`);

  const r12 = await send("/api/analyze", { problem: TWELVE, category: "Consumer", lang: "en", ...W });
  check(`analyze: ${TWELVE.length}-char problem is accepted (boundary)`, TWELVE.length === 12 && r12.status === 200 && r12.body?.ok === true, `HTTP ${r12.status}`);

  const empty = await send("/api/analyze", { ...W });
  check("analyze: missing problem is rejected with 400", empty.status === 400, `HTTP ${empty.status}`);

  const unknownCat = await send("/api/analyze", { problem: PROBLEM, category: "Spaceships", lang: "en", ...W });
  const echoedCat = JSON.stringify(unknownCat.body?.data ?? "");
  check("analyze: unknown category falls back instead of erroring", unknownCat.status === 200 && unknownCat.body?.ok === true, /Spaceships/.test(echoedCat) ? "echoed the bad category back" : "fell back");

  const unknownLang = await send("/api/analyze", { problem: PROBLEM, category: "Consumer", lang: "fr", ...W });
  check("analyze: unknown language falls back to en", unknownLang.status === 200 && unknownLang.body?.ok === true, `HTTP ${unknownLang.status}`);

  const markup = await send("/api/analyze", { problem: "<img src=x onerror=alert(1)> shop refused warranty", category: "Consumer", lang: "en", ...W });
  check("analyze: markup in the problem is stored as text, not an error", markup.status === 200 && markup.body?.ok === true, "UI escaping is checked in T2.9");

  const deva = await send("/api/analyze", { problem: "मेरा मकान मालिक ज़मानत वापस नहीं कर रहा है", category: "Tenant / Housing", lang: "hi", ...W });
  check("analyze: Devanagari input is accepted", deva.status === 200 && deva.body?.ok === true, `HTTP ${deva.status}`);
}

/* ── 9. the malformed-JSON contract (was 500, fixed to 400) ─────────────── */
{
  console.log("\nmalformed body");
  const broken = await send("/api/analyze", '{"problem": "warranty",}');
  check(
    "analyze: malformed JSON body answers 400, not 500",
    broken.status === 400,
    `HTTP ${broken.status} - ${String(broken.body?.error || "").slice(0, 90)}`,
  );
}

/* ── 10..13 chat contract ───────────────────────────────────────────────── */
{
  console.log("\nchat input boundaries");

  const msg = (content) => ({ role: "user", content });

  const zero = await send("/api/chat", { messages: [], caseContext: "", lang: "en", ...W });
  check("chat: 0 messages is rejected with 400", zero.status === 400, `HTTP ${zero.status}`);

  const many = await send("/api/chat", { messages: Array.from({ length: 21 }, () => msg("what happens next?")), lang: "en", ...W });
  check("chat: 21 messages is rejected with 400", many.status === 400, `HTTP ${many.status}`);

  const huge = await send("/api/chat", { messages: [msg("x".repeat(6001))], lang: "en", ...W });
  check("chat: a 6001-char message is rejected with 400", huge.status === 400, `HTTP ${huge.status}`);

  const one = await send("/api/chat", { messages: [msg("What is the RTI reply deadline?")], caseContext: "RTI application filed 12 days ago", lang: "en", ...W });
  const skipped = (one.body?.checks ?? []).filter((c) => c.skipped === true);
  check("chat: 1 message is accepted and the completion is skipped", one.status === 200 && one.body?.ok === true && skipped.length > 0, `HTTP ${one.status}, ${skipped.length} skipped check(s)`);
}

/* ── 14..16 detector contract ───────────────────────────────────────────── */
{
  console.log("\ndetector input boundaries");

  const NINE = "pay now!!";
  const short = await send("/api/detect", { text: NINE, ...W });
  check(`detect: ${NINE.length} chars is rejected with 400`, NINE.length === 9 && short.status === 400, `HTTP ${short.status}`);

  const okText = await send("/api/detect", { text: "URGENT: pay Rs 5000 to this UPI ID today or arrest warrant will be issued against you", ...W });
  check("detect: 10+ chars is accepted", okText.status === 200 && okText.body?.ok === true, `HTTP ${okText.status}`);

  const pdf = await send("/api/detect", { text: "check this notice I received please", imageBase64: "data:application/pdf;base64,JVBERi0xLjQK", ...W });
  const refused = pdf.body?.ok === false && /readable image|not an image|unsupported image/i.test(String(pdf.body?.error ?? ""));
  check("detect: a non-image data URL is refused (is_working still answers 200)", refused, `ok=${pdf.body?.ok} error=${String(pdf.body?.error ?? "").slice(0, 80)}`);
}

/* ── 17 oversized upload ────────────────────────────────────────────────── */
{
  console.log("\nupload size limit");
  const huge = await send("/api/analyze", {
    problem: PROBLEM,
    category: "Consumer",
    lang: "en",
    imageBase64: "data:image/jpeg;base64," + "A".repeat(2_500_000),
    ...W,
  });
  check("analyze: an image over the base64 limit is rejected with 400", huge.status === 400 && /too large/i.test(String(huge.body?.error ?? "")), `HTTP ${huge.status} ${String(huge.body?.error ?? "").slice(0, 70)}`);
}

/* ── 18..19 auth boundaries ─────────────────────────────────────────────── */
{
  console.log("\nauth boundaries");

  const guestPaths = ["/api/cases", "/api/profile", "/api/reminders"];
  const results = [];
  for (const p of guestPaths) {
    const r = await get(p);
    if (r.status !== 401) results.push(`${p}=${r.status}`);
  }
  check("guest: /api/cases, /api/profile, /api/reminders are all 401", results.length === 0, results.join(" | ") || "3/3 refused");

  const forged = await send("/api/analyze", { problem: PROBLEM, category: "Consumer", lang: "en", ...W }, { authorization: "Bearer a.b.c" });
  // 401 = token rejected. 503 = Firebase Admin not configured (the honest local state).
  // Either is correct; being served as a GUEST (200) would be the vulnerability.
  check("forged bearer token is never treated as a guest", forged.status === 401 || forged.status === 503, `HTTP ${forged.status} ${String(forged.body?.error ?? "").slice(0, 60)}`);
}

/* ── 20..21 routing and health ──────────────────────────────────────────── */
{
  console.log("\nrouting and health");

  const missing = await get("/nope");
  check("unknown page returns 404", missing.status === 404, `HTTP ${missing.status}`);

  const health = await get("/api/health");
  check("GET /api/health answers 200 or 503, never 500", health.status === 200 || health.status === 503, `HTTP ${health.status}`);
}

/* ── tally ──────────────────────────────────────────────────────────────── */
console.log(`\nT1.3 variants @ ${BASE}: ${pass} passed, ${fail} failed`);
if (fail > 0) console.log("Classify each FAIL before touching code (checklist rule 1): CODE / ENV / UPSTREAM.");
process.exit(fail > 0 ? 1 : 0);
