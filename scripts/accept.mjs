#!/usr/bin/env node
/**
 * Runtime acceptance: exercises the live app the way a browser would, and asserts the
 * safety properties the plan promised. Read-only for the guest paths; nothing spends
 * tokens because every call carries is_working.
 *
 *   node scripts/accept.mjs [http://localhost:3000]
 */
const BASE = process.argv[2] || "http://localhost:3111";
let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function j(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const post = (path, obj, headers = {}) =>
  j(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(obj) });

console.log(`\nAcceptance against ${BASE}\n`);

// ── health ────────────────────────────────────────────────────────────────
{
  const { status, body } = await j("/api/health?full=1");
  console.log("health");
  check("answers JSON", !!body, body ? `services=${body.services?.length}` : "no body");
  check("reports corpus size", (body?.corpus?.sections ?? 0) >= 60, `${body?.corpus?.sections} sections, ${body?.corpus?.unverified} awaiting verification`);
  check("names the text model", !!body?.models?.text, body?.models?.text);
  check("states vision availability honestly", body?.models ? "vision" in body.models : false, `vision=${body?.models?.vision ?? "null"}`);
  check("HTTP is 200 or 503 (never a crash)", status === 200 || status === 503, `HTTP ${status}`);
  if (body?.degraded?.length) console.log(`        degraded: ${body.degraded.join(" | ")}`);
}

// ── analyze in self-test mode (no spend, no write) ─────────────────────────
{
  const { status, body } = await post("/api/analyze", {
    problem: "The shop delivered a washing machine with a dead motor and refuses to replace it",
    category: "Consumer",
    lang: "en",
    city: "Pune",
    is_working: true,
  });
  console.log("\nanalyze (is_working)");
  check("HTTP 200", status === 200, `HTTP ${status}${body?.error ? ` ${body.error}` : ""}`);
  check("envelope shape", typeof body?.ok === "boolean" && Array.isArray(body?.checks));
  check("is_working echoed", body?.is_working === true);
  check("self-test recorded a skip", (body?.checks ?? []).some((c) => c.skipped === true), (body?.checks ?? []).filter((c) => c.skipped).map((c) => c.name).join(", "));
  if (body?.data) {
    check("data carries the disclaimer", /not legal advice/i.test(body.data.disclaimer ?? ""));
    check("precedents are labelled, never framed as odds", !/chance of winning/i.test(JSON.stringify(body.data.precedents ?? {})));
    check("guidance deadlines present", (body.data.guidance?.deadlines ?? []).length > 0, `${body.data.guidance?.deadlines?.length} clocks`);
    check("letter review checklist present", (body.data.guidance?.review ?? []).length >= 8);
    check("citation chips carry a verified flag", (body.data.citations ?? []).every((c) => typeof c.verified === "boolean"));
  }
}

// ── validation is a 400, not a 500 ────────────────────────────────────────
{
  const { status, body } = await post("/api/analyze", { problem: "hi", is_working: true });
  console.log("\nanalyze (validation)");
  check("short problem rejected with 400", status === 400, `HTTP ${status}: ${body?.error ?? ""}`);
}

// ── unknown keys from a stale client are ignored, not fatal ────────────────
{
  const { status } = await post("/api/analyze", { problem: "Landlord cut my water supply to force eviction without notice", category: "Tenant / Housing", applicantDetails: { name: "legacy" }, is_working: true });
  console.log("\nanalyze (legacy payload shape)");
  check("extra legacy keys do not crash it", status === 200, `HTTP ${status}`);
}

// ── guests cannot read the Firestore-backed endpoints ─────────────────────
{
  console.log("\nauth boundaries");
  const list = await j("/api/cases");
  check("GET /api/cases without a token is 401", list.status === 401, `HTTP ${list.status}`);
  const bad = await j("/api/cases", { headers: { authorization: "Bearer garbage.token.value" } });
  check("a forged bearer token is refused, not downgraded", bad.status === 401 || bad.status === 503, `HTTP ${bad.status}: ${bad.body?.error ?? ""}`);
  const mig = await post("/api/cases/migrate", { cases: [{ problem: "x" }] });
  check("guest migration without an account is 401", mig.status === 401, `HTTP ${mig.status}`);
}

// ── chat + detect self-tests ──────────────────────────────────────────────
{
  console.log("\nchat / detect (is_working)");
  const chat = await post("/api/chat", { messages: [{ role: "user", content: "What is the RTI reply deadline?" }], caseContext: "RTI filed 12 days ago", lang: "en", is_working: true });
  check("chat answers 200 in self-test", chat.status === 200, `HTTP ${chat.status}${chat.body?.error ? ` ${chat.body.error}` : ""}`);
  check("chat made no completion", (chat.body?.checks ?? []).some((c) => c.skipped), (chat.body?.checks ?? []).filter((c) => c.skipped).map((c) => c.fn).join(", "));

  const det = await post("/api/detect", { text: "Pay Rs 5000 to this UPI within 2 hours or police will arrest you. - Income Tax Department", is_working: true });
  check("detect answers 200", det.status === 200, `HTTP ${det.status}${det.body?.error ? ` ${det.body.error}` : ""}`);
  const empty = await post("/api/detect", { is_working: true });
  check("detect needs text or a photo (400)", empty.status === 400, `HTTP ${empty.status}`);
}

// ── image guards ──────────────────────────────────────────────────────────
{
  console.log("\nimage guards");
  const pdfAsImage = await post("/api/analyze", { problem: "Notice from the municipality about a water connection", category: "General", imageBase64: "data:application/pdf;base64,AAAA", is_working: true });
  check("a non-image data URL is refused", pdfAsImage.status === 400 || pdfAsImage.body?.ok === false, `HTTP ${pdfAsImage.status}: ${pdfAsImage.body?.error ?? ""}`);
  const huge = await post("/api/analyze", { problem: "Defective goods refund refused by the online marketplace", category: "Consumer", imageBase64: "data:image/png;base64," + "A".repeat(2_400_000), is_working: true });
  check("an oversized image is refused with a message", huge.status === 400 || /large/i.test(huge.body?.error ?? ""), `HTTP ${huge.status}: ${huge.body?.error ?? ""}`);
}

// ── the shell actually renders ────────────────────────────────────────────
{
  console.log("\napp shell");
  const home = await j("/");
  const html = await (await fetch(BASE + "/")).text();
  check("GET / is 200", home.status === 200, `HTTP ${home.status}`);
  check("navbar tabs are in the HTML", /Analyse case|RTI application|System vitals/i.test(html), "server-rendered shell");
  check("disclaimer is in the HTML", /not legal advice/i.test(html));
  check("manifest is linked", /manifest\.webmanifest/.test(html));
  const mf = await j("/manifest.webmanifest");
  check("manifest serves", mf.status === 200, mf.body?.name);
  const sw = await (await fetch(`${BASE}/sw.js`)).text();
  check("service worker bypasses the API entirely", /startsWith\("\/api\/"\)\)\s*return/.test(sw), "requests under /api/ are not intercepted or cached");
  const login = await (await fetch(`${BASE}/login`)).text();
  check("login page renders", /Sign in/i.test(login));
}

// ── quota is observable, and the probe did not eat it ─────────────────────
{
  console.log("\nquota");
  const h = await j("/api/health?full=1");
  const g = h.body?.quota?.guestPerDay;
  const u = h.body?.quota?.userPerDay;
  const c = h.body?.quota?.userChatPerDay;
  check("quotas are configured and ordered (guest <= user <= chat)", typeof g === "number" && g > 0 && u >= g && c >= u, `guest ${g}/day · user ${u}/day · chat ${c}/day`);
  // the brake itself is proven in vitest (tests/ratelimit.test.ts) against the real limits;
  // proving it here would need guest+1 paid calls
  const productionCeiling = 5;
  console.log(
    g > productionCeiling
      ? `  WARN  guest quota is ${g}/day - raised for local testing. Set GUEST_MAX_ANALYSES_PER_DAY back to 3 (and USER_MAX_ANALYSES_PER_DAY to 20) before production.`
      : `  ok    guest quota ${g}/day is within the production ceiling of ${productionCeiling}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed.`);
console.log("NOTE: a real (spending) analysis needs GROQ_API_KEY on the server; every call above used is_working.");
process.exit(fail === 0 ? 0 : 1);
