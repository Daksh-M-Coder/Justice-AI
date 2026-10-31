# JusticeAI — Permanent Testing Checklist

Run after EVERY change. Tiers go from free/instant to costly/flaky. **Never skip ahead; never run a
later tier to "debug" an earlier one.** Firebase/login is the LAST tier (T5).

Baseline measured on 2026-10-31 (update these numbers when you add tests on purpose):

| Check | Expected |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm test` | **9 files, 126 tests passed** |
| `npm run build` | succeeds, 16 routes listed |
| `node scripts/accept.mjs` (dummy key, no Firebase) | **33 passed, 0 failed** (1 WARN about guest quota is normal locally) |
| `node scripts/variants.mjs` | **21 passed, 0 failed** (`scripts/variants.mjs` now exists) |
| `npm run probe:rag` | **19 passed, 0 failed** - retrieval shape per language, spends nothing |
| `npm run lint` | **0 errors, 10 warnings** (the two old `lib/groq.ts` errors are fixed: the helper is `wantsJsonMode()`, `raw` is `const`) |
| `node scripts/live_check.mjs` (real keys) | 41 checks; see T3 for the token budget |

---

## 0. RULES FOR THE AGENT (read first — these stop the loops)

1. **Classify every failure before touching code.** Exactly one of:
   - **CODE** — our bug. Reproducible in T0–T2 with no network. Fix it.
   - **ENV** — wrong/missing env var, stale server, wrong port, wrong model name. Fix config, not code.
   - **UPSTREAM** — Groq said 429 / 404 model / 413 / daily token limit / timeout. **Do NOT edit code. Do NOT retry in a loop.** Mark the check `BLOCKED (upstream)`, move on, report it.
2. **Max 2 attempts per failing check.** After the second failure write: check ID, command, exact output, classification, then STOP and report. Do not try a third variation.
3. **Never "fix" a 429.** `live_check.mjs` already sleeps 65 s × 5 tries per call. A 429 means the quota is spent, not that code is wrong. Wait for the reset or switch `GROQ_TEXT_MODEL` (see T3).
4. **T3 (live, spends tokens) runs at most ONCE per session** and only after T0–T2 are green. Never run it in a loop, in watch mode, or "to see if it works now".
5. **Do not change the model name or `.env` values to make a test pass.** Past loops flipped between `llama-3.3-70b-versatile` (HTTP 404 on this key) and `openai/gpt-oss-20b`. The correct current values are in `.env.local` / `.env.example`.
6. **Do not "fix" things listed under KNOWN, EXPECTED BEHAVIOUR (section 8).** They are deliberate or already tracked.
7. **One server, one port: 3111.** Before starting, kill leftovers (section 1). Old logs show runs on 3120/3125/3126/3127/3128 — stale servers answering from old code cause phantom failures.
8. **Read logs correctly.** PowerShell `>` writes **UTF-16**; tools then show spaced-out garbage (`L I V E`). Always capture with `... 2>&1 | Out-File -Encoding utf8 run.log` (PowerShell) or `> run.log 2>&1` (bash/cmd via Git Bash). Delete the old `live-*.log` files; they are UTF-16 and mislead.
9. **Ignore `AGENTS.md` for test runs.** Reading `node_modules/next/dist/docs` is not part of testing and has caused wandering.
10. Report format when done: a table of check IDs with `PASS / FAIL(CODE) / FAIL(ENV) / BLOCKED(upstream) / SKIPPED(reason)`.

---

## 1. Setup (do once per session)

```bash
# 1. stop stale servers (Windows PowerShell)
Get-NetTCPConnection -LocalPort 3111 -ErrorAction SilentlyContinue | % { Stop-Process -Id $_.OwningProcess -Force }
# bash:  lsof -ti:3111 | xargs -r kill -9

npm ci
npm run build

# 2. start OFFLINE-SAFE server (dummy key => zero token spend, no Firestore writes)
# PowerShell:
$env:GROQ_API_KEY="dummy-offline-key"; $env:FIREBASE_ADMIN_SERVICE_ACCOUNT_B64=""; $env:FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=""; npx next start -p 3111
# bash:
GROQ_API_KEY=dummy-offline-key FIREBASE_ADMIN_SERVICE_ACCOUNT_B64= FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON= npx next start -p 3111
```
Process env beats `.env.local`, which beats `.env`. **Never put a `GROQ_API_KEY=` line in `.env.local`** (an empty one silently blanks the real key in `.env`).

Wait until `curl http://localhost:3111/api/health` answers (any status) before testing.

---

## T0 — Static checks (no server, no network, ~30 s)

| ID | Command | Expect | If it fails, look at |
|---|---|---|---|
| T0.1 | `npm run typecheck` | exit 0, no output | The file named in the error. A changed type in `lib/types.ts` or `lib/schema.ts` breaks many files — fix the type, not each caller. |
| T0.2 | `npm run lint` | **0 errors, 10 warnings.** The two errors that used to be here are gone (`useJsonForBody` → `wantsJsonMode`, `let raw` → `const raw`). The 10 remaining warnings are the documented `react-hooks/set-state-in-effect` / read-localStorage-after-mount pattern in `eslint.config.mjs`; do not chase them in a test loop. | `eslint.config.mjs`. Never let the error count go above 0. |
| T0.3 | `npm test` | 9 files / 126 tests pass, ~3 s | See per-file hints below. |
| T0.4 | `npm run build` | "Generating static pages 7/7", routes list incl. `/api/analyze`, `/api/chat`, `/api/detect`, `/api/health`, `/api/cases*`, `/api/profile`, `/api/reminders`, `/login`, `/signup` | Build errors are almost always a TS error missed by T0.1 or a `"use client"` / server-only import mix-up (`lib/firebaseAdmin.ts` must never be imported from `components/`). |
| T0.5 | `grep -rnE "gsk_[A-Za-z0-9]{20,}" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude=.env` | **no matches** (only `.env`, which is git-ignored, may hold the key) | A hard-coded Groq key in source/docs/logs. Remove it and rotate the key. Also never zip/share the folder with `.env`/`.env.local` inside. |
| T0.6 | `git check-ignore .env .env.local` (`.gitignore` already has `.env*`) | both ignored | Add to `.gitignore`. **Never commit `.env`.** |

**T0.3 per-file hints** (`tests/…`):
- `schema.test.ts` fails → `lib/schema.ts` (zod shapes, `ci()` normaliser, `CitationListSchema`). A model-output shape changed.
- `rag.test.ts` fails → `lib/rag.ts` and `data/laws/*.json` (bad JSON, duplicate id, missing field).
- `analyze.e2e.test.ts` fails → `lib/analyze.ts` (mocks Groq; no network). Check prompt/guard changes in `lib/prompts.ts`.
- `ratelimit.test.ts` fails → `lib/ratelimit.ts` (window math, bucket names `burst`, `guest_analyze`, `user_analyze`).
- `guidance.test.ts` fails → `lib/guidance.ts` / `data/guidance.json` (deadline clocks, escalation ladder).
- `i18n.test.ts` fails → `lib/i18n.tsx`: a key exists in `en` but not in `hi`/`mr`.
- `diag.test.ts` fails → `lib/diag.ts` (Probe/WorkResult contract).
- `http.test.ts` fails → `lib/http.ts` (`readBody` / `ApiError.status` / `errorResponse`), or a route
  that went back to hard-coding a status in its own `catch` instead of calling `errorResponse(e)`.
- `keypool.test.ts` fails → `lib/keypool.ts` (env parsing, the round-robin cursor, the 401-vs-429
  penalty boxes). Never "fix" it by putting key material into a trace - the file's last block
  exists precisely to catch that, because these traces are returned to the browser.

---

## T1 — Server up, NO token spend (every call carries `is_working:true`)

Server from section 1 must be running on 3111.

| ID | Command | Expect | If it fails, look at |
|---|---|---|---|
| T1.1 | `node scripts/probe_health.mjs` with `BASE=http://localhost:3111` | prints service table; `overall` may be NOT OK **only** because of Firebase (503) | `lib/health.ts` (`OPTIONAL` set decides what degrades vs breaks). Required services = everything except `firebaseAdmin.selfTest`, `db.selfTest`, `groq.vision`, `reminders.selfTest`. A failing *required* service names its module: open `lib/<module>.ts`. |
| T1.2 | `node scripts/accept.mjs http://localhost:3111` | **33 passed, 0 failed** | The failing line names the area: health → `app/api/health/route.ts`; analyze → `app/api/analyze/route.ts`, `lib/analyze.ts`; auth boundaries → `lib/identity.ts`; image guards → `lib/schema.ts` `ImageBase64Schema`, `lib/analyze.ts`; app shell → `app/page.tsx`, `app/layout.tsx`, `public/sw.js`, `app/manifest.ts`. |
| T1.3 | `node scripts/variants.mjs http://localhost:3111` | **21 passed, 0 failed** | See variation table below. |
| T1.5 | `node scripts/rag_probe.mjs http://localhost:3111` | **19 passed, 0 failed** | Which sections retrieval actually picked, per language, for free (the fixture echoes them). A FAIL naming an Indic query means the category-listing fallback in `lib/rag.ts` stopped working - the usual cause is someone putting the category label back into the query string, or re-adding `category`/`note` to the MiniSearch `fields`, which makes every document in a category match its own label. |
| T1.4 | `curl -s http://localhost:3111/api/health?full=1` | JSON with `corpus.sections >= 101`, `models.text` = `openai/gpt-oss-20b` (or your chosen model) | `data/laws/*.json` for corpus; `.env.local` for model. |

### T1 variation table (all with `is_working:true`; `variants.mjs` automates them)

| Input | Expected | Notes |
|---|---|---|
| Every category (Consumer, Tenant / Housing, Workplace / Labour, Police / FIR, Banking / Fraud, Cyber Fraud, Family / Marriage, Legal Aid, RTI, General, `""`) × every lang (en, hi, mr) = 33 combos | 200, `ok:true` | A failure names its combo. Check `CategorySchema`/`LangSchema` in `lib/schema.ts`, then `lib/prompts.ts` for that category/lang branch. |
| problem = 11 chars | 400 "at least a dozen characters" | boundary |
| problem = 12 chars | 200 | boundary |
| missing/empty body | 400 | |
| unknown category (`Spaceships`) | 200, falls back to General | **deliberate** (`ci()` fallback) |
| unknown lang (`fr`) | 200 (falls back to en) | deliberate |
| `<script>` inside problem | 200 | server stores text; **the UI must escape it** — see T2.9 |
| Devanagari problem | 200 | |
| malformed JSON body | **400** (fixed: routes now call `errorResponse(e)`, which keeps `ApiError.status` instead of hard-coding 500; pinned by `tests/http.test.ts`) | |
| chat: 0 msgs / 21 msgs / 6001-char msg | 400 each | `ChatRequestSchema` |
| chat: 1 msg | 200, `checks` contain skipped completion | |
| detect: 9 chars / 10 chars | 400 / 200 | |
| non-image data URL as `imageBase64` | refused with "not a readable image" | |
| image > ~1.7 MB base64 | 400 "Image too large" | |
| `GET /api/cases`, `/api/profile`, `/api/reminders` as guest | 401 | |
| `Authorization: Bearer a.b.c` | 401 (or 503 if Firebase not configured) — **never** treated as guest | `lib/identity.ts` |
| `GET /nope` | 404 | |
| `GET /api/health` | 200 or 503, **never 500** | |

---

## T2 — Browser / UI (still no token spend)

Open `http://localhost:3111`. Turn on test mode: either `?is_working=1` or localStorage `justiceai_is_working=1`
(the app then shows a chip "is_working is on — turn it off"; calls skip Groq). Console must show **0 errors**
through the whole tier (check DevTools Console after each step).

| ID | Steps | Expect | If it fails, look at |
|---|---|---|---|
| T2.1 | Load `/` | Title "JusticeAI — know your rights, file the complaint"; tabs: Analyse case, RTI application, Case history, Published cases, Find help, Fake notice check, Official sources, System vitals; disclaimer "not legal advice" visible | `components/Navbar.tsx` (`TABS`), `app/layout.tsx` |
| T2.2 | Click every tab in order | Each renders without a blank page or console error | `components/App.tsx`, `components/tabs/<Name>Tab.tsx` |
| T2.3 | Language select English → हिन्दी → मराठी | All labels change; no raw keys like `nav.analyse` shown | `lib/i18n.tsx` (missing key) |
| T2.4 | Dark-mode button 🌙, then reload | Theme toggles; survives reload; text readable in both | `lib/providers.tsx`, `app/globals.css` |
| T2.5 | Analyse: category chips (Consumer, RTI, Tenant / Housing, Workplace / Labour, Police / FIR, Banking / Fraud, Cyber fraud, Family / Marriage, General) | Each chip selectable, one active at a time | `components/tabs/AnalyseTab.tsx` |
| T2.6 | Analyse: type a problem ≥ 12 chars, submit (test mode) | Result view appears with disclaimer, deadlines/clocks, letter review checklist, citation chips, empty-state for precedents when none are verified | `components/ResultView.tsx`, `lib/analyze.ts` |
| T2.7 | Analyse: submit with 0 chars, 11 chars | Friendly inline error, no crash, no request spam | `AnalyseTab.tsx`, `lib/apiClient.ts` |
| T2.8 | 🎙 Dictate, 📎 Attach a photo | Dictate: works in Chrome/Edge, otherwise a friendly "not supported" message. Photo: non-image / > 1.7 MB refused with a message; **vision is off** so a valid photo must degrade gracefully, not crash | `AnalyseTab.tsx`, `lib/browser.ts`, `lib/groq.ts` `resolveVisionModel` |
| T2.9 | Problem text `<img src=x onerror=alert(1)>` | Shown as plain text; **no alert**, no HTML injected | `grep -rn dangerouslySetInnerHTML components app` → exactly **1** allowed hit: the constant theme-bootstrap script in `app/layout.tsx`. Any other hit is a bug. |
| T2.10 | RTI tab: fill applicant fields, submit | RTI letter view; applicant details appear in the letter; fields persist (localStorage `justiceai_profile`) | `components/tabs/RtiTab.tsx`, `lib/guestStore.ts` |
| T2.11 | Result → Download PDF (English letter) | A real `.pdf` downloads | `lib/pdf.ts` (jsPDF path) |
| T2.12 | Result in Hindi/Marathi → Download | Falls to the **print dialog** (by design — jsPDF has no Devanagari glyphs); no tofu boxes in the print preview | `lib/pdf.ts` `needsPrintPath` |
| T2.13 | Result → WhatsApp share / Read aloud / copy (whichever exist) | Opens/uses the right API or shows a graceful message | `ResultView.tsx` |
| T2.14 | Result → follow-up chat: send 1 message | Reply bubble appears; guest chat NOT saved server-side (`persisted=false`) | `lib/chat.ts`, `app/api/chat/route.ts` |
| T2.15 | Case history (guest): after T2.6 | Case listed, open it, delete it, list updates, reload keeps state | `components/tabs/HistoryTab.tsx`, `lib/guestStore.ts` (key `justiceai_cases`, max 100) |
| T2.16 | Case history with localStorage blocked (private window / disabled) | Page still works; message that history can't be stored | `lib/guestStore.ts` probe |
| T2.17 | Published cases tab | Verified cases listed with links, or an honest empty/“pending verification” state; **never** wording like "chance of winning" | `components/tabs/PrecedentsTab.tsx`, `data/precedents.json` |
| T2.18 | Find help tab | Real portals/directories render with links | `components/tabs/HelpTab.tsx`, `data/directories.json` |
| T2.19 | Fake notice check: paste a scam text, submit (test mode) | Result renders; never tells the user to pay | `components/tabs/DetectorTab.tsx`, `app/api/detect/route.ts` |
| T2.20 | Official sources tab | Source list with verified/unverified labels | `SourcesTab.tsx`, `scripts/verify_sources.mjs` |
| T2.21 | System vitals tab | Table of services; Firebase shows degraded (offline), others pass | `VitalsTab.tsx`, `lib/health.ts` |
| T2.22 | Mobile width 375 px: all tabs, menu ☰ | No horizontal scroll; menu opens/closes; buttons tappable | `Navbar.tsx`, `globals.css` |
| T2.23 | Offline (DevTools → Offline) after one load | App shell loads from service worker; API calls show a clear offline message; **API calls are never cached** | `public/sw.js` (must bypass `/api/`) |
| T2.24 | Install prompt / `/manifest.webmanifest` | Serves JSON with name and icons | `app/manifest.ts`, `public/icon*.svg` |
| T2.25 | Guest quota: turn test mode OFF is T3; here just confirm the quota text is shown after a real call | — | skip until T3 |

---

## T3 — LIVE Groq (spends tokens; ONCE per session; only if T0–T2 green)

Before running: server must be started with the **real** key (stop the dummy server, start normally with `npx next start -p 3111`).

```bash
EXPECTED_MODEL=openai/gpt-oss-20b node scripts/live_check.mjs http://localhost:3111 > live.log 2>&1
# PowerShell:  node scripts/live_check.mjs http://localhost:3111 2>&1 | Out-File -Encoding utf8 live.log
```
Takes up to several minutes if throttled. **Do not interrupt and rerun.** Read `live.log` once.

Known upstream facts for this key (measured; don't "discover" them again):
- Models listed: `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `openai/gpt-oss-safeguard-20b`, `qwen/qwen3.8-27b`. **Llama models return 404.** Vision: none.
- `gpt-oss-20b`: **8,000 tokens/minute** shared by prompt + completion, plus a daily token cap. It also spends hidden reasoning tokens, so output can be empty/truncated.
- If `gpt-oss-20b` is out of daily tokens, set `GROQ_TEXT_MODEL` and `GROQ_FAST_MODEL` to `openai/gpt-oss-120b` **and** run with `EXPECTED_MODEL=openai/gpt-oss-120b`. That is a config change, not a code change.

| ID | What `live_check` asserts | Typical failure → classification → where to look |
|---|---|---|
| T3.1 | health green, text model = expected, model in Groq's live list | model name wrong → **ENV** (`.env.local` `GROQ_TEXT_MODEL`). |
| T3.2 | English consumer case: 200, letter ≥3 paragraphs with To/Subject/Enclosures/signature, ≥2 rights, ≥2 steps, strength is a word not a %, citations only from our corpus, no invented phone/email, 2-year clock, escalation portals, disclaimer | `429` → **UPSTREAM** (stop). `HTTP 500 … did not match the legal-response schema` → **CODE**: read the `!` lines under it; they name the zod path. Fix in `lib/schema.ts` (tolerance) or `lib/prompts.ts` (shape instructions). Past example: `citations.0.act: Too small (>=2 chars)` from empty placeholder citations — handled by `CitationListSchema`; if it returns, the filter is not applied on that path. |
| T3.3 | Hindi RTI: Devanagari letter or an honest warning | empty completion / `SyntaxError: Expected ',' or '}'` = truncated JSON from reasoning-token use → look at `lib/groq.ts` (`finish_reason=length` retry doubles window once) and `GROQ_MAX_COMPLETION_TOKENS` / `GROQ_PROMPT_TOKEN_BUDGET` in `.env.local`. If it still fails after that retry once in a *fresh minute*, report; don't keep tuning. |
| T3.4 | Marathi tenant case: Devanagari, notice clocks, police route for forceful eviction | same as T3.3; also `data/guidance.json` for clocks. |
| T3.5 | Chat: real answer, refuses to promise an outcome, guest chat not persisted | 429 → UPSTREAM; wrong behaviour → `lib/chat.ts` system prompt. |
| T3.6 | Detect: flags scam, lists concrete red flags, never says "pay" | `lib/analyze.ts` `detectNotice`, `lib/prompts.ts`. |
| T3.7 | Prompt injection in the problem text: still valid analysis, no internals leaked | `lib/prompts.ts` guard text. |

Pass criteria: the final line `N passed, 0 failed`. **Acceptable partial result:** only `BLOCKED(upstream)` failures, with everything that did run passing. Never claim "all green" if any T3 row was blocked.

Cheaper manual spot-check if quota is tight (1 call): one English consumer analysis through the UI with test mode OFF, then read the result by eye (citations are real sections? deadline sensible? letter has placeholders for name/address rather than invented ones?).

---

## T4 — Data and content integrity (offline, run when `data/` changes)

| ID | Command / action | Expect | Where to look |
|---|---|---|---|
| T4.1 | `python -c "import json,glob;[json.load(open(f,encoding='utf-8')) for f in glob.glob('data/**/*.json',recursive=True)]"` | no exception | the file it names |
| T4.2 | `npm run verify:laws` | runs; reports sections not yet verified against India Code | `scripts/verify_sources.mjs` (network to indiacode.nic.in; needs internet). **Currently 6 of 101 sections are verified** — the rest are unchecked, so the app shows "awaiting verification" warnings. Don't hide that; verify sections against India Code over time. |
| T4.3 | `npm run verify:precedents` | each listed case has a working URL; only verified ones are shown to users | `data/precedents.json` (`categories` empty for Consumer/Tenant/Banking/etc. is expected → the UI empty state) |
| T4.4 | `npm run verify:links` | no 404 on portal links in `data/directories.json` / `guidance.json` | same script |
| T4.5 | Every law entry has `act`, `section`, `text`, `source_url` | `tests/rag.test.ts` enforces most of it | `lib/rag.ts` |

---

## T5 — Firebase / login / saved data (LAST; only with real Firebase config)

Skip entirely if `.env.local` has no `FIREBASE_ADMIN_SERVICE_ACCOUNT_B64`. Report `SKIPPED (no Firebase config)`.

Setup: restart the server **without** clearing the Firebase vars. Use a throw-away test account (e.g. `jai-test+1@yourdomain`), not a real user.

| ID | Steps | Expect | Where to look |
|---|---|---|---|
| T5.1 | `node scripts/probe_health.mjs` | `firebaseAdmin.selfTest` and `db.selfTest` PASS; overall OK, HTTP 200 | `lib/firebaseAdmin.ts` (bad/expired service account, wrong project id), `.firebaserc` |
| T5.2 | `/signup` → create account (email+password) | Redirect to app, navbar shows the user | `components/AuthForm.tsx`, `lib/firebaseClient.ts`, Firebase console → Authentication enabled |
| T5.3 | Sign out, `/login` with same credentials | Works; wrong password shows a readable error | `AuthForm.tsx` |
| T5.4 | Google sign-in | Popup completes; authorised domain includes `localhost` | Firebase console → Authentication → Settings → Authorized domains |
| T5.5 | Signed in: run one analysis (test mode OK for shape; one real call to confirm saving) | Response `saved:true`, case appears in Case history | `app/api/analyze/route.ts` (`saveCase`), `lib/db.ts` |
| T5.6 | Reload / sign in on another browser | Same case appears | `app/api/cases/route.ts`, `components/tabs/HistoryTab.tsx` |
| T5.7 | Open case → chat message → reload | Message persisted under the case | `app/api/cases/[caseId]/messages/route.ts` |
| T5.8 | Artifact (letter/RTI) saved with the case | Listed under the case | `.../artifacts/route.ts`, `saveArtifact` in `lib/db.ts` |
| T5.9 | Edit status (PATCH) and delete (DELETE) a case | Updates, then disappears | `app/api/cases/[caseId]/route.ts` |
| T5.10 | Profile save/load | Fields prefill RTI form | `app/api/profile/route.ts` |
| T5.11 | Guest → account migration: create 2 guest cases, sign up/in | Both appear in the account once; second login does not duplicate | `app/api/cases/migrate/route.ts`, `lib/db.ts` (migrate) |
| T5.12 | Reminders | `GET /api/reminders` lists; with no `RESEND_API_KEY` it degrades gracefully (no crash) | `lib/reminders.ts` |
| T5.13 | **Security: user A cannot read user B.** Sign in as A, copy B's `caseId`, `GET /api/cases/<B-id>` | 404/403, never B's data | `lib/db.ts` (every query scoped by `uid`) |
| T5.14 | **Firestore rules** `firestore.rules` | `users/{uid}/**` allowed only when `request.auth.uid == uid`; everything else denied. Deploy with `npm run deploy:rules`. | Firebase console → Firestore → Rules → Rules playground |
| T5.15 | Forged/expired token | 401, not treated as guest | `lib/identity.ts` |
| T5.16 | User quota | After `USER_MAX_ANALYSES_PER_DAY` real calls → 429 with renewal message | `lib/ratelimit.ts` (in-memory per server instance; resets on restart — expected) |

---

## 8. KNOWN, EXPECTED BEHAVIOUR (do not "fix" in a test loop)

- **Groq keys are a pool, and that is deliberate.** `GROQ_API_KEY`, `GROQ_API_KEY2..20` and
  `GROQ_API_KEYS` are merged, deduplicated and used round-robin, so two consecutive requests
  never share a key; a `429`/`401` inside one request moves to the next key. Rationale: each key
  has its own tokens-per-minute AND tokens-per-day allowance, and one key's daily cap is what
  used to kill the app mid-afternoon. `/api/health` prints `keys : pool of N -> ready/cooling/rejected`.
  A `401` key leaves rotation for the process - so "one key expired today" is not a code bug, and
  `git grep gsk_` over the history proves the keys were never committed.
- **Indic queries deliberately skip keyword ranking.** A Hindi/Marathi problem has no Latin words,
  so `lib/rag.ts` lists that category's own sections instead of ranking on stray digits. Proven
  by `npm run probe:rag` (T1.5). This is honest degradation, not a bug: the fix before this note
  retrieved the Indian Electricity Act for a security-deposit dispute.
- `/api/health` returns **503** whenever Firebase Admin is not configured. T1/T2 treat that as correct.
- `vision` is empty: Groq hosts no vision model on this key. Photo input must degrade gracefully (T2.8).
- Local quotas are raised (`GUEST_MAX_ANALYSES_PER_DAY=50` etc.). **Before production set 3 / 20 / 100** in the deploy environment, not in tests.
- Rate limiting is in-memory per server instance (resets on restart, not shared across Vercel instances). Fine for now; use Upstash/Redis if you need strictness.
- Unknown `category`/`lang` fall back silently to General/en (200, not 400).
- Most law sections show "awaiting verification" (6/101 verified). This is honest labelling, not a bug; verification is a content task (T4.2).
- Most precedent categories are empty on purpose until real cases are verified (T4.3).
- Hindi/Marathi PDF uses the browser print dialog, not jsPDF.
- Guest chats and cases live only in the browser (`localStorage`).
- Live tests are slow under throttling: a single call can take minutes (65 s waits). Slow ≠ broken.
- **Long-form UI copy in six tabs is English-only.** The dictionary is complete and enforced
  (`i18n coverage 93+ keys × 3 locales`, and no raw `key.name` ever reaches the screen), but
  headings/paragraphs hardcoded in JSX are not translated: measured Devanagari share of body
  text in हिन्दी was RTI 26%, History 20%, Published cases 11%, Find help 0%, Detector 26%,
  Sources 1%, Vitals 11% (Analyse was 86%). Translating those strings is an open content task,
  not a test failure - add the strings as dictionary keys so the coverage test protects them.

## 9. QUICK DECISION TABLE

| Symptom | It is | Do |
|---|---|---|
| `HTTP 429` / "Rate limit reached for model" / "tokens per day" | UPSTREAM | Stop. Wait for reset or switch model in `.env.local`. No code change. |
| `HTTP 404 … model … does not exist` | ENV | Set `GROQ_TEXT_MODEL`/`GROQ_FAST_MODEL` to a model in `/api/health?full=1` → `models.active`. |
| `HTTP 413` | CODE/ENV | Prompt too big: lower `GROQ_PROMPT_TOKEN_BUDGET` (default 3600) — check `lib/rag.ts` trimming. |
| `Expected ',' or '}'` / empty completion | UPSTREAM-ish | Truncated reasoning output. One retry already happens. Raise `GROQ_MAX_COMPLETION_TOKENS` once; if still failing, report. |
| `did not match the legal-response schema` + a zod path | CODE | Loosen/normalise that path in `lib/schema.ts`; add a test in `tests/schema.test.ts` reproducing it **first**. |
| Test passes locally in vitest but app fails | ENV | Stale server / wrong port / old `.next`. Kill, `npm run build`, restart on 3111. |
| `Firebase Admin is not configured` | ENV | Expected offline; only a problem in T5. |
| `connect ECONNREFUSED` in scripts | ENV | Server not running on the port used. |
| Garbage/spaced-out log text | ENV | UTF-16 file. Re-capture with `Out-File -Encoding utf8` (rule 8). |
| Everything green but a feature "looks wrong" | CODE | Write a failing vitest case first (T0), then fix. |

## 10. HOW TO ADD A NEW CHECK
1. Reproduce it in the cheapest tier possible (vitest > `variants.mjs` > UI > live).
2. Add it to that tier with an ID, expected result, and a "where to look" hint.
3. Update the baseline numbers at the top.