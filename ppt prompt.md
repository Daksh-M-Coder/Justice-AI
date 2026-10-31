# Presentation Pitch Deck Prompt: JusticeAI

> **Instructions for the Presentation AI / Designer:**
> Generate a clean, modern, professional, high-impact presentation deck for an engineering project presentation.
> Design Aesthetic: Minimalist, authoritative, legal-tech theme (Navy blue / Slate dark tone with emerald/gold accents, crisp typography, clean cards, and no visual clutter).
> Maintain the exact slide order, tables, headers, and bullet structures outlined below.

---

## Slide 1: Title & Project Overview

### Header / Title:
**JusticeAI — Legal Co-pilot for Everyday Problems in India**

### Project Description:
> An AI-powered, statute-grounded legal assistant engineered to bridge the accessibility gap in Indian civil & administrative law. JusticeAI translates plain-language grievances in English, Hindi, and Marathi into actionable legal rights, verified statutory citations, limitation period clocks, and ready-to-dispatch formal legal notices.

### Team Metadata:
**Group No:** `[Insert Group No. here]`

### Team Members:
| Class / Div | Roll No | Full Name |
| :--- | :--- | :--- |
| **TE-IT-A** | 51 | Ravishankar Kanaki |
| **TE-IT-A** | 65 | Isha Jain |
| **TE-IT-A** | 66 | Daksh Maurya |

---

## Slide 2: The Problem

### Header / Title:
**The Problem: The Citizen-Law Divide in India**

### Key Problem Points:
1. **Intimidating Legal Jargon & Information Asymmetry:**
   - Common citizens face everyday issues (landlord disputes, consumer fraud, delayed RTIs, cyber harassment) but do not know which specific act, section, or jurisdiction applies.
2. **Prohibitive Early Consultation Costs:**
   - Drafting basic notices or discovering legal recourse typically requires expensive consultation fees, deterring citizens with genuine grievances.
3. **Language & Regional Barriers:**
   - Legal codes are primarily in English, excluding millions who communicate in Hindi, Marathi, or vernacular languages.
4. **The Critical Trap of Statutory Clocks (Limitation Acts):**
   - Missing strict statutory deadlines (e.g., 30 days for RTI replies, limitation periods for consumer complaints) permanently dismisses valid claims before action even begins.

---

## Slide 3: Our Solution

### Header / Title:
**Our Solution: Grounded, Anti-Hallucinatory Legal Assistance**

### Key Solution Highlights:
1. **Plain Language to Statutory Mapping:**
   - Converts natural language descriptions (English, Hindi, Marathi) into exact statutory provisions across 47+ Indian Acts and 101+ verified sections.
2. **Automated Legal Document Drafting:**
   - Instantly generates jurisdiction-accurate formal complaint letters, RTI applications, and notice drafts ready for print and dispatch.
3. **Active Statutory Deadline Clocks:**
   - Calculates and visualizes real-time countdown clocks and escalation ladders for statutory responses.
4. **Zero-Hallucination Legal Pipeline:**
   - Unlike generic LLMs that make up legal sections, JusticeAI uses deterministic citation guarding: only provisions retrieved from the verified statute corpus can be cited.

---

## Slide 4: Technology Stack & System Architecture

### Header / Title:
**Technical Architecture & Engineering Stack**

### Stack Breakdown:
- **Frontend & App Framework:** Next.js (App Router, Turbopack, React 19, TypeScript, Vanilla CSS design tokens).
- **Inference & LLM Orchestration:** Groq LPUs (`openai/gpt-oss-20b`), Structured JSON Mode (`Zod` validation), Dynamic multi-key round-robin pool with automatic cooling & failover.
- **RAG & Search Engine:** `MiniSearch` client/server in-memory vector & keyword retrieval over structured Indian statutes dataset (`data/laws/*.json`).
- **Data & Identity Layer:** Firebase Auth (JWT / Bearer token validation via Admin SDK), Cloud Firestore for case history & encrypted artifacts.
- **Verification & Diagnostic Suite:** Built-in self-testing framework (`/api/health`), Vitest automated unit/contract test suites (126 passing tests).

---

## Slide 5: Feasibility & Implementation Viability

### Header / Title:
**Feasibility: Technical, Operational & Economic**

### Key Pillars:
1. **Low-Latency, Cost-Efficient Inference:**
   - Leveraging Groq LPU inference provides ultra-fast response times (<1.5s per analysis turn) while minimizing per-query computing overhead.
2. **Multi-Key Pool Resilience:**
   - Automatically distributes API requests across multiple key quotas, handling 429/401 rate limits without service downtime.
3. **Progressive Web App (PWA) Offline Resilience:**
   - Works across low-bandwidth mobile networks; enables offline guest self-testing and local statute lookup.
4. **Modular Corpus Scalability:**
   - Adding new regional state laws or judicial precedents requires only updating declarative JSON datasets without redesigning the model engine.

---

## Slide 6: Reliability, Security & Safety

### Header / Title:
**Reliability: Legal Safety & Engineering Safeguards**

### Guardrails Implemented:
- **Strict Citation Guard (`citationGuard`):**
  - Cross-references model output against retrieved statute IDs; automatically strips unverified or invented sections before rendering to the user.
- **Contact & Domain Sanitization:**
  - Strips arbitrary links and emails; strictly enforces `.gov.in` and `.nic.in` for public authority directory contacts.
- **Schema Contracts & Repair Turn:**
  - Every response is validated against strict Zod schemas with a single automatic schema-repair loop if parsing fails.
- **Non-Advisory Disclaimer & Ethical Safety:**
  - Enforces explicit statutory notices on every view that information is for guidance, not formal advocate representation.

---

## Slide 7: Real-World Impact

### Header / Title:
**Real-World Impact & Societal Value**

### Impact Areas:
1. **Democratizing Access to Justice:**
   - Empowers students, tenants, gig workers, and small traders with immediate knowledge of their legal rights.
2. **Empowering Right to Information (RTI):**
   - Streamlines the draft-generation process for public interest queries and appeals.
3. **Multilingual Inclusivity:**
   - First-class support for Indic languages ensures legal access reaches grassroots communities.
4. **Reducing Court & Administrative Burden:**
   - Well-structured formal complaint drafts reduce ambiguous or poorly drafted petitions sent to consumer forums and ombudsmen.

---

## Slide 8: Conclusion & Future Scope

### Header / Title:
**Conclusion & The Road Ahead**

### Summary:
- JusticeAI demonstrates that combining specialized Retrieval-Augmented Generation (RAG) with deterministic verification produces a practical, hallucination-resistant civic tool.

### Future Roadmap:
- **Speech-to-Text & Audio Dictation:** Voice-first inputs for semi-literate users across rural districts.
- **E-Filing Portal Integrations:** Direct one-click export to official portals (National Consumer Helpline, RTI Online).
- **Expanded Statute Corpus:** Inclusion of state-specific municipal laws, tenancy acts, and High Court case laws.
