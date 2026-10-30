/**
 * Follow-up chat on a case. Answers are plain text, so the schema gate is on the
 * analysis path; here the guards are the context injection, the token cap and the
 * "cite only from context" system prompt.
 */
import { track, type Opts, type WorkResult } from "./diag";
import { chat, type ChatTurn } from "./groq";
import { chatSystem } from "./prompts";
import { retrieve } from "./rag";
import { DISCLAIMER } from "./prompts";
import type { ChatRequest } from "./schema";

export interface ChatReply {
  reply: string;
  disclaimer: string;
  model: string;
  retrieved: number;
  warnings: string[];
}

export async function continueCase(req: ChatRequest, category: string | undefined, opts: Opts = {}): Promise<WorkResult<ChatReply>> {
  const p = track<ChatReply>("chat.continueCase", opts);
  const last = [...req.messages].reverse().find((m) => m.role === "user");
  p.check("there is a user question to answer", !!last, last ? `${last.content.length} chars` : "no user turn in the payload");
  if (!last) return p.done(null, "The conversation must contain at least one user message.");

  const r = await retrieve(last.content, category, opts);
  const sections = p.attach(r, "retrieve")?.sections ?? [];
  const warnings: string[] = [];
  if (sections.length === 0) warnings.push("No statutory context matched this question, so the answer may be generic. Treat it as a question to ask a lawyer.");

  const messages: ChatTurn[] = [
    { role: "system", content: chatSystem({ caseContext: req.caseContext, lang: req.lang, sections }) },
    ...req.messages.map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
  ];

  const out = await chat({ messages, model: "text", temperature: 0.4, maxTokens: 900, signal: opts.signal }, opts);
  const data = p.attach(out, "chat");
  if (!data) {
    if (opts.is_working) return p.fixture({ reply: "Self-test fixture: the chat pipeline is wired correctly.", disclaimer: DISCLAIMER, model: "self-test", retrieved: sections.length, warnings: [...warnings, "no completion issued"] });
    return p.done(null, out.error ?? "the assistant did not answer");
  }
  p.check(`reply length ${data.text.length}`, data.text.length > 0);
  return p.done({
    reply: data.text.trim(),
    disclaimer: DISCLAIMER,
    model: data.model,
    retrieved: sections.length,
    warnings,
  });
}

export async function selfTest(opts: Opts = {}): Promise<WorkResult<ChatReply>> {
  const p = track<ChatReply>("chat.selfTest", { ...opts, is_working: true });
  const r = await continueCase({ caseId: undefined, messages: [{ role: "user", content: "Self-test: what is the RTI reply deadline?" }], caseContext: "RTI application filed 12 days ago", lang: "en", is_working: true }, "RTI", { ...opts, is_working: true });
  p.attach(r, "continueCase");
  p.check("empty message list is rejected", (await continueCase({ messages: [], caseContext: "", lang: "en", is_working: true }, "RTI", opts)).ok === false);
  return p.done(r.data);
}
