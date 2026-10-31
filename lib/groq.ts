/**
 * Groq client: one place that talks to the LLM, with timeouts, size limits,
 * honest errors, model discovery and a single schema-repair retry.
 *
 * Self-test rule: completions (which cost money) are NEVER issued in
 * `is_working` mode; reads such as GET /models are allowed because they are free.
 */
import { z } from "zod";
import { envCheck, track, type Opts, type WorkResult } from "./diag";
import { acquire, attemptBudget, peek, reportFailure, reportSuccess, status as poolStatus, syncPool } from "./keypool";
import { extractJson, isParseError, parseWith } from "./schema";

const GROQ_URL = "https://api.groq.com/openai/v1";

export type Role = "system" | "user" | "assistant";
export interface ChatTurn {
  role: Role;
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export interface GroqConfig {
  apiKey: string;
  /** pool size and how many are currently usable - never the secrets */
  keyTotal: number;
  keyAvailable: number;
  textModel: string;
  fastModel: string;
  visionModel: string;
  timeoutMs: number;
  maxImageBytes: number;
}

export function config(opts: Opts = {}): WorkResult<GroqConfig> {
  const p = track<GroqConfig>("groq.config", opts);
  // Pool first: GROQ_API_KEY is one valid shape, but GROQ_API_KEYS and the numbered
  // GROQ_API_KEY2..20 style are what this deployment uses, and requiring the single variable
  // by name would call a healthy 4-key setup "not configured".
  const pool = syncPool();
  const st = poolStatus();
  p.check(`Groq key pool`, pool > 0, pool ? `${st.available}/${st.total} ready, ${st.cooling} cooling, ${st.rejected} rejected - rotating per request` : "no usable key: set GROQ_API_KEY (and GROQ_API_KEY2, ... or GROQ_API_KEYS)");
  if (pool > 1) p.check(`scaling note: ${pool} independent Groq allowances`, true, "each key carries its own tokens-per-minute and tokens-per-day budget");
  // Defaults are what this account actually serves. Groq no longer hosts any Llama model on
  // this key (verified live: GET /models returns gpt-oss-20b/120b, qwen3.8-27b, whisper,
  // prompt-guard, orpheus, allam) and asking for llama-* returns HTTP 404 "does not exist or
  // you do not have access to it", so the legacy llama defaults would break a fresh deploy.
  const textModel = envCheck(p, "GROQ_TEXT_MODEL", false) ?? "openai/gpt-oss-20b";
  const fastModel = envCheck(p, "GROQ_FAST_MODEL", false) ?? "openai/gpt-oss-20b";
  const visionModel = (process.env.GROQ_VISION_MODEL ?? "").trim();
  p.check(`vision model configured`, visionModel ? visionModel : "none set - image input will degrade gracefully (Groq currently hosts no vision model)");
  if (!pool) return p.done(null, "No Groq API key is configured on the server (set GROQ_API_KEY, GROQ_API_KEY2..., or GROQ_API_KEYS)");
  const first = peek();
  return p.done({
    // a representative key for callers that only need "is it configured"; the real send path
    // re-acquires per attempt so rotation is never short-circuited by this value
    apiKey: first?.value ?? "",
    keyTotal: st.total,
    keyAvailable: st.available,
    textModel,
    fastModel,
    visionModel,
    timeoutMs: Number(process.env.GROQ_TIMEOUT_MS ?? 45_000),
    maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 1_500_000),
  });
}

/* ── model discovery (plan step 9) ───────────────────────────────────────── */

export interface ModelList {
  ids: string[];
  fetchedAt: number;
  error?: string;
}

let modelCache: ModelList | null = null;

export async function listModels(opts: Opts = {}): Promise<WorkResult<ModelList>> {
  const p = track<ModelList>("groq.listModels", opts);
  const cfg = await Promise.resolve(config(opts));
  if (modelCache && Date.now() - modelCache.fetchedAt < 10 * 60_000) {
    p.check(`model list served from cache (${modelCache.ids.length} models)`);
    return p.done(modelCache);
  }
  if (!cfg.data) return p.done(null, cfg.error ?? "Groq not configured");
  try {
    // /models is free, so it may rotate too: if one key is expired the pool still answers
    let res: Response | null = null;
    let lastError = "";
    let usedKey = 0;
    const budget = Math.max(1, attemptBudget());
    for (let i = 0; i < budget; i += 1) {
      const acquired = acquire();
      if (!acquired) return p.done(null, "no Groq key configured");
      usedKey = acquired.slot.index;
      res = await fetchWithTimeout(`${GROQ_URL}/models`, {
        headers: { Authorization: `Bearer ${acquired.value}`, "Content-Type": "application/json" },
        timeoutMs: 10_000,
      });
      if (res.ok) {
        reportSuccess(acquired.slot.fingerprint);
        break;
      }
      lastError = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        reportFailure(acquired.slot.fingerprint, res.status, await res.clone().text().catch(() => ""));
        continue;
      }
      break;
    }
    if (!res) return p.done(null, "no attempt made");
    p.check(`GET /models returned ${res.status} (key ${usedKey} of ${poolStatus().total})`, res.ok, lastError);
    if (!res.ok) return p.done({ ids: [], fetchedAt: Date.now(), error: `HTTP ${res.status}` }, `model list unavailable (HTTP ${res.status})`);
    const body = (await res.json()) as { data?: { id: string }[] };
    const ids = (body.data ?? []).map((m) => m.id);
    modelCache = { ids, fetchedAt: Date.now() };
    p.check(`${ids.length} active model(s) reported by Groq`, ids.slice(0, 6).join(", ") + (ids.length > 6 ? " …" : ""));
    return p.done(modelCache);
  } catch (e) {
    return p.caught(e);
  }
}

/** Picks a working model for image input, or null when none is available. */
export async function resolveVisionModel(opts: Opts = {}): Promise<WorkResult<string | null>> {
  const p = track<string | null>("groq.resolveVisionModel", opts);
  const cfg = config(opts);
  if (!cfg.data) return p.done(null, cfg.error ?? "Groq not configured");
  const wanted = cfg.data.visionModel;
  if (!wanted) {
    p.check("GROQ_VISION_MODEL is empty", "image input will be refused with a clear message");
    return p.done(null, undefined);
  }
  const list = await listModels({ ...opts, is_working: false });
  const ids = p.attach(list, "listModels")?.ids ?? [];
  const live = ids.includes(wanted);
  p.check(`configured vision model "${wanted}" is still active on Groq`, live ? "active" : `NOT in the active list (${ids.length} models) - pick another`);
  return p.done(live ? wanted : null);
}

/* ── fetch with timeout + size guard ─────────────────────────────────────── */

export interface FetchOpts {
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function fetchWithTimeout(url: string, o: FetchOpts = {}): Promise<Response> {
  const controller = new AbortController();
  const ms = o.timeoutMs ?? Number(process.env.GROQ_TIMEOUT_MS ?? 45_000);
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${ms}ms`)), ms);
  const relay = () => controller.abort(new Error("request cancelled by client"));
  o.signal?.addEventListener("abort", relay);
  try {
    return await fetch(url, {
      method: o.body ? "POST" : "GET",
      headers: o.headers,
      body: o.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", relay);
  }
}

/* ── completion ──────────────────────────────────────────────────────────── */

const CompletionShape = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().optional() }))
    .min(1),
  usage: z.object({ completion_tokens: z.number(), prompt_tokens: z.number() }).optional(),
  model: z.string().optional(),
});

export interface ChatRequest {
  messages: ChatTurn[];
  model?: "text" | "fast" | "vision";
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** forwarded abort signal from the route so a cancelled browser request stops the spend */
  signal?: AbortSignal;
  /** internal: set on the automatic second attempt after a truncated answer */
  _grew?: boolean;
}

export interface ChatResponse {
  text: string;
  model: string;
  tokens?: { prompt?: number; completion?: number };
  /** the answer hit max_tokens, so the JSON is cut off mid-object (seen live with gpt-oss) */
  truncated?: boolean;
}

export async function chat(req: ChatRequest, opts: Opts = {}): Promise<WorkResult<ChatResponse>> {
  const p = track<ChatResponse>("groq.chat", opts);
  const cfg = config(opts);
  if (!cfg.data) return p.done(null, cfg.error ?? "Groq not configured");
  if (opts.is_working) {
    p.skip("completion", "is_working: no completion issued (completions cost money); config and inputs validated only");
    p.check(`${req.messages.length} turn(s) staged`, true, `model slot: ${req.model ?? "text"}`);
    // data is null by design and there is no error: a deliberate skip must not turn the
    // Vitals board red, otherwise "healthy but idle" looks like "broken"
    return p.done(null);
  }

  const want = req.model ?? "text";
  let model = want === "fast" ? cfg.data.fastModel : want === "vision" ? cfg.data.visionModel : cfg.data.textModel;
  if (want === "vision") {
    const v = await resolveVisionModel(opts);
    const resolved = p.attach(v, "resolveVisionModel");
    if (!resolved) return p.done(null, "Image input is unavailable right now: no active vision model on this Groq account. Describe the document in words instead.");
    model = resolved;
  }
  p.check(`model resolved: ${model}`, true);

  const requested = req.maxTokens ?? Number(process.env.GROQ_MAX_COMPLETION_TOKENS ?? 4000);
  const payloadOf = (withJson: boolean, maxTokens = requested) =>
    JSON.stringify({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.2,
      max_tokens: maxTokens,
      ...(withJson ? { response_format: { type: "json_object" } } : {}),
    });

  function wantsJsonMode() {
    return req.json !== false && (process.env.GROQ_JSON_MODE ?? "1") !== "0" && !jsonRejected.has(model);
  }

  // Not every hosted model accepts response_format (openai/gpt-oss-* may refuse it), and a
  // refused constraint would look like a bug in our schema rather than in the API. So: try
  // JSON mode, and if the model rejects the constraint, retry once as plain text and
  // remember that for the rest of this instance. extractJson() already strips fences/prose.
  let useJson = wantsJsonMode();
  let maxTokens = requested;
  let payload = payloadOf(useJson, maxTokens);
  p.check(`request payload within limit (${Math.round(payload.length / 1024)} KB)`, payload.length < 6_000_000);

  try {
    const sent = await postCompletions({ url: `${GROQ_URL}/chat/completions`, body: payload, timeoutMs: cfg.data.timeoutMs, signal: opts.signal });
    p.check(
      `key pool: used key ${sent.keyIndex} of ${sent.keyTotal}`,
      true,
      sent.keyTries > 1 ? `${sent.keyTries} key(s) tried - the earlier one was limited or expired` : "first key answered",
    );
    if (sent.waitedMs) p.check("every key was limited; waited and retried once", true, `slept ${sent.waitedMs}ms`);
    let res = sent.res;
    let raw = sent.raw;

    // A truncated or empty completion is not the user's fault: gpt-oss spends part of the
    // budget on hidden reasoning tokens, so a letter that fits in 4,000 tokens can still come
    // back cut off. Ask once for more room before giving up.
    if (res.ok && !req._grew) {
      const probe = CompletionShape.safeParse(JSON.parse(raw));
      const first = probe.success ? probe.data.choices[0] : undefined;
      const emptyOrCut = probe.success && (!first?.message?.content || first?.finish_reason === "length");
      if (emptyOrCut && requested < 8000) {
        maxTokens = Math.min(8000, Math.round(requested * 2));
        p.check("answer came back empty or cut off, retrying with more room", true, `${requested} -> ${maxTokens} completion tokens (finish_reason=${first?.finish_reason ?? "n/a"})`);
        const bigger = await postCompletions({ url: `${GROQ_URL}/chat/completions`, body: payloadOf(useJson, maxTokens), timeoutMs: cfg.data.timeoutMs, signal: opts.signal });
        res = bigger.res;
        raw = bigger.raw;
      }
    }

    // Two ways JSON mode fails upstream, both observed live on openai/gpt-oss-20b:
    // the model refuses the constraint (400 mentioning response_format), or it emits an
    // empty/invalid object and Groq rejects it (json_validate_failed + failed_generation).
    // Neither is worth failing the user for when extractJson() can read a plain answer.
    const jsonModeRejected =
      !res.ok && useJson && res.status === 400 && /response_format|json_object|structured|grammar|json_validate_failed|failed_generation|invalid_json/i.test(raw);
    if (jsonModeRejected) {
      jsonRejected.add(model);
      p.check("model rejected response_format; retried as plain JSON", true, `${model}: ${raw.slice(0, 120)}`);
      useJson = false;
      payload = payloadOf(false, maxTokens);
      const again = await postCompletions({ url: `${GROQ_URL}/chat/completions`, body: payload, timeoutMs: cfg.data.timeoutMs, signal: opts.signal });
      res = again.res;
      raw = again.raw;
    }

    p.check(`HTTP ${res.status} from Groq`, res.ok, res.ok ? `ok (json_mode=${useJson ? "on" : "off"})` : raw.slice(0, 240));
    if (!res.ok) {
      const nice = friendlyUpstream(res.status, raw);
      return p.done(null, nice);
    }
    const parsed = CompletionShape.safeParse(JSON.parse(raw));
    if (!parsed.success) return p.done(null, `unexpected response shape from Groq: ${parsed.error.issues[0]?.message ?? ""}`);
    const text = parsed.data.choices[0]?.message?.content ?? "";
    const finish = parsed.data.choices[0]?.finish_reason;
    const truncated = finish === "length";
    if (!text) {
      p.check(`completion non-empty`, false, `finish_reason=${finish ?? "n/a"}`);
      return p.done(null, "The model returned an empty answer twice (its reasoning filled the reply window). Try again, or shorten the problem a little.");
    }
    p.check(`completion non-empty (${text.length} chars)`, true, truncated ? "but it was cut off at the token limit" : "complete");
    return p.done({ text, model: parsed.data.model ?? model, tokens: parsed.data.usage ? { prompt: parsed.data.usage.prompt_tokens, completion: parsed.data.usage.completion_tokens } : undefined, truncated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return p.done(null, /abort|timed out/i.test(msg) ? "The model took too long to answer. Please try again." : msg);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SentResult {
  res: Response;
  raw: string;
  /** which pool slot answered (or the last one tried), 1-based, for the trace */
  keyIndex: number;
  keyTotal: number;
  /** how many distinct keys this one request went through */
  keyTries: number;
  rotated: boolean;
  waitedMs: number;
  /** why we stopped: the status that was not a key problem, or "budget" */
  stop: "ok" | "not-a-key-problem" | "budget" | "no-keys";
}

/**
 * A 401/403 or a 429 is a statement about ONE key. A 400/404/413/422 is a statement about the
 * payload, so trying four keys with the same broken body only wastes four round trips - the
 * caller is told to stop rotating in that case.
 */
function isKeyProblem(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/**
 * Send one completion, rotating across the Groq key pool.
 *
 * Rotation is the whole point: `openai/gpt-oss-20b` is metered per key on tokens-per-minute AND
 * tokens-per-day, and a single spent key used to fail the user no matter how long they waited
 * ("... on tokens per day"). With a pool, a 429 on key 2 quietly continues on key 3.
 *
 * If every key in the budget is limited and none of them will free up, we fall back to the old
 * behaviour: honour Retry-After once and try the key that cools down soonest.
 */
async function postCompletions(args: { url: string; body: string; timeoutMs: number; signal?: AbortSignal }): Promise<SentResult> {
  const budget = Math.max(1, attemptBudget());
  const status0 = poolStatus();
  let lastRes: Response | null = null;
  let lastRaw = "";
  let lastSlot: KeySlotLike = { index: 0, total: status0.total };
  let tries = 0;
  let rotated = false;
  let waitedMs = 0;

  for (let attempt = 0; attempt < budget; attempt += 1) {
    const acquired = acquire();
    if (!acquired) {
      return {
        res: new Response(JSON.stringify({ error: { message: "no Groq API key is configured on this server" } }), { status: 503, headers: { "content-type": "application/json" } }),
        raw: "",
        keyIndex: 0,
        keyTotal: status0.total,
        keyTries: 0,
        rotated,
        waitedMs,
        stop: "no-keys",
      };
    }
    lastSlot = acquired.slot;
    tries += 1;
    const res = await fetchWithTimeout(args.url, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${acquired.value}` },
      body: args.body,
      timeoutMs: args.timeoutMs,
      signal: args.signal,
    });
    const raw = await res.text();
    lastRes = res;
    lastRaw = raw;

    if (res.ok) {
      reportSuccess(acquired.slot.fingerprint);
      return { res, raw, keyIndex: acquired.slot.index, keyTotal: acquired.slot.total, keyTries: tries, rotated, waitedMs, stop: "ok" };
    }

    if (!isKeyProblem(res.status)) {
      // the body or the model name is wrong; another key would say exactly the same thing
      return { res, raw, keyIndex: acquired.slot.index, keyTotal: acquired.slot.total, keyTries: tries, rotated, waitedMs, stop: "not-a-key-problem" };
    }

    reportFailure(acquired.slot.fingerprint, res.status, raw);
    if (args.signal?.aborted) return { res, raw, keyIndex: acquired.slot.index, keyTotal: acquired.slot.total, keyTries: tries, rotated, waitedMs, stop: "budget" };
    if (attempt + 1 < budget) {
      rotated = true;
      continue; // next key, no sleep: that is the cheap win
    }
  }

  // Out of keys to try. One last patience attempt on the soonest-to-clear key, but ONLY for a
  // rate limit: an expired key is not coming back inside this request.
  const limited = lastRes && (lastRes.status === 429 || lastRes.status >= 500);
  if (lastRes && limited && !args.signal?.aborted && poolStatus().available === 0) {
    const retryAfter = Number(lastRes.headers.get("retry-after") ?? 0);
    const configured = Number(process.env.GROQ_RETRY_WAIT_MS ?? 6_000) || 6_000;
    waitedMs = Math.min(12_000, Math.max(1_000, Math.max(retryAfter * 1000, configured)));
    await sleep(waitedMs);
    const again = acquire();
    if (again) {
      tries += 1;
      lastSlot = again.slot;
      const res = await fetchWithTimeout(args.url, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${again.value}` },
        body: args.body,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      });
      const raw = await res.text();
      if (res.ok) reportSuccess(again.slot.fingerprint);
      return { res, raw, keyIndex: again.slot.index, keyTotal: again.slot.total, keyTries: tries, rotated: true, waitedMs, stop: "budget" };
    }
  }

  return {
    res: lastRes ?? new Response('{"error":{"message":"no attempt made"}}', { status: 500 }),
    raw: lastRaw,
    keyIndex: lastSlot.index,
    keyTotal: lastSlot.total,
    keyTries: tries,
    rotated,
    waitedMs,
    stop: "budget",
  };
}

interface KeySlotLike {
  index: number;
  total: number;
}

function friendlyUpstream(status: number, raw: string): string {
  let detail = "";
  try {
    detail = String((JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? "");
  } catch {
    detail = raw.slice(0, 200);
  }

  const st = poolStatus();
  if (status === 401 || status === 403) {
    return st.total > 1
      ? `Every Groq key in the pool was rejected (${st.rejected} of ${st.total} marked dead). They expire today - add fresh ones as GROQ_API_KEY2, GROQ_API_KEY3 ... `
      : "Groq rejected the only API key configured. Add a fresh key (GROQ_API_KEY, or GROQ_API_KEY2 for a second one).";
  }
  if (status === 429) {
    return st.total > 1
      ? `All ${st.total} Groq keys are at their limit right now (${detail.slice(0, 120) || "rate or daily token limit"}). Try again shortly - the pool spreads the load but today's allowances still run out.`
      : `This Groq account is rate-limited (${detail.slice(0, 140) || "too many requests or tokens per minute"}). Wait a minute and try again - or add GROQ_API_KEY2 for a second allowance.`;
  }
  if (status === 413) return "Your message plus attachments are too large for one request. Trim the text or the photo.";
  if (status >= 500) return `Groq is having trouble upstream (HTTP ${status})${detail ? `: ${detail.slice(0, 120)}` : ""}. Try again shortly.`;

  return `Upstream error (HTTP ${status})${detail ? `: ${detail.slice(0, 200)}` : ""}`;
}

/** Models that refused response_format in this instance - remembered, not retried per call. */
const jsonRejected = new Set<string>();

export interface JsonRequest<S extends z.ZodType> {
  schema: S;
  messages: ChatTurn[];
  model?: ChatRequest["model"];
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** builds the repair turn when the first answer failed validation */
  repair?: (previousText: string, errors: string) => string;
  signal?: AbortSignal;
  /** filled in by chatJson so the caller can report model + token usage */
  trace?: { model?: string; tokens?: { prompt?: number; completion?: number } };
}

export async function chatJson<S extends z.ZodType>(req: JsonRequest<S>, opts: Opts = {}): Promise<WorkResult<z.infer<S>>> {
  const p = track<z.infer<S>>("groq.chatJson", opts);
  const call: ChatRequest = {
    messages: req.messages,
    model: req.model,
    json: req.json !== false,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    signal: req.signal,
  };
  const first = await chat(call, opts);
  const stage1 = p.attach(first, "chat#1");
  if (stage1 && req.trace) {
    req.trace.model = stage1.model;
    req.trace.tokens = stage1.tokens;
  }
  if (!stage1) {
    // never fabricate an empty object as a "parsed" result: the caller's own
    // is_working branch produces the real fixture response
    return p.done(null, first.error ?? (opts.is_working ? undefined : "model call failed"));
  }

  let attempt = 0;
  let text = stage1.text;
  let errors = "";
  // trust the provider's own signal, not a guess from the parser text: V8 puts "position N"
  // in every JSON syntax error, so pattern-matching the message would call any malformed
  // answer "cut off". finish_reason === "length" is the real evidence.
  let truncatedSeen = Boolean(stage1.truncated);
  let parsed = parseWith(req.schema, text) as z.infer<S> | { parseError: string };

  while (isParseError(parsed) && attempt < 1) {
    attempt += 1;
    errors = parsed.parseError;
    // the drift itself is handled (we repaired it), so it is recorded as an
    // informational check - only an unrecovered failure marks the result not-ok
    p.check(`attempt ${attempt}: model returned invalid JSON, repairing`, true, errors.slice(0, 240));
    if (opts.is_working) {
      p.skip("repair call", "is_working: repair turn not sent");
      break;
    }
    const repairTurn: ChatTurn = {
      role: "user",
      content: req.repair ? req.repair(text, errors) : `Your answer failed validation: ${errors}. Return only a corrected JSON object.`,
    };
    const retry = await chat({ ...call, messages: [...req.messages, { role: "assistant", content: text }, repairTurn] }, opts);
    const rt = p.attach(retry, "chat#repair");
    if (rt && req.trace) {
      req.trace.model = rt.model;
      req.trace.tokens = rt.tokens;
    }
    if (rt) truncatedSeen ||= Boolean(rt.truncated);
    if (!rt) return p.done(null, retry.error ?? "repair call failed");
    text = rt.text;
    parsed = parseWith(req.schema, text) as z.infer<S> | { parseError: string };
  }

  if (isParseError(parsed)) {
    p.check("final validation", false, parsed.parseError.slice(0, 300));
    if (truncatedSeen) {
      // a cut-off answer is a size problem, and the fix is different (shorter input or a
      // bigger window), so it must not be reported as "the model ignored the schema"
      p.check("answer was truncated by the token limit", false, parsed.parseError.slice(0, 160));
      return p.done(null, "The model's answer was cut off before it finished. Try again, or shorten the problem text a little.");
    }
    return p.done(null, `The AI reply did not match the legal-response schema after one retry (last errors: ${parsed.parseError.slice(0, 220)}). Nothing was saved. Try again, ideally with fewer words in the problem.`);
  }
  p.check(`valid against ${attempt ? "repair" : "first"} attempt`, true, `${extractJson(text).length} chars of JSON`);
  return p.done(parsed as z.infer<S>);
}
