# JusticeAI — Legal Co-Pilot for Every Indian ⚖️

**🌟 Hackathon Live Demo: [https://justice-ai-pi.vercel.app](https://justice-ai-pi.vercel.app)**

JusticeAI is an intelligent, multilingual, and highly accessible web application designed to bridge the legal gap in India. It empowers citizens by converting their everyday problems (stated via text, voice, or images) into formal, actionable legal complaints and RTI applications.

## 🚀 Key Features

*   **AI Case Analysis:** Users can describe their problem in plain language (English, Hindi, or Marathi). The AI automatically identifies the relevant laws, authorities, urgency, expected timelines, and generates a formal, ready-to-file complaint letter.
*   **Multimodal Input:** Supports text input, native voice dictation (Speech-to-Text), and image uploads (parsing photos of FIRs or legal notices using Vision AI).
*   **RTI Application Generator:** A specialized flow to draft precise Right to Information (RTI) requests formatted strictly under the RTI Act, 2005.
*   **Legal Assistant Chatbot:** A context-aware chatbot on every analysis result that answers follow-up questions regarding the user's specific case.
*   **Accessibility First:** Features like Text-to-Speech (Read Aloud), one-click PDF downloading, and native WhatsApp sharing make the legal help easy to consume and distribute.
*   **Cross-Device Sync:** Authenticated users have their case history and profiles saved securely so they can start on mobile and review on desktop.

## 🛠️ Tech Stack & Architecture

### **Frontend (Client-Side)**
*   **Core:** Vanilla HTML5, CSS3, and JavaScript (No external UI frameworks).
*   **PWA Support:** Implements a Service Worker (`sw.js`) and `manifest.json` for offline caching, fast load times, and installability as a mobile app.
*   **Libraries:** `html2pdf.js` for client-side document generation.
*   **Design:** Custom responsive CSS grid/flexbox layouts. Features a rich Dark/Light mode toggle, dynamic tabs, and staggered CSS animations for smooth UI rendering.

### **Backend (Server-Side)**
*   **Environment:** Node.js using the Express framework.
*   **Hosting:** Triggered as Serverless Functions on Vercel (`api/index.js`), mapped via `vercel.json`.
*   **Security:** CORS enabled, environment variables for secrets, and `express-rate-limit` to prevent abuse (e.g., 100 requests per minute limit).

### **Artificial Intelligence Engine**
*   **Provider:** **Groq API** utilizing Meta's Llama models for ultra-fast inference.
*   **Models:** `llama-3.3-70b-versatile` for deep legal text reasoning, and `llama-3.2-90b-vision-preview` to handle image-based problems.
*   **Processing:** The backend rigorously parses the AI's response to repair and validate strict JSON schemas before sending it back to the client. Local legal constraints are supplemented via a `knowledge_base.json` file.

### **Authentication & Database**
*   **Provider:** **Firebase**
*   **Auth:** Supports standard Email/Password and Google OAuth sign-in.
*   **Firestore Database:** Securely stores user profiles (for auto-filling forms/letters) and synchronizes the user's "Case History" across devices. Guests use `localStorage` as a fallback.

## 📂 File Structure Overview

*   **`/public/index.html`** - The core Single Page Application containing the analysis tool, RTI generator, Case History, and Profile settings.
*   **`/api/index.js`** - The Express backend containing the `/analyze` and `/chat` endpoints communicating securely with the Groq AI API.
*   **`/public/login.html` & `/public/signup.html`** - Dedicated auth screens connected to Firebase Authentication.
*   **`/public/sw.js` & `/public/manifest.json`** - Progressive Web App configuration logic.
*   **`/data/knowledge_base.json`** - Static, verified legal data provided to the AI for enhanced accuracy.
*   **`vercel.json`** - Defines routing rules directing client traffic to the serverless backend.

## 🌐 Deployment
The project is optimized for deployment on Vercel. Code updates can be pushed seamlessly via the `npx vercel --prod` CLI command, ensuring zero downtime and immediate global propagation.
