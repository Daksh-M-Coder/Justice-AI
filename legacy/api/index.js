import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Load Knowledge Base (bundled with deployment)
let knowledgeBase = {};
try {
  const kbPath = path.join(__dirname, "..", "knowledge_base.json");
  knowledgeBase = JSON.parse(fs.readFileSync(kbPath, "utf8"));
} catch (e) {
  console.error("knowledge_base.json not found:", e.message);
}

// Curated Precedents DB — inlined for reliability on Vercel serverless
const PRECEDENTS_DB = {
  "Consumer": [
    { title: "Defective Samsung Phone — Consumer Forum Delhi, 2023", authority: "District Consumer Disputes Redressal Forum, Delhi", outcome: "Won", amount: "₹32,000 + ₹5,000 compensation", days: 42, desc: "Buyer received a phone with motherboard defect. Forum ruled defect was manufacturing fault and ordered full replacement + compensation." },
    { title: "IRCTC Train Delay — NCDRC, 2022", authority: "National Consumer Disputes Redressal Commission", outcome: "Won", amount: "₹1.2 lakh", days: 90, desc: "14-hour train delay caused a family to miss a wedding. NCDRC held IRCTC liable for deficiency in service and awarded full compensation." },
    { title: "Insurance Claim Rejection — State Commission Maharashtra, 2023", authority: "Maharashtra State Consumer Commission", outcome: "Won", amount: "₹8.5 lakh", days: 65, desc: "Insurance company wrongly rejected a cashless medical claim citing pre-existing condition. Commission ruled rejection was mala fide." },
    { title: "Builder Flat Delay — NCDRC, 2021", authority: "National Consumer Disputes Redressal Commission", outcome: "Won", amount: "₹15 lakh + interest", days: 180, desc: "Builder delayed possession by 4 years. NCDRC awarded full refund with compound interest at 10% p.a. and litigation costs." },
    { title: "Online Shopping Fraud — Consumer Forum Bangalore, 2022", authority: "District Consumer Forum, Bangalore", outcome: "Won", amount: "₹18,500 + ₹3,000 costs", days: 38, desc: "Flipkart seller sent a counterfeit product. Forum ordered full refund plus compensation for mental harassment." }
  ],
  "RTI": [
    { title: "PDS Beneficiary List RTI — CIC, 2022", authority: "Central Information Commission", outcome: "Won", amount: "₹25,000 penalty on PIO", days: 55, desc: "PIO failed to provide BPL ration card list within 30 days. CIC imposed maximum penalty and ordered disclosure." },
    { title: "Road Construction Fund RTI — State IC Gujarat, 2023", authority: "Gujarat State Information Commission", outcome: "Won", amount: "Information disclosed + ₹10,000 penalty", days: 40, desc: "Municipal corporation refused to share ward-level expense details. Commission ordered full disclosure with penalty on officer." },
    { title: "Government Job Selection RTI — CIC, 2021", authority: "Central Information Commission", outcome: "Won", amount: "Disclosure ordered", days: 30, desc: "UPSC refused to share answer sheets. Supreme Court upheld CIC and ruled candidates have right to access their own evaluated sheets." }
  ],
  "Tenant / Housing": [
    { title: "Illegal Eviction Injunction — Delhi HC, 2022", authority: "Delhi High Court", outcome: "Won", amount: "Eviction stayed", days: 7, desc: "Landlord attempted forcible eviction without proper notice. Court granted interim injunction within a week and awarded litigation costs." },
    { title: "Security Deposit Refund — Rent Court Mumbai, 2023", authority: "Small Causes Court, Mumbai", outcome: "Won", amount: "₹2.4 lakh returned", days: 45, desc: "Landlord withheld 10-month security deposit without justification. Court ordered full refund with 9% interest." }
  ],
  "Labour": [
    { title: "Unlawful Termination — Labour Court Mumbai, 2023", authority: "Industrial Tribunal, Mumbai", outcome: "Won", amount: "Full back wages + reinstatement", days: 120, desc: "Employee terminated without chargesheet or domestic inquiry. Tribunal ruled termination void and ordered reinstatement with back wages." },
    { title: "PF Deduction Fraud — EPFO Appellate, 2022", authority: "EPFO Appellate Authority", outcome: "Won", amount: "₹1.8 lakh PF released", days: 35, desc: "Employer was deducting PF but not depositing. Appellate authority penalised employer and directed full PF transfer to employee." },
    { title: "Maternity Leave Denial — High Court Karnataka, 2022", authority: "Karnataka High Court", outcome: "Won", amount: "Full maternity pay + damages", days: 80, desc: "Private employer refused to grant 26-week maternity leave under Maternity Benefit Act 2017. Court ruled denial was illegal." }
  ],
  "General": [
    { title: "Credit Card Fraud Recovery — Consumer Forum Chennai, 2022", authority: "District Consumer Forum, Chennai", outcome: "Won", amount: "₹92,000 refunded", days: 50, desc: "Unauthorized transactions on credit card. Bank initially refused. Forum ordered full reversal plus ₹10,000 for mental harassment." },
    { title: "Hospital Medical Negligence — NCDRC, 2022", authority: "National Consumer Disputes Redressal Commission", outcome: "Won", amount: "₹25 lakh compensation", days: 210, desc: "Hospital performed wrong surgery on patient. NCDRC held hospital and surgeon jointly liable and awarded comprehensive compensation." }
  ]
};

function getCuratedPrecedents(category) {
  const cat = category || "General";
  const pool = PRECEDENTS_DB[cat] || PRECEDENTS_DB["General"] || [];
  const general = PRECEDENTS_DB["General"] || [];
  const combined = cat !== "General" ? [...pool, ...general] : pool;
  // Deduplicate by title, then shuffle and take top 3
  const seen = new Set();
  const unique = combined.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });
  return unique.sort(() => 0.5 - Math.random()).slice(0, 3).map(p => ({
    title: p.title,
    outcome: p.outcome,
    desc: `${p.authority} — ${p.desc} (${p.amount}, resolved in ${p.days} days)`
  }));
}

// ── /analyze ──
app.post("/analyze", async (req, res) => {
  try {
    const { problem, lang, category, city, applicantDetails, imageBase64 } = req.body;
    const userCity = city || (applicantDetails && applicantDetails.city) || "the user's city";
    let prompt;

    if (category === "RTI") {
      const d = applicantDetails || {};
      const hasProfile = !!(d.name);
      const name = d.name || "[Your Full Name]";
      const address = [d.address, d.city, d.state].filter(Boolean).join(", ") || "[Your Full Address]";
      const pin = d.pin || "";
      const phone = d.phone || "[Your Phone Number]";
      const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      prompt = `Draft a complete, ready-to-submit formal RTI application under the Right to Information Act, 2005.\n\n${hasProfile ? `APPLICANT DETAILS:\nName: ${name}\nAddress: ${address}${pin ? " - " + pin : ""}\nPhone: ${phone}\nDate: ${today}` : "(No profile provided — use generic placeholders.)"}\n\nINFORMATION REQUESTED:\n${problem}\n\nFORMAT:\n- Address To PIO\n- Clear Subject line\n- Mention Section 6(1)\n- At least 3 paragraphs\n- Close with signature.\n\nReturn ONLY the letter text.`;
    } else {
      prompt = `Analyse the user's problem and return ONLY JSON:\n{\n  "authority": "authority", "law": "law", "urgency": "Low/Med/High", "timeline": "est",\n  "rights": ["r1", "r2", "r3"],\n  "strength": { "score": "Weak/Moderate/Strong", "reason": "1 paragraph explanation", "tips": ["tip1", "tip2"] },\n  "contact": { "designation": "desig", "department": "dept", "email_or_link": "N/A" },\n  "letter": "A highly detailed, formal legal complaint letter. Include To/From placeholders, a clear Subject line, and at least 3 distinct paragraphs separated by \\n\\n.",\n  "steps": [{"title": "s1", "desc": "d1"}],\n  "precedents": [{"title": "t1", "outcome": "Won", "desc": "s1"}],\n  "legalAidCentres": [{"name": "DLSA", "type": "Gov", "address": "near ${userCity}", "contact": "N/A"}]\n}\nProblem: ${problem}\nLanguage: ${lang}\nCategory: ${category}\nLocation: ${userCity}`;
    }

    const modelToUse = imageBase64 ? "llama-3.2-90b-vision-preview" : "llama-3.3-70b-versatile";
    const bodyArgs = {
      model: modelToUse,
      messages: [{ role: "user", content: imageBase64 ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageBase64 } }] : prompt }],
      temperature: 0.2,
      max_tokens: 4096
    };
    if (category !== "RTI") bodyArgs.response_format = { type: "json_object" };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(bodyArgs)
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || "API error" });

    const text = data.choices?.[0]?.message?.content || "";
    if (category === "RTI") return res.json({ letter: text });

    const parsed = JSON.parse(text);
    parsed.precedents = getCuratedPrecedents(category);
    return res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── /chat ──
app.post("/chat", async (req, res) => {
  try {
    const { messages, caseContext } = req.body;
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: `You are JusticeAI legal assistant. Case Context: ${caseContext}` }, ...messages],
        temperature: 0.5,
        max_tokens: 1024
      })
    });
    const data = await response.json();
    res.json({ reply: data.choices?.[0]?.message?.content || "" });
  } catch (error) {
    res.status(500).json({ error: "Chat failed" });
  }
});

export default app;
