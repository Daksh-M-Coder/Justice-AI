"use client";

/**
 * Find help (plan step 31). The legacy app invented advocate names, ratings, case
 * counts and 'free consultation' labels. Those are gone: this tab is (a) an eligibility
 * checker against the Legal Services Authorities Act categories and (b) official
 * directories only. No person's name or phone number is generated anywhere.
 */
import { useState } from "react";
import { DIRECTORIES } from "@/lib/guidance";
import { useI18n } from "@/lib/i18n";
import { useWorkMode } from "@/lib/providers";
import { track } from "@/lib/diag";
import type { WorkResult } from "@/lib/diag";
import { Badge, Btn, Card, Disclaimer, SectionTitle, Trace } from "@/components/ui";

interface Answers {
  category: string;
  income: string;
  gender: string;
  disabled: string;
  custodyOrLabour: string;
}

/** §12 LSA Act style categories: these groups are exempt from the income test. */
const INCOME_EXEMPT = ["SC / ST", "Woman or child", "Victim of trafficking / domestic violence", "Disabled (40%+)", "Industrial / agricultural labourer", "Unorganised sector worker", "Detained / in custody", "Victim of mass disaster, ethnic violence, caste atrocity, untouchability"];
const INCOME_TESTED = ["General", "OBC", "Other"];

export function checkEligibility(a: Answers, opts: { is_working?: boolean } = {}): WorkResult<{ eligible: boolean; why: string[]; next: string[] }> {
  const p = track<{ eligible: boolean; why: string[]; next: string[] }>("help.checkEligibility", opts);
  const why: string[] = [];
  const exempt = INCOME_EXEMPT.includes(a.category);
  if (exempt) why.push(`"${a.category}" is a category entitled to free legal services without the income test (Legal Services Authorities Act, 1987 - Sec 12).`);
  else if (a.income === "below") why.push("Your annual income is below the general ceiling, which is the income-tested route to eligibility.");
  else if (a.income === "above") why.push("Your stated income is above the usual ceiling, so eligibility depends on the other grounds.");
  else why.push("Income not stated - the income test could not be applied.");

  if (a.gender === "woman") why.push("Women are entitled to free legal services in most state schemes irrespective of income.");
  if (a.disabled === "yes") why.push("Disability is an independent ground for eligibility.");
  if (a.custodyOrLabour === "labour") why.push("Workmen (industrial / agricultural labour) are an independent ground.");
  if (a.custodyOrLabour === "custody") why.push("A person in custody has a right to free legal aid, irrespective of income.");

  const incomeMatters = !exempt && a.gender !== "woman";
  const eligible = exempt || a.gender === "woman" || a.disabled === "yes" || a.custodyOrLabour !== "none" || (incomeMatters && a.income === "below");
  p.check(`${why.length} ground(s) found`, true, eligible ? "likely eligible" : "not clearly eligible");
  p.check("income ceiling is never presented as a single national number", true, "the ceiling is notified by each State Legal Services Authority");

  return p.done({
    eligible,
    why,
    next: [
      "Apply at the District Legal Services Authority (DLSA) office in your district court, or at the legal services clinic in the court where your case is filed.",
      "Carry: ID proof, the papers relating to the case, and (if you rely on income) an income certificate or ration card.",
      "Ask specifically for: a panel advocate at State cost, exemption from court fee, and, if the other side has money, an interim order.",
      "If your matter is already filed, tell the court that you seek free legal aid - the court can refer you to the DLSA.",
    ],
  });
}

export function HelpTab() {
  const { t } = useI18n();
  const { working } = useWorkMode();
  const [a, setA] = useState<Answers>({ category: "General", income: "unknown", gender: "other", disabled: "no", custodyOrLabour: "none" });
  const [result, setResult] = useState<ReturnType<typeof checkEligibility> | null>(null);

  const run = () => setResult(checkEligibility(a, { is_working: working }));

  const set = (k: keyof Answers) => (v: string) => setA((cur) => ({ ...cur, [k]: v }));

  return (
    <div className="space-y-5">
      <Card className="rise">
        <SectionTitle eyebrow={t("aid.title")} title="Are you entitled to free legal aid?" sub="Five questions, matched against the categories in the Legal Services Authorities Act, 1987. The income ceiling differs by state, so the answer is 'likely', never 'guaranteed'." />

        <div className="space-y-4">
          <Group label="1. Which category do you belong to?" value={a.category} onChange={set("category")} options={[...INCOME_TESTED, ...INCOME_EXEMPT]} />
          <Group label="2. Annual household income" value={a.income} onChange={set("income")} options={[{ v: "below", l: "Below the ceiling notified by my state" }, { v: "above", l: "Above it" }, { v: "unknown", l: "Not sure" }]} />
          <Group label="3. Sex / age" value={a.gender} onChange={set("gender")} options={[{ v: "woman", l: "Woman or girl child" }, { v: "child", l: "Child (under 18)" }, { v: "other", l: "Other" }]} />
          <Group label="4. Disability of 40% or more?" value={a.disabled} onChange={set("disabled")} options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]} />
          <Group label="5. Are you in custody, or an industrial / agricultural labourer?" value={a.custodyOrLabour} onChange={set("custodyOrLabour")} options={[{ v: "custody", l: "In custody" }, { v: "labour", l: "Labourer" }, { v: "none", l: "Neither" }]} />
        </div>

        <div className="mt-4">
          <Btn onClick={run}>{working ? "Check (self-test)" : "Check eligibility"}</Btn>
        </div>
      </Card>

      {result?.data ? (
        <Card>
          <Badge tone={result.data.eligible ? "ok" : "warn"}>{result.data.eligible ? "Likely eligible for free legal services" : "Not clearly eligible - still worth asking the DLSA"}</Badge>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.88rem]">
            {result.data.why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <ol className="mt-3 space-y-1.5 text-[0.86rem]">
            {result.data.next.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold">{i + 1}.</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
          <Trace checks={result.checks} label="eligibility engine trace" />
        </Card>
      ) : null}

      <Card>
        <SectionTitle eyebrow="Official directories" title="Where to actually go" sub="Every entry below is a government or statutory body. The app deliberately shows no advocate names, ratings, case counts or phone numbers, because those were fabricated before." />
        <ul className="space-y-2.5">
          {DIRECTORIES.legal_aid.map((d) => (
            <li key={d.name} className="min-w-0 rounded-xl border border-[color:var(--color-line)] p-3">
              <p className="font-semibold">{d.name}</p>
              <p className="mt-1 text-[0.84rem] text-[var(--color-ink-soft)]">{d.use}</p>
              {d.url ? (
                <a className="mt-1 inline-block max-w-full break-all text-[0.78rem] font-semibold underline" href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.url.replace("https://", "")} ↗
                </a>
              ) : (
                <p className="mt-1 text-[0.76rem] text-[var(--color-warn)]">There is no single website for this one - it is run district by district, so search for your district legal services authority.</p>
              )}
              <span className="ml-2 align-middle">
                {/* raw enum tokens ("needs_check", "manual") were shown to users as badges */}
                <Badge tone={d.status === "verified" ? "ok" : "warn"}>{d.status === "verified" ? "link checked by us" : "check the link before you travel"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle eyebrow="Appointing an advocate yourself" title="What to insist on" />
        <ul className="list-disc space-y-1.5 pl-5 text-[0.86rem]">
          {DIRECTORIES.find_a_professional.map((d) => (
            <li key={d.name}>
              <span className="font-semibold">{d.name}:</span> {d.use}{" "}
              {d.url ? (
                <a className="underline" href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.url.replace("https://", "")} ↗
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Disclaimer text="Eligibility for free legal aid is decided by the Authority after looking at your documents, not by this app. If you are refused, ask for the refusal in writing - it can be reviewed." />
    </div>
  );
}

function Group({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (string | { v: string; l: string })[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.v;
          const l = typeof o === "string" ? o : o.l;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`rounded-full border px-3 py-1 text-[0.78rem] font-semibold transition ${value === v ? "border-[color:var(--color-brand)] bg-[var(--color-brand)] text-white dark:text-[var(--color-paper)]" : "border-[color:var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-brand-soft)]"}`}
            >
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
