import { describe, expect, it } from "vitest";
import { computeDeadlines, formatCountdown, guidanceFor, LETTER_REVIEW_CHECKLIST, selfTest as guidanceSelfTest } from "@/lib/guidance";
import { precedentsFor, selfTest as precedentsSelfTest } from "@/lib/precedents";
import { renderReminderMail, selfTest as remindersSelfTest, upcoming } from "@/lib/reminders";
import { allowedCitations, analysisSystem, chatSystem, contextBlock, DISCLAIMER, rtiSystem } from "@/lib/prompts";
import { ALL_SECTIONS } from "@/lib/rag";

const DAY = 86_400_000;

describe("legal clocks (plan step 34)", () => {
  it("the RTI reply clock is 30 days and ticks down", () => {
    const r = computeDeadlines("RTI", Date.now() - 12 * DAY);
    const reply = r.data!.find((d) => d.key === "rti_reply")!;
    expect(reply.days).toBe(30);
    expect(reply.lapsed).toBe(false);
    expect(reply.dueInMs).toBeGreaterThan(17 * DAY);
    expect(reply.law).toMatch(/RTI Act/);
  });

  it("an old RTI shows as lapsed rather than quietly disappearing", () => {
    const r = computeDeadlines("RTI", Date.now() - 100 * DAY);
    const reply = r.data!.find((d) => d.key === "rti_reply")!;
    expect(reply.lapsed).toBe(true);
    expect(formatCountdown(reply)).toMatch(/lapsed/);
  });

  it("the two-year consumer limitation is present for consumer cases", () => {
    const r = computeDeadlines("Consumer", Date.now());
    expect(r.data!.some((d) => d.days === 730)).toBe(true);
  });

  it("every clock states where it comes from and is flagged for verification", () => {
    for (const cat of ["RTI", "Consumer", "Workplace / Labour", "Police / FIR", "Banking / Fraud", "Cyber Fraud", "Tenant / Housing", "Family / Marriage", "General"]) {
      const g = guidanceFor(cat);
      for (const d of g.deadlines) {
        expect(d.law.length).toBeGreaterThan(4);
        expect(typeof d.verify).toBe("boolean");
      }
      expect(g.escalation.length).toBeGreaterThanOrEqual(3);
      expect(g.checklist.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("escalation ladders only point at https portals (or none)", () => {
    for (const cat of ["RTI", "Consumer", "Banking / Fraud"]) {
      for (const step of guidanceFor(cat).escalation) {
        expect(step.portal === "" || step.portal.startsWith("https://")).toBe(true);
      }
    }
  });

  it("every generated letter carries the review checklist (plan step 39)", () => {
    expect(LETTER_REVIEW_CHECKLIST.length).toBeGreaterThanOrEqual(8);
    expect(LETTER_REVIEW_CHECKLIST.join(" ")).toMatch(/dates|citation|relief/i);
  });

  it("guidance self-test passes", () => {
    const r = guidanceSelfTest({ is_working: true });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe("precedents (plan steps 22-25)", () => {
  it("only verified judgments can be returned", () => {
    const r = precedentsFor("Police / FIR");
    expect(r.data!.cases.length).toBeGreaterThan(0);
    expect(r.data!.cases.every((c) => /indiankanoon|indiacode|sci\.gov\.in|nic\.in/.test(c.url))).toBe(true);
    expect(r.data!.cases.every((c) => c.citation.length > 0)).toBe(true);
  });

  it("an unverified category returns the honest empty state, never filler", () => {
    const r = precedentsFor("Consumer");
    expect(r.data!.empty).toBe(true);
    expect(r.data!.cases).toEqual([]);
    expect(r.data!.pending).toBeGreaterThan(0);
  });

  it("the label never promises a win probability", () => {
    expect(precedentsFor("General").data!.label).toMatch(/not a prediction/i);
  });

  it("precedents self-test passes", () => {
    expect(precedentsSelfTest({ is_working: true }).checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe("reminders (plan step 37)", () => {
  it("derives reminders from the saved cases' categories and start dates", () => {
    const r = upcoming([
      { id: "c1", category: "RTI", createdAt: Date.now() - 25 * DAY },
      { id: "c2", category: "Consumer", createdAt: Date.now() - 400 * DAY },
    ]);
    expect(r.data!.length).toBeGreaterThan(0);
    expect(r.data!.every((x) => typeof x.dueAt === "number")).toBe(true);
  });

  it("renders a mail without leaking 'undefined' into the body", () => {
    const rows = upcoming([{ id: "c9", category: "RTI", createdAt: Date.now() - 25 * DAY }]).data!;
    const mail = renderReminderMail(rows, "Asha");
    expect(mail.text).toContain("Asha");
    expect(mail.text).not.toMatch(/undefined|NaN/);
    expect(mail.text).toMatch(/not legal advice/i);
  });

  it("refuses to send when the channel is not configured, and says why", async () => {
    const r = await import("@/lib/reminders");
    const out = await r.sendEmail("someone@example.com", "subject", "body", { is_working: true });
    expect(out.data!.sent).toBe(false);
    expect(out.data!.reason).toMatch(/not configured/i);
  });

  it("reminders self-test passes", async () => {
    expect((await remindersSelfTest({ is_working: true })).checks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe("prompts (plan step 8)", () => {
  const sections = ALL_SECTIONS.filter((s) => s.category === "RTI").slice(0, 4);

  it("each system prompt carries the cite-only-what-we-gave-you rule", () => {
    for (const sys of [analysisSystem({ lang: "en", sections }), rtiSystem({ lang: "hi", sections }), chatSystem({ caseContext: "x", lang: "en", sections })]) {
      expect(sys).toMatch(/CITE ONLY/i);
      expect(sys).toMatch(/Never invent/i);
      expect(sys).toContain(DISCLAIMER);
    }
  });

  it("the context block quotes the act and section verbatim so the guard can match it", () => {
    const block = contextBlock(sections);
    expect(block).toContain("Right to Information Act, 2005");
    expect(allowedCitations(sections)).toMatch(/Section \S/);
  });

  it("an empty context says so instead of letting the model improvise", () => {
    expect(allowedCitations([])).toMatch(/say you are unsure/);
  });

  it("the Hindi and Marathi paths ask for Devanagari output", () => {
    expect(analysisSystem({ lang: "hi", sections })).toMatch(/Hindi \(Devanagari/);
    expect(analysisSystem({ lang: "mr", sections })).toMatch(/Marathi \(Devanagari/);
  });
});
