# JusticeAI — a legal co-pilot for ordinary problems in India

**Live app:** _(re-deploy this build; the previous URL served the legacy app)_

JusticeAI takes a problem described in plain English, Hindi or Marathi and returns the
office to go to, the sections that apply, the legal clock that is running, and a formal
letter you can print and post. It is **information, not legal advice**, and it says so on
every screen.

This repository was rewritten from a hackathon demo into a Next.js application with a real
statute corpus, verified precedents only, authenticated storage, and a self-test convention
built into every function. What changed and why is in [Migration](#migration-from-the-legacy-demo).

---

## Architecture

```
 Browser (React, App Router, PWA)
   │  components/App.tsx  ── tabs: Analyse · RTI · History · Cases · Help · Detector · Sources · Vitals
   │  lib/apiClient.ts    ── always POSTs { is_working } and reads the { ok, data, checks, error } envelope
   │  lib/firebaseClient  ── ID token (lazy; guest mode when unconfigured)
   ▼
 API routes (Node runtime, app/api/*)
   /api/analyze  /api/chat  /api/detect  /api/health
   /api/cases  /api/cases/[caseId]  /api/cases/[caseId]/messages  /api/cases/[caseId]/artifacts
   /api/cases/migrate  /api/profile  /api/reminders
   │  lib/http.ts        ── body limits, zod errors → 400, envelope → status
   │  lib/identity.ts    ── Bearer ID token → uid, or guest by IP
   │  lib/ratelimit.ts   ── guest 3/day, user 20/day, chat 100/day, burst brake
   ▼
 Engine
   lib/rag.ts        MiniSearch over data/laws/*.json  → top 5-8 sections for this query+category
   lib/prompts.ts    system prompt: "cite ONLY the sections supplied; if unsure, say so"
   lib/groq.ts       one LLM client: timeouts, size limits, live model list, ONE schema-repair retry
   lib/schema.ts     the zod contract every model answer must satisfy
   lib/precedents.ts verified judgments only
   lib/guidance.ts   statutory clocks, document checklists, escalation ladders, letter review
   ▼
 Data
   data/laws/*.json (101 sections / 47 acts, each with a source URL + verified flag)
   data/precedents.json   data/guidance.json   data/directories.json
   Firestore: users/{uid}/profile/data · users/{uid}/cases/{caseId}/(messages|artifacts)
   External: Groq (openai/gpt-oss-20b) · Firebase Auth · Firestore
```

### Data flow of one analysis

1. `POST /api/analyze` → zod-validates the body (`lib/schema.ts`), identifies the caller,
   charges the quota.
2. `retrieve()` ranks the statute corpus for the problem text + category and hands the
   winning sections to the prompt as the **only** citable material.
3. `chatJson()` asks Groq for JSON, parses it against `AnalysisSchema`; on failure it sends
   **one** repair turn with the zod errors; if that also fails the user gets a clean error
   and nothing is saved.
4. `citationGuard()` drops any citation whose *act and* section were not in the retrieved
   set (reported to the UI as "removed because we could not verify them").
5. `sanitizeContact()` strips emails/links that are not on a `.gov.in` / `.nic.in` domain.
6. Precedents come from the server-side verified dataset, never from the model.
7. Statutory clocks, checklists and the escalation ladder are attached from `data/guidance.json`.
8. Signed-in users' case + letter are written to their own Firestore subtree; guests get the
   response and keep it in `localStorage` until they sign up and migrate it.

## The `is_working` convention

**Every function in `lib/` and every API route accepts `{ is_working }`.**

```ts
const r = await analyzeCase(input, { is_working: true });
// r = { ok, data, checks: [{ fn, name, ok, detail, ms, skipped }], error, is_working }
```

- `is_working` false → normal execution; the checks are still recorded, so a real request
  carries its own trace.
- `is_working: true` → self-test: inputs and dependencies are validated, but **no completion
  is issued and no write happens**. The function returns a fixture plus the checks it made.
- `/api/health?full=1` runs the whole registry; the **System Vitals** tab renders it, and the
  navbar's `is_working` checkbox puts the entire app into probe mode.
- Quota probes roll their counter back, so monitoring never eats a user's daily allowance.
- Reads that cost nothing (Groq `GET /models`) do run in self-test mode; that is how the app
  tells you which models are actually alive.

## Tech choices

| Choice | Why |
| --- | --- |
| Next.js 16 (App Router, TS, Tailwind 4) | one runtime for UI + API, streaming, typed routes; killed the Express/static-file split |
| Zod 4 as the single response contract | the legacy code did `JSON.parse(text)` and trusted it |
| MiniSearch over JSON files, not a vector DB | 101 sections fit in memory; keyword + category ranking is auditable and free. Move to pgvector/Atlas only if recall gets worse |
| Firebase Auth + Firestore with Admin SDK | keeps the existing accounts; server verifies the ID token, rules enforce ownership |
| In-memory rate limiting | no extra dependency for a hackathon-scale app; the swap path is documented |
| jsPDF **or** the print pipeline | jsPDF core fonts have no Devanagari glyphs, so Hindi/Marathi letters print via the browser instead of rendering tofu |
| Hand-written service worker | 40 lines, explicit: never caches `/api/*` |

## Security measures

- **Key handling, stated accurately.** `.env` holds live Groq keys for local testing and is
  git-ignored: `.gitignore` has covered `.env*` since the first commit, `git check-ignore .env
  .env.local` reports both ignored, and `git grep gsk_` across every commit finds no key (only
  the grep pattern written into `test_checklist.md`). An earlier draft of this README claimed the
  key had leaked into git history - **that was wrong and is corrected here**; do not run
  `git filter-repo` for it. The real exposure is shipping the folder: never zip or share the
  tree with `.env` / `.env.local` inside, and do not re-declare `GROQ_API_KEY` in `.env.local`
  because it has higher precedence than `.env` and an empty value there silently blanks the key
  (this did happen during setup).
- **Multiple keys are a scaling mechanism, not a convenience.** `lib/keypool.ts` reads
  `GROQ_API_KEY`, the numbered `GROQ_API_KEY2` … `GROQ_API_KEY20`, and/or a comma-separated
  `GROQ_API_KEYS`, deduplicates them, and hands out the **next** key for every request, so two
  consecutive requests never share one. Each Groq key has its own tokens-per-minute *and*
  tokens-per-day allowance, which is the whole reason to have a pool: a spent key used to fail
  every user until the calendar day rolled over. Inside a single request, a `429` or `401/403`
  moves to the next key instead of failing (up to `GROQ_KEY_ATTEMPTS`, default 3); a `400/404/413`
  is a payload problem and does **not** walk the pool. A key rejected with `401/403` leaves
  rotation for the life of the process; a `429` cools for 60 s, or 30 min when Groq says the
  limit is per-day. `/api/health` reports `available / cooling / rejected` counts and slot
  labels like `key 3/4 (a1b2c3d4)` - position plus a truncated SHA-256, never key material,
  because these traces are returned to the browser.
- API routes verify `Authorization: Bearer <Firebase ID token>` with Admin SDK
  `verifyIdToken(token, true)`. A bearer token that does not verify is an **error**, never a
  silent downgrade to guest.
- `firestore.rules`: `match /users/{uid}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }` plus deny-everything default. Deploy with `npm run deploy:rules`.
- Guests: 3 analyses/day per IP; signed-in: 20/day, 100 chat messages/day; burst brake 12/min.
- Request bodies capped at 4 MB; images must be `image/jpeg|png|webp`, decoded size ≤ 1.5 MB,
  downscaled client-side before upload.
- Every model call has a timeout (`GROQ_TIMEOUT_MS`, default 45s) and aborts with the client
  request, so a closed tab stops the spend.
- No `innerHTML` anywhere with model/user text (React children + `textContent` only) — the
  legacy XSS surface is gone.
- Unknown keys from the model are stripped rather than fatal; *missing* required keys are fatal
  (retry, then clean error).

## Rate limits that come from the provider, not from us

Measured live on 2026-10-30 with this key, and designed for:

- **`openai/gpt-oss-20b` is metered at 8,000 tokens per minute and has a per-day token cap.**
  A first live run hit `HTTP 429 ... on tokens per da(y)` after a handful of real analyses -
  waiting does not recover it; the day does. `GROQ_FAST_MODEL` on a different model keeps the
  fake-notice checker usable when the main allowance is spent.
- The **prompt competes with the completion** in that window. An unrestricted corpus dump measured
  8,334 prompt tokens and was refused with `HTTP 413`, so the engine retrieves 6 sections, clamps
  each summary to 260 characters, estimates the prompt size (`GROQ_PROMPT_TOKEN_BUDGET`, default
  3,600) and **drops the lowest-ranked sections until it fits** - recording which ones it dropped.
  A live request now costs ~1,650 prompt + ~2,500 completion tokens.
- `gpt-oss` spends part of the completion budget on hidden reasoning tokens. At 1,800 tokens the
  answer came back **cut off mid-JSON**, so the client detects `finish_reason: "length"` or an empty
  completion, retries once with double the room, and reports a truncation as "the answer was cut
  off" instead of "the model broke the schema".
- A 429/5xx from Groq is retried **once** after `GROQ_RETRY_WAIT_MS` (6s), honouring `Retry-After`.

All four behaviours are unit-tested against a mocked Groq (`tests/analyze.e2e.test.ts`), so a
regression here fails `npm test` rather than surfacing as a user-visible error.

## Limitations (read these before calling it a legal product)

- **95 of 101 corpus sections are marked `verified: false`.** The summaries are written from
  knowledge of these Acts, not pasted from India Code, and every citation chip shows a `?`
  until you run `npm run verify:sources -- --write` and read the section. Do not print a
  letter with unverified section numbers on it.
- Precedents are deliberately sparse: 6 judgments verified on Indian Kanoon on 2026-10-30,
  and whole categories (Consumer, Tenant, Banking) show "coming soon" instead of filler.
- Rate limits and guest quotas are **per serverless instance**. Two cold starts can serve two
  counters. Swap `lib/ratelimit.ts` for Upstash Redis before any real traffic.
- No verbatim statutory text is shipped — the app quotes plain-language summaries. A user
  filing a matter must read the section itself.
- State law (rent control, stamp duty, income ceilings for legal aid, PECU limits) is not
  resolved per user location; the app names the state as a variable instead of guessing it.
- Photo input is refused politely: Groq lists no vision model for this key, so
  `GROQ_VISION_MODEL` stays empty and the app says the photo was not read. Set it when Groq
  adds one and the path activates without a code change.
- Reminders are computed and shown in-app. Email delivery needs `RESEND_API_KEY`; without it
  the app says so rather than pretending a mail went out. No WhatsApp integration.
- Case files are text-only. No document upload to storage, no e-signature, no filing.
- `lib/legalAidCentres` returned by the model is discarded; only official directory links are shown.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # http://localhost:3000
npm run check                # typecheck + vitest + build
node scripts/accept.mjs http://localhost:3000   # live safety assertions, spends nothing
```

**Groq** — set `GROQ_API_KEY`, and set a **monthly spend cap** in the Groq billing page (the
plan's hard requirement). One key works, but a pool is strongly recommended: add
`GROQ_API_KEY2`, `GROQ_API_KEY3`, … (or `GROQ_API_KEYS="a,b,c"`) and the app rotates them per
request, which multiplies the tokens-per-day ceiling that a single free key hits within an
afternoon of testing. Keys expiring or being deleted is normal here - a `401` key simply leaves
rotation and `/api/health` shows how many are left.

**Firebase (server)** — Project settings → Service accounts → *Generate new private key*, then:

```bash
# PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json")) | Set-Clipboard
# copy into .env.local as FIREBASE_ADMIN_SERVICE_ACCOUNT_B64 (and into Vercel)
```

Which models this key can actually use is not guessable - check it against the running app:

```bash
node -e "fetch('http://localhost:3000/api/health?full=1').then(r=>r.json()).then(j=>console.log(j.models.active.join('\n')))"
```

**Firestore** — create the database (production mode), then `npm run deploy:rules`
(requires `npm i -g firebase-tools; firebase login`). Emulator: `firebase emulators:start`.

**Vercel** — import the repo; add every variable from `.env.example` (Production + Preview);
`npm run build` is the build command; no `vercel.json` rewrites are needed any more — the
route handlers are the API.

## Verification workflow for the law data

```bash
npm run verify:sources              # dry-run report: which sources resolve and mention the section
npm run verify:laws -- --write      # flip verified:true where the machine check passed
npm run verify:precedents -- --write
npm run verify:links -- --write     # dead-link report for the directory tab
```

The script only marks something verified when the fetched page actually contains the Act name
and the section/case terms, and it records `verified_on` + `verified_via`. A 200 with matching
words is a machine check, not a legal opinion: open the section and read it before you trust a
generated letter. India Code is often slow or rate-limited from CI — run it from a normal
connection and treat "unreachable" as "still unverified".

## Tests

```bash
npm test          # 77 unit + integration tests (Vitest, no network)
```

Covered: the `is_working` envelope itself; the zod contract (repair-friendly normalisation,
fatal missing fields, oversized images); retrieval quality per category; the citation guard;
the mocked end-to-end analyse (including the one retry and the "never show an invented
citation" property); quota + probe rollback; identity boundaries; clock maths; the verified-only
precedent rule; PDF path selection; reminder rendering.

## Migration from the legacy demo

Deleted: `server.js`, `api/index.js` + `api_handler.js` + `vercel.json`, `index.html.backup`,
`extract_assets.js`, `extract_blocks.py`, `fix_theme.py`, `deploy_setup.py`.
Archived for reference under `legacy/` (old HTML/CSS/JS, `knowledge_base.json`, the fabricated
`precedents.json`).

Removed for truthfulness:

- **`PRECEDENTS_DB`** — invented cases with invented amounts ("IRCTC Train Delay — NCDRC, 2022,
  ₹1.2 lakh, 90 days"). Replaced by 6 real judgments checked against Indian Kanoon, labelled
  "Similar published cases"; nothing is presented as a win probability.
- **Fake lawyer profiles** — names, ratings, case counts and "free consultation" labels for
  advocates who do not exist. Replaced with official directories (NALSA/DLSA/Bar Council/
  eCourts) and a real eligibility checker.
- **The hardcoded "news" ticker** — replaced by links to primary records and a written policy.
- **Dead model IDs** — `llama-3.2-90b-vision-preview` is gone from Groq; the app now lists the
  live models and degrades gracefully.
- **Unvalidated `JSON.parse`** of the model's word, `innerHTML` of the model's word, and an
  unauthenticated `/analyze` with a 100/min limit shared by everyone. (The API key itself was
  never in git or in the old front-end - checked: `git grep gsk_` over every commit and a scan of
  `legacy/` both come back empty. It sat in a git-ignored `.env`, which is why this README's
  earlier draft was wrong to call it a repo leak.)

## Roadmap

1. Verify the corpus against India Code section by section and paste the authoritative text.
2. Add 10-20 verified consumer/tenancy/labour/RTI judgments per category from NCDRC and the
   High Court reports.
3. Swap the in-memory limiter for Upstash; add a per-uid spend ledger.
4. Real RSS-backed source feed (source + date on every item), replacing the current links list.
5. Structured intake: pincode → state → the correct forum and its current fee.
6. Filing pack: forms, court-fee computation, annexure order, and an "who to hand this to" note.
7. Accessibility pass with screen readers in Hindi and Marathi; a11y budget in CI.
8. Independent legal review before the word "rights" appears in marketing again.

---

_AI-generated information, not legal advice. Verify with a qualified lawyer._

