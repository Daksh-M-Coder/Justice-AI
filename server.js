import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const app = express();

// Load Knowledge Base
let knowledgeBase = {};
try {
  knowledgeBase = JSON.parse(fs.readFileSync(path.join(__dirname, "knowledge_base.json"), "utf8"));
  console.log("Knowledge Base loaded with", Object.keys(knowledgeBase).length, "categories.");
} catch(e) {
  console.error("Warning: knowledge_base.json not found or invalid.");
}

// Load Precedents Database
let precedentsDB = {};
try {
  precedentsDB = JSON.parse(fs.readFileSync(path.join(__dirname, "precedents.json"), "utf8"));
  console.log("Precedents DB loaded with", Object.keys(precedentsDB).length, "categories.");
} catch(e) {
  console.error("Warning: precedents.json not found.");
}

function getCuratedPrecedents(category) {
  const cat = category || "General";
  const pool = precedentsDB[cat] || precedentsDB["General"] || [];
  const general = precedentsDB["General"] || [];
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

// Middleware
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 100, 
  message: { error: "Too many requests from this IP, please try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Serve frontend static files from the root directory
app.use(express.static(path.join(__dirname, ".")));

// Serve index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// App logic... (omitted for brevity, keep existing /analyze and /chat)
// (Note: I'll redo the /analyze and /chat handlers to ensure they are correct)

app.post("/analyze", async (req, res) => {
  try {
    const { problem, lang, category, city, applicantDetails, imageBase64 } = req.body;
    const userCity = city || (applicantDetails && applicantDetails.city) || "the user's city";
    let prompt;
    if (category === "RTI") {
      const d = applicantDetails || {};
      const hasProfile = !!(d.name);
      const name = d.name || '[Your Full Name]';
      const address = [d.address, d.city, d.state].filter(Boolean).join(', ') || '[Your Full Address]';
      const pin = d.pin || '';
      const phone = d.phone || '[Your Phone Number]';
      const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      prompt = `Draft a complete, ready-to-submit formal RTI application under the Right to Information Act, 2005.\n\n${hasProfile ? `APPLICANT DETAILS:\nName: ${name}\nAddress: ${address}${pin ? ' - ' + pin : ''}\nPhone: ${phone}\nDate: ${today}` : `(No profile provided — use generic placeholders.)`}\n\nINFORMATION REQUESTED:\n${problem}\n\nFORMAT:\n- Address To PIO\n- Clear Subject line\n- Mention Section 6(1)\n- At least 3 paragraphs\n- Close with signature.\n\nReturn ONLY the letter text.`;
    } else {
      const categoryKnowledge = (category && knowledgeBase[category]) ? knowledgeBase[category].join("\\n- ") : "";
      prompt = `Analyse the user's problem and return ONLY JSON:\n{\n  "authority": "authority", "law": "law", "urgency": "Low/Med/High", "timeline": "est",\n  "rights": ["r1", "r2", "r3"], "strength": { "score": "Weak/Moderate/Strong", "reason": "1 paragraph explanation", "tips": ["tip1", "tip2"] }, "contact": { "designation": "desig", "department": "dept", "email_or_link": "N/A" },\n  "letter": "A highly detailed, formal legal complaint letter. Include To/From placeholders, a clear Subject line, and at least 3 distinct paragraphs separated by \\n\\n.", "steps": [{"title": "s1", "desc": "d1"}], "precedents": [{"title": "t1", "outcome": "Won", "desc": "s1"}],\n  "legalAidCentres": [{"name": "DLSA", "type": "Gov", "address": "near ${userCity}", "contact": "N/A"}]\n}\nProblem: ${problem}\nLanguage: ${lang}\nCategory: ${category}\nLocation: ${userCity}`;
    }
    const modelToUse = imageBase64 ? "llama-3.2-90b-vision-preview" : "llama-3.3-70b-versatile";
    const bodyArgs = { model: modelToUse, messages: [{ role: "user", content: imageBase64 ? [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageBase64 } }] : prompt }], temperature: 0.2, max_tokens: 4096 };
    if (category !== "RTI") bodyArgs.response_format = { type: "json_object" };
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` }, body: JSON.stringify(bodyArgs) });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || "API error" });
    const text = data.choices?.[0]?.message?.content || "";
    if (category === "RTI") return res.json({ letter: text });
    const parsed = JSON.parse(text);
    // Override AI-hallucinated precedents with curated real ones
    parsed.precedents = getCuratedPrecedents(category);
    return res.json(parsed);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/chat", async (req, res) => {
  try {
    const { messages, caseContext } = req.body;
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: `You are JusticeAI legal assistant. Case Context: ${caseContext}` }, ...messages], temperature: 0.5, max_tokens: 1024 }) });
    const data = await response.json();
    res.json({ reply: data.choices?.[0]?.message?.content || "" });
  } catch (error) { res.status(500).json({ error: "Chat failed" }); }
});

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});