/**
 * Deadline reminders (plan step 37). Computing the clocks is real work and lives here;
 * the delivery channel is deliberately conservative: email via Resend when a key exists,
 * otherwise the reminder is shown in-app only. WhatsApp is not attempted.
 */
import { computeDeadlines, formatCountdown, type Countdown } from "./guidance";
import { track, type Opts, type WorkResult } from "./diag";

export interface Reminder {
  caseId: string;
  category: string;
  label: string;
  law: string;
  dueAt: number;
  dueInMs: number;
  human: string;
  lapsed: boolean;
}

interface CaseLike {
  id: string;
  category?: string;
  createdAt?: number;
}

export function upcoming(cases: CaseLike[], opts: Opts = {}, withinDays = 30): WorkResult<Reminder[]> {
  const p = track<Reminder[]>("reminders.upcoming", opts);
  const rows: Reminder[] = [];
  for (const c of cases.slice(0, 100)) {
    const started = Number(c.createdAt) || Date.now();
    const dl = computeDeadlines(c.category, started, opts);
    const list: Countdown[] = dl.data ?? [];
    for (const d of list) {
      const soon = d.dueInMs > 0 && d.dueInMs <= withinDays * 86_400_000;
      if (d.lapsed || soon) {
        rows.push({
          caseId: c.id,
          category: String(c.category ?? "General"),
          label: d.label,
          law: d.law,
          dueAt: d.dueAt,
          dueInMs: d.dueInMs,
          human: formatCountdown(d),
          lapsed: d.lapsed,
        });
      }
    }
  }
  rows.sort((a, b) => a.dueInMs - b.dueInMs);
  p.check(`${rows.length} reminder(s) derived from ${cases.length} case(s)`, true, `${rows.filter((r) => r.lapsed).length} already lapsed`);
  return p.done(rows);
}

export interface SendResult {
  sent: boolean;
  channel: "resend" | "none";
  reason: string;
}

/** Sends via Resend when configured; otherwise reports that it did nothing (no silent stubs). */
export async function sendEmail(to: string, subject: string, text: string, opts: Opts = {}): Promise<WorkResult<SendResult>> {
  const p = track<SendResult>("reminders.sendEmail", opts);
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.REMINDER_FROM ?? "").trim();
  p.check("RESEND_API_KEY configured", key.length > 0 ? "present" : "not set - reminders stay in-app only");
  if (!key || !from) {
    return p.done({ sent: false, channel: "none", reason: "Email delivery is not configured. Set RESEND_API_KEY and REMINDER_FROM, or rely on the in-app countdown." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return p.done({ sent: false, channel: "resend", reason: "The destination address is not valid." }, "invalid recipient");
  if (opts.is_working) return p.fixture({ sent: false, channel: "resend", reason: "is_working: no email was sent" }, "is_working: send skipped");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    p.check(`Resend returned ${res.status}`, res.ok, res.ok ? "queued" : (await res.text()).slice(0, 160));
    return p.done({ sent: res.ok, channel: "resend", reason: res.ok ? "queued with Resend" : "the provider refused the send" });
  } catch (e) {
    return p.caught(e);
  }
}

export function renderReminderMail(reminders: Reminder[], name: string): { subject: string; text: string } {
  const lines = reminders.map((r) => `- ${r.label} (${r.category}) — ${r.human} — ${r.law} [case ${r.caseId}]`);
  return {
    subject: `JusticeAI: ${reminders.length} legal clock${reminders.length === 1 ? "" : "s"} need attention`,
    text: `Hello ${name || "there"},\n\nThese deadlines are approaching or have passed on your saved cases:\n\n${lines.join("\n")}\n\nThese are automated reminders computed from the statutory periods listed in the app, not legal advice. Confirm each one with a lawyer before you rely on it.\n`,
  };
}

export async function selfTest(opts: Opts = {}): Promise<WorkResult<Reminder[]>> {
  const p = track<Reminder[]>("reminders.selfTest", { ...opts, is_working: true });
  const r = upcoming([{ id: "c1", category: "RTI", createdAt: Date.now() - 25 * 86_400_000 }], opts);
  p.attach(r, "upcoming");
  p.check("a 25-day-old RTI raises the 30-day reply clock", r.data?.some((x) => x.label.includes("PIO reply")) ?? false);
  const mail = renderReminderMail(r.data ?? [], "Test");
  p.check("mail body has no placeholder left", !mail.text.includes("undefined"));
  const s = await sendEmail("not-an-email", "x", "y", { ...opts, is_working: true });
  p.attach(s, "sendEmail");
  return p.done(r.data);
}
