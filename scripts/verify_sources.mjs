#!/usr/bin/env node
/**
 * Source verification for the legal dataset (plan steps 17 + 23).
 *
 * Nothing in data/ may be marked verified by hand-correct-feeling alone. This script
 * opens the cited source, looks for the section / case title in what actually came back,
 * and only then (with --write) flips `verified` to true.
 *
 *   npm run verify:sources                # report only
 *   npm run verify:sources -- --write     # update the JSON files where the check passed
 *   npm run verify:sources -- --kind laws --timeout 30000
 *
 * India Code is often slow or rate limiting; run this from a normal connection and
 * treat "unreachable" as "still unverified", never as "fine".
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const KIND = argValue("--kind") || "all";
const TIMEOUT = Number(argValue("--timeout") || 20000);

function argValue(name) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1];
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function get(url) {
  if (!url || !/^https?:\/\//.test(url)) return { url, status: "SKIPPED", text: "" };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "JusticeAI-source-verifier/1.0 (legal-data QA; contact: repo maintainer)" },
    });
    const text = (await res.text()).replace(/\s+/g, " ");
    return { url, status: res.status, text };
  } catch (e) {
    return { url, status: `ERR ${e.name === "AbortError" ? "timeout" : e.message.slice(0, 40)}`, text: "" };
  } finally {
    clearTimeout(t);
  }
}

/** Does the fetched page really contain this provision / case? */
function matches(haystack, needles) {
  const h = haystack.toLowerCase();
  return needles.filter((n) => n && String(n).trim().length > 2 && h.includes(String(n).trim().toLowerCase()));
}

async function verifyLaws() {
  const dir = resolve(ROOT, "data/laws");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const rows = [];
  for (const f of files) {
    const path = resolve(dir, f);
    const entries = JSON.parse(await readFile(path, "utf8"));
    let changed = false;
    for (const e of entries) {
      const primary = await get(e.source_url);
      const alt = await get(e.alternate_url);
      const actWord = String(e.act).split(",")[0].split("(")[0].trim();
      const secWord = e.section && e.section !== "act-level" ? `section ${e.section.replace(/^Article\s/i, "")}` : actWord;
      const hitPrimary = matches(primary.text, [actWord, secWord, e.section, e.title]);
      const hitAlt = matches(alt.text, [actWord, secWord, e.section, e.title]);
      const ok = (primary.status === 200 && hitPrimary.length >= 2) || (alt.status === 200 && hitAlt.length >= 2);
      rows.push({ kind: "law", id: `${e.act} §${e.section}`, status: `${primary.status}/${alt.status}`, found: hitPrimary.length + hitAlt.length, ok });
      if (ok && WRITE && !e.verified) {
        e.verified = true;
        e.verified_on = new Date().toISOString().slice(0, 10);
        e.verified_via = primary.status === 200 && hitPrimary.length >= 2 ? e.source_url : e.alternate_url;
        changed = true;
      }
    }
    if (changed) {
      await writeFile(path, JSON.stringify(entries, null, 2) + "\n", "utf8");
      console.log(`  wrote ${f}`);
    }
  }
  return rows;
}

async function verifyPrecedents() {
  const path = resolve(ROOT, "data/precedents.json");
  const doc = JSON.parse(await readFile(path, "utf8"));
  const rows = [];
  for (const [cat, list] of Object.entries(doc.categories)) {
    for (const c of list) {
      const res = await get(c.url);
      const words = matches(res.text, [String(c.title).split(" v. ")[0], String(c.title).split(" v ")[0], c.citation?.split(";")[0]]);
      const ok = res.status === 200 && words.length >= 1;
      rows.push({ kind: "precedent", id: `${cat}: ${c.title}`, status: res.status, found: words.length, ok });
      if (ok && WRITE) {
        c.verified = true;
        c.verified_on = new Date().toISOString().slice(0, 10);
      }
    }
  }
  if (WRITE) await writeFile(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return rows;
}

async function verifyDirectories() {
  const path = resolve(ROOT, "data/directories.json");
  const doc = JSON.parse(await readFile(path, "utf8"));
  const rows = [];
  const buckets = ["legal_aid", "find_a_professional", "record_sources"];
  for (const b of buckets) {
    for (const item of doc[b] ?? []) {
      if (!item.url) {
        rows.push({ kind: "link", id: item.name, status: "no-url (manual)", found: 0, ok: true });
        continue;
      }
      const res = await get(item.url);
      const ok = typeof res.status === "number" && res.status < 400;
      rows.push({ kind: "link", id: `${b}: ${item.name}`, status: res.status, found: 0, ok });
      if (ok && WRITE) item.status = "verified";
      else if (WRITE && !ok) item.status = "dead-link";
    }
  }
  if (WRITE) await writeFile(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return rows;
}

const runs = [];
if (KIND === "all" || KIND === "laws") runs.push(["LAWS", verifyLaws]);
if (KIND === "all" || KIND === "precedents") runs.push(["PRECEDENTS", verifyPrecedents]);
if (KIND === "all" || KIND === "links") runs.push(["DIRECTORIES", verifyDirectories]);

let total = 0;
let passed = 0;
for (const [label, fn] of runs) {
  console.log(`\n== ${label} ==`);
  const rows = await fn();
  for (const r of rows) {
    total += 1;
    if (r.ok) passed += 1;
    console.log(`${r.ok ? "OK  " : "FAIL"} [${r.status}] ${r.id}${r.found ? ` (matched ${r.found} term(s))` : ""}`);
  }
}
console.log(`\n${passed}/${total} checked out.${WRITE ? " Files updated." : " Dry run - add --write to update the JSON."}`);
console.log("Reminder: a 200 response with matching terms is a machine check, not a legal opinion. Read the section text before you rely on it.");
