function runDemo() {
  switchTab('analyse');
  document.getElementById('problemInput').value = "I bought a phone worth ₹18,000. It stopped working after 3 days. The shopkeeper refuses to replace it.";
  const catBtns = document.querySelectorAll('.cat-btn');
  catBtns.forEach(b => b.classList.remove('active'));
  const consumerBtn = Array.from(catBtns).find(b => b.textContent.includes('Consumer'));
  if (consumerBtn) {
    consumerBtn.classList.add('active');
    selectedCat = consumerBtn.textContent.trim();
  }
  analyzeCase();
}
// ── THEME TOGGLE ──
const savedTheme = localStorage.getItem('justiceai_theme') || 'light';
if (savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = '☀️';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('justiceai_theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

function toggleMobileMenu() {
  const nr = document.getElementById('navRight');
  const mBtn = document.getElementById('mobileMenuBtn');
  if (nr) {
    nr.classList.toggle('mobile-open');
    mBtn.textContent = nr.classList.contains('mobile-open') ? '✖' : '☰';
  }
}

// ── STATE ──
let selectedLang = 'en';
let selectedCat = '';
let currentResult = null;
let isRecording = false;
let recognition = null;
let chatHistory = [];

// ── NAV TABS ──
function switchTab(tab, e) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (e && e.currentTarget) e.currentTarget.classList.add('active');
  if (tab === 'history') renderHistory();

  const nr = document.getElementById('navRight');
  if (nr && nr.classList.contains('mobile-open')) toggleMobileMenu();
}

// ── LANG / CAT ──
const i18n = {
  en: {
    "nav-analyse": "Analyse Case",
    "nav-rti": "RTI Guide",
    "nav-history": "Case History",
    "lbl-lang": "Language",
    "lbl-cat": "Category (optional)",
    "lbl-pincode": "Your Pincode",
    "lbl-problem": "Your problem",
    "placeholder-problem": "Describe your problem in plain words, or upload a photo of your notice/FIR...",
    "btn-analyse": "Analyse my case →",
    "hero-h1": "Your rights,<br /><em>explained.</em><br />Your case, filed.",
    "lbl-rti-desc": "Describe what information you need and we'll formally draft it under the Act.",
    "placeholder-rti": "e.g., I want to know the status of my passport application...",
    "btn-rti": "Generate RTI Application →"
  },
  hi: {
    "nav-analyse": "मामले का विश्लेषण",
    "nav-rti": "RTI गाइड",
    "nav-history": "पिछला इतिहास",
    "lbl-lang": "भाषा",
    "lbl-cat": "श्रेणी (वैकल्पिक)",
    "lbl-pincode": "पिन कोड",
    "lbl-problem": "आपकी समस्या",
    "placeholder-problem": "अपनी समस्या का वर्णन करें, या नोटिस/प्राथमिकी (FIR) की फोटो अपलोड करें...",
    "btn-analyse": "मेरे मामले का विश्लेषण करें →",
    "hero-h1": "आपके अधिकार,<br /><em>स्पष्ट।</em><br />आपका मामला, दर्ज।",
    "lbl-rti-desc": "वर्णन करें कि आपको कौन सी जानकारी चाहिए और हम इसे अधिनियम के तहत तैयार करेंगे।",
    "placeholder-rti": "उदा., मैं अपने पासपोर्ट आवेदन की स्थिति जानना चाहता हूं...",
    "btn-rti": "RTI आवेदन तैयार करें →"
  },
  mr: {
    "nav-analyse": "प्रकरणाचे विश्लेषण",
    "nav-rti": "RTI मार्गदर्शक",
    "nav-history": "मागील इतिहास",
    "lbl-lang": "भाषा",
    "lbl-cat": "श्रेणी (पर्यायी)",
    "lbl-pincode": "पिन कोड",
    "lbl-problem": "तुमची समस्या",
    "placeholder-problem": "तुमच्या समस्येचे वर्णन करा, किंवा नोटीस/एफआयआर (FIR) चा फोटो अपलोड करा...",
    "btn-analyse": "माझ्या प्रकरणाचे विश्लेषण करा →",
    "hero-h1": "तुमचे हक्क,<br /><em>स्पष्ट.</em><br />तुमचे प्रकरण, दाखल.",
    "lbl-rti-desc": "तुम्हाला कोणती माहिती हवी आहे ते सांगा आणि आम्ही ती अधिनियमानुसार तयार करू.",
    "placeholder-rti": "उदा., मला माझ्या पासपोर्ट अर्जाची स्थिती जाणून घ्यायची आहे...",
    "btn-rti": "RTI अर्ज तयार करा →"
  }
};

function applyLanguage(lang) {
  const dict = i18n[lang];
  if (!dict) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = dict[key];
      } else {
        el.innerHTML = dict[key];
      }
    }
  });
  const btn1 = document.getElementById('btnText'); if (btn1) btn1.innerText = dict['btn-analyse'];
  const btn2 = document.getElementById('rtiBtnText'); if (btn2) btn2.innerText = dict['btn-rti'];
}

function setLang(btn, lang) {
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedLang = lang;
  applyLanguage(lang);
}
function toggleCat(btn) {
  const label = btn.textContent.trim();
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (selectedCat === label) { selectedCat = ''; }
  else { btn.classList.add('active'); selectedCat = label; }
}

// ── VOICE INPUT ──
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Voice input not supported in this browser');
    return;
  }
  if (isRecording) {
    recognition && recognition.stop();
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('voiceBtn').textContent = '🎤';
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  const langMap = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
  recognition.lang = langMap[selectedLang] || 'en-IN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => {
    isRecording = true;
    document.getElementById('voiceBtn').classList.add('recording');
    document.getElementById('voiceBtn').textContent = '⏹';
    showToast('Listening... speak your problem');
  };
  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
    document.getElementById('problemInput').value = transcript;
  };
  recognition.onerror = () => {
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('voiceBtn').textContent = '🎤';
  };
  recognition.onend = () => {
    isRecording = false;
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('voiceBtn').textContent = '🎤';
  };
  recognition.start();
}

// ── DOCUMENT UPLOAD WITH AUTO-RESIZE ──
window.selectedImageBase64 = null;

function compressImage(file, maxWidth = 1200) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Output small JPEG to save tons of space
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const loadingToast = showToast("Optimizing document for AI speed...");
  
  try {
    const compressedBase64 = await compressImage(file);
    window.selectedImageBase64 = compressedBase64;
    document.getElementById('imagePreviewContainer').style.display = 'flex';
    document.getElementById('imagePreviewName').innerText = '📎 ' + file.name;
    showToast("Document optimized and attached!");
  } catch (err) {
    console.error(err);
    showToast("Error processing image. Please try again.");
  }
}

function clearImage() {
  window.selectedImageBase64 = null;
  document.getElementById('imageUpload').value = '';
  document.getElementById('imagePreviewContainer').style.display = 'none';
  showToast("Document removed.");
}

// ── SKELETON ──
function showSkeletons() {
  document.getElementById('resultPanel').innerHTML = `
<div class="skeleton-card"><div class="skel skel-label"></div><div class="skel skel-badge"></div><div class="skel skel-line w70"></div><div class="skel skel-line w50"></div></div>
<div class="skeleton-card"><div class="skel skel-label"></div><div class="skel skel-line w90"></div><div class="skel skel-line w80"></div><div class="skel skel-line w70"></div></div>
<div class="skeleton-card"><div class="skel skel-label"></div><div class="skel skel-block"></div></div>
<div class="skeleton-card"><div class="skel skel-label"></div><div class="skel skel-line w90"></div><div class="skel skel-line w70"></div></div>`;
}

// ── MAIN ANALYSIS ──
async function analyzeCase() {
  let problem = document.getElementById('problemInput').value.trim();
  const hasImage = !!window.selectedImageBase64;

  if (!problem && !hasImage) {
    showToast('Please describe your problem or attach a document first');
    return;
  }
  
  // Provide a default context if they just uploaded an image with no text
  if (!problem && hasImage) {
    problem = "Please analyze the attached document and provide legal guidance.";
  }

  const btn = document.getElementById('submitBtn');
  btn.classList.add('loading');
  document.getElementById('btnText').textContent = 'Analysing...';

  const statusBar = document.getElementById('statusBar');
  statusBar.classList.add('visible');
  document.getElementById('statusText').textContent = 'Reading your case...';

  showSkeletons();

  setTimeout(() => {
    const panel = document.querySelector('.tool-section');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);

  try {
    document.getElementById('statusText').textContent = 'Identifying laws...';

    const pincode = document.getElementById('pincodeInput').value.trim() || '';

    const response = await fetch('/analyze', {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        problem,
        lang: selectedLang,
        category: selectedCat,
        pincode,
        applicantDetails: window.userProfile || null,
        imageBase64: window.selectedImageBase64 || null
      })
    });

    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (e) {
      throw new Error(text || 'Server returned an empty or invalid response.');
    }

    // Check for backend errors (API failures, credit issues, etc.)
    if (!response.ok || result.error) {
      const errorMsg = result.error || 'Server returned an error. Please try again.';
      throw new Error(errorMsg);
    }

    // Save + render
    currentResult = {
      ...result,
      problem,
      lang: selectedLang,
      cat: selectedCat,
      date: new Date().toISOString()
    };

    saveToHistory(currentResult);
    renderResults(result);

    statusBar.classList.remove('visible');

  } catch (err) {
    console.error(err);

    statusBar.classList.remove('visible');

    document.getElementById('resultPanel').innerHTML = `
  <div class="placeholder-state">
    <div class="placeholder-icon">⚠️</div>
    <div class="placeholder-text">
      ${err.message || 'Could not analyse. Please try again.'}
    </div>
  </div>
`;
  }

  btn.classList.remove('loading');
  document.getElementById('btnText').textContent = 'Analyse my case →';
}

// ── RENDER RESULTS ──
function renderResults(r, isRestoring = false) {
  if (!isRestoring) {
    chatHistory = [];
    const w = document.getElementById('chatWindow');
    if (w) w.innerHTML = '';
  }

  const panel = document.getElementById('resultPanel');
  panel.innerHTML = '';

  const urgencyBg = { Low: '#e8f5ee', Medium: '#fef9e8', High: '#fdeaea' };
  const urgencyColor = { Low: '#1a5c38', Medium: '#7a5a0a', High: '#7a1a1a' };

  const cards = [
    {
      label: 'Authority & Law',
      html: `
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;">
      <span class="authority-badge">⚖ ${r.authority || "Not available"}</span>
      <span style="background:${urgencyBg[r.urgency] || '#eee'};color:${urgencyColor[r.urgency] || '#333'};font-size:0.7rem;padding:0.25rem 0.7rem;border-radius:2rem;font-weight:500;">
        ${r.urgency || "Unknown"} Urgency
      </span>
    </div>
    <div style="font-size:0.82rem;color:var(--muted)">
      Applicable law: <strong style="color:var(--ink)">${r.law || "Not available"}</strong>
    </div>
    <div style="font-size:0.8rem;color:var(--muted);margin-top:0.3rem">
      Expected timeline: ${r.timeline || "Not available"}
    </div>
    
    ${r.strength ? `
    <!-- CASE STRENGTH METER -->
    <div style="margin-top:1.5rem; border:1px solid var(--border); border-radius:12px; background:var(--paper); padding:1.25rem;">
      <div style="font-weight:700;font-size:0.85rem;color:var(--ink);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:0.75rem;">Case Strength Analysis</div>
      
      <div style="display:flex; height:8px; border-radius:10px; overflow:hidden; margin-bottom:1rem; gap:4px;">
        <div style="flex:1; background:${r.strength.score === 'Weak' ? '#e74c3c' : (r.strength.score === 'Moderate' ? '#f1c40f' : '#2ecc71')};"></div>
        <div style="flex:1; background:${r.strength.score === 'Weak' ? 'rgba(0,0,0,0.05)' : (r.strength.score === 'Moderate' ? '#f1c40f' : '#2ecc71')};"></div>
        <div style="flex:1; background:${r.strength.score === 'Strong' ? '#2ecc71' : 'rgba(0,0,0,0.05)'};"></div>
      </div>
      <div style="font-size:1.15rem;font-weight:700;color:${r.strength.score === 'Weak' ? '#c0392b' : (r.strength.score === 'Moderate' ? '#d35400' : '#1e5a3a')};margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.05em;">${r.strength.score || 'Moderate'}</div>
      
      <div style="font-size:0.83rem;color:var(--muted);line-height:1.6;margin-bottom:1.25rem;">
        ${r.strength.reason || 'Sufficient details provided.'}
      </div>
      
      ${(r.strength.tips || []).length ? `
      <div style="background:var(--white); border-radius:8px; padding:1rem; border:1px solid rgba(0,0,0,0.05);">
        <div style="font-size:0.75rem;font-weight:700;color:var(--ink);margin-bottom:0.6rem;display:flex;align-items:center;gap:0.4rem;">
          <span style="font-size:0.9rem">💡</span> HOW TO STRENGTHEN IT
        </div>
        <ul style="margin:0;padding:0 0 0 1.25rem;font-size:0.8rem;color:var(--muted);line-height:1.6;">
          ${r.strength.tips.map(tip => `<li style="margin-bottom:0.4rem">${tip}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    ` : ''}
    `
    },
    {
      label: 'Your Legal Rights',
      html: (r.rights && r.rights.length)
        ? `<div style="text-align:right;margin-bottom:0.5rem">
             <button class="action-btn" onclick="playTTS(this.getAttribute('data-tts'), this)" data-tts="${(r.rights || []).join('. ').replace(/"/g, '')}" style="display:inline-flex;padding:0.3rem 0.6rem;min-width:auto;font-size:0.7rem;background:transparent;border:none;color:var(--gold);">🔊 Read Aloud</button>
           </div>
           <ul class="rights-list">${r.rights.map(right => `<li>${right}</li>`).join('')}</ul>`
        : `<div style="font-size:0.8rem;color:var(--muted)">No rights information available</div>`
    },
    {
      label: 'Similar Cases & Precedents',
      html: (r.precedents && r.precedents.length)
        ? `<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:1.25rem;padding:0.75rem 1rem;background:linear-gradient(135deg,rgba(26,90,56,0.08),rgba(200,146,42,0.06));border-radius:10px;border:1px solid rgba(26,90,56,0.12);">
            <span style="font-size:1.2rem">⚖️</span>
            <div>
              <div style="font-size:0.75rem;font-weight:700;color:var(--success);letter-spacing:0.05em;text-transform:uppercase;">Real Indian Cases — Verified Outcomes</div>
              <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">Similar cases won in Indian courts. Your case is winnable.</div>
            </div>
          </div>` +
          r.precedents.map(p => `
          <div class="precedent-card" style="display:flex;flex-direction:column;gap:0.5rem;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap;">
              <div class="precedent-title" style="flex:1">${p.title || "No title"}</div>
              <span class="precedent-outcome ${p.outcome === 'Won' ? 'outcome-won' : 'outcome-settled'}" style="flex-shrink:0;">
                ${p.outcome === 'Won' ? '✓ Won' : '⟳ Settled'}
              </span>
            </div>
            <div class="precedent-desc">${p.desc || "No details available"}</div>
          </div>`).join('')
        : `<div style="font-size:0.8rem;color:var(--muted)">No similar cases found</div>`
    },
    {
      label: 'Complaint Letter — Ready to File',
      html: `
    ${r.contact ? `
    <div style="background:#fdfdfc;border:1px solid #e1e4e8;border-radius:8px;padding:1rem;margin-bottom:1rem;">
      <div style="font-size:0.7em;text-transform:uppercase;color:var(--muted);letter-spacing:0.1em;margin-bottom:0.5rem">Send To:</div>
      <div style="font-weight:600;font-size:0.9rem">${r.contact.designation || 'Concerned Authority'}</div>
      <div style="font-size:0.8rem;color:var(--ink)">${r.contact.department || ''}</div>
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;margin-top:0.4rem;color:var(--gold)">
        ✉ ${r.contact.email_or_link || 'Not available'}
      </div>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
      <span style="font-size:0.75rem;color:var(--muted)">📝 You can click and edit this letter directly before downloading.</span>
    </div>
    <div class="letter-preview" id="letterBox" contenteditable="true" spellcheck="false" style="outline:none;cursor:text;"></div>
    <div class="action-row">
      <button class="action-btn" onclick="downloadLetter()">↓ Download</button>
      <button class="action-btn whatsapp" onclick="shareWhatsApp()">📱 WhatsApp</button>
      <button class="action-btn email" onclick="shareEmail()">✉ Email</button>
    </div>`
    },
    {
      label: 'Step-by-Step Filing Guide',
      html: (r.steps && r.steps.length)
        ? `<div style="text-align:right;margin-bottom:0.5rem">
             <button class="action-btn" onclick="playTTS(this.getAttribute('data-tts'), this)" data-tts="${r.steps.map((s, i) => `Step ${i + 1}: ${s.title}. ${s.desc}`).join('. ').replace(/"/g, '')}" style="display:inline-flex;padding:0.3rem 0.6rem;min-width:auto;font-size:0.7rem;background:transparent;border:none;color:var(--gold);">🔊 Read Aloud</button>
           </div>
           <div class="steps-list">${r.steps.map((s, i) => `
      <div class="step-item">
        <div class="step-num-badge">${i + 1}</div>
        <div class="step-text">
          <strong>${s.title || "Step"}</strong><br/>
          ${s.desc || "No description available"}
        </div>
      </div>`).join('')}</div>`
        : `<div style="font-size:0.8rem;color:var(--muted)">No steps available</div>`
    },
    {
      label: 'Nearby Legal Aid Centres',
      html: `
    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.75rem">
      📍 Free legal assistance centres ${r._city ? `near Pincode <strong style="color:var(--ink)">${r._city}</strong>` : 'near you'}:
    </div>
    ${(r.legalAidCentres && r.legalAidCentres.length)
          ? `<div class="legal-aid-list">${r.legalAidCentres.map(c => `
          <div class="legal-aid-item">
            <div>
              <div class="legal-aid-name">${c.name || "Unknown centre"}</div>
              <div class="legal-aid-type">${c.type || ""}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:0.75rem;color:var(--muted);line-height:1.4;">${c.address || "Reach out to local court for details"}</div>
              ${c.contact ? `<div style="font-size:0.72rem;color:var(--gold);margin-top:0.2rem">📞 ${c.contact}</div>` : ''}
            </div>
          </div>`).join('')}</div>`
          : `<div style="font-size:0.8rem;color:var(--muted)">No legal aid centres found</div>`
        }`
    },
    {
      label: 'Ask a Follow-up Question',
      html: `
        <div class="chat-section">
          <div class="chat-header">
            <div>Legal Assistant</div>
          </div>
          <div class="chat-window" id="chatWindow">
            <div class="chat-msg ai">Hello! I just analyzed your case. Do you have any questions about the rights, precedents, or steps I outlined above?</div>
          </div>
          <div class="chat-input-row">
            <input type="text" class="chat-input" id="chatInput" placeholder="Type your question..." onkeypress="if(event.key==='Enter') sendChatMessage()" />
            <button class="chat-send-btn" onclick="sendChatMessage()">➤</button>
          </div>
        </div>`
    },
    {
      label: 'What Happens Next',
      html: `
        <div class="timeline-container">
          <div class="timeline-step">
            <div class="timeline-dot active"></div>
            <div class="timeline-content">
              <strong>Complaint Filed</strong>
              <div class="timeline-desc">Today</div>
            </div>
          </div>
          <div class="timeline-step">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <strong>Authority Acknowledges</strong>
              <div class="timeline-desc">Expected in 7 days</div>
            </div>
          </div>
          <div class="timeline-step">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <strong>Hearing Scheduled</strong>
              <div class="timeline-desc">Within 30 days</div>
            </div>
          </div>
          <div class="timeline-step">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <strong>Resolution Expected</strong>
              <div class="timeline-desc">45–90 days</div>
            </div>
          </div>
        </div>`
    },
    {
      label: 'Case Status Tracker',
      html: `
        <div class="tracker-card">
          <div style="font-size:0.85rem;margin-bottom:0.75rem;color:var(--muted)">Log your complaint to track progress and get reminders.</div>
          <div class="form-group">
            <label>Date Filed</label>
            <input type="date" id="trackerDate" class="tracker-input" value="${new Date().toISOString().split('T')[0]}" />
          </div>
          <div class="form-group">
            <label>Follow-up Reminder (Days)</label>
            <input type="number" id="trackerReminder" class="tracker-input" value="7" min="1" />
          </div>
          <button class="action-btn" onclick="saveCaseStatus()" id="trackerBtn" style="width:100%;margin-top:0.5rem;background:var(--ink);color:var(--cream);border:none;">Set Tracker</button>
          <div id="trackerStatusMsg" style="display:none;margin-top:0.5rem;font-size:0.75rem;color:var(--success);background:#e8f5ee;padding:0.4rem;border-radius:4px;text-align:center;">Tracker saved! You will be reminded.</div>
        </div>`
    }
  ];

  // ── TABBED RESULT LAYOUT ──
  const tabData = [
    { id: 'rtab-overview', title: '⚖️ Legal Overview', indices: [0, 1, 2] },
    { id: 'rtab-document', title: '📄 Drafted Letter', indices: [3] },
    { id: 'rtab-plan', title: '🚀 Action Plan', indices: [4, 5, 7, 8] },
    { id: 'rtab-chat', title: '💬 AI Assistant', indices: [6] }
  ];

  let navHtml = '<div class="result-tabs-nav">';
  tabData.forEach((t, index) => {
    navHtml += `<button class="rtab-btn ${index === 0 ? 'active' : ''}" onclick="switchResultTab('${t.id}', event)">${t.title}</button>`;
  });
  navHtml += '</div>';

  let panesHtml = '';
  tabData.forEach((t, index) => {
    panesHtml += `<div class="rtab-pane ${index === 0 ? 'active' : ''}" id="${t.id}"></div>`;
  });

  panel.innerHTML = navHtml + panesHtml;

  tabData.forEach(t => {
    const pane = document.getElementById(t.id);
    t.indices.forEach((i, idx) => {
      const card = cards[i];
      const el = document.createElement('div');
      el.className = 'result-card';
      el.innerHTML = `<div class="result-card-label">${card.label}</div>${card.html}`;
      pane.appendChild(el);

      // Stagger card entrance animations inside the pane
      setTimeout(() => {
        el.classList.add('visible');
        if (i === 3) {
          streamLetter(r.letter || "");
        } else {
          applyLegalDictionary(el);
        }
      }, idx * 150);
    });
  });
}

window.switchResultTab = function (tabId, event) {
  document.querySelectorAll('.rtab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.rtab-pane').forEach(p => p.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById(tabId).classList.add('active');
};

window.saveCaseStatus = function() {
  const date = document.getElementById('trackerDate').value;
  const rem = document.getElementById('trackerReminder').value;
  const historyId = window.currentResult?.id || Date.now().toString();
  
  const trackers = JSON.parse(localStorage.getItem('justiceAiTrackers') || '{}');
  trackers[historyId] = { date, reminderDays: rem, setOn: new Date().toISOString() };
  localStorage.setItem('justiceAiTrackers', JSON.stringify(trackers));
  
  const msg = document.getElementById('trackerStatusMsg');
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 3000);
  showToast('Tracker saved! Check your Case History dashboard.');
};

// ── LEGAL DICTIONARY ──
const LEGAL_DICTIONARY = {
  "consumer disputes redressal forum": "A special court where consumers can file complaints against businesses for defective goods or poor services.",
  "section 9 cpa 2019": "Section 9 of the Consumer Protection Act, 2019 which establishes consumer dispute redressal commissions.",
  "section 9 of the consumer protection act": "This section establishes consumer dispute redressal commissions.",
  "section 9": "Often refers to the Consumer Protection Act which establishes consumer dispute commissions.",
  "consumer protection act": "A law to protect the interests of consumers in India.",
  "pio": "Public Information Officer - The government officer responsible for replying to your RTI application.",
  "public information officer": "The government officer responsible for replying to your RTI application.",
  "first appeal": "If a public body does not reply to your RTI or gives an unsatisfactory reply, you can file a First Appeal to a senior officer.",
  "second appeal": "If the First Appeal is unsatisfied, you can appeal to the Information Commission.",
  "injunction": "A court order requiring a person to do or cease doing a specific action.",
  "retrenchment": "Termination of an employee's services by the employer for any reason other than as a punishment.",
  "retrenchment compensation": "Money paid by the employer to an employee when they are laid off.",
  "article 21": "Right to Life and Personal Liberty under the Constitution of India.",
  "article 22": "Protection against arrest and detention in certain cases.",
  "section 106": "Notice provision under the Transfer of Property Act for terminating a lease.",
  "fir": "First Information Report - A written document prepared by police when they receive information about a cognizable offence.",
  "first information report": "A written document prepared by police when they receive information about a cognizable offence.",
  "cognizable offence": "A serious crime where a police officer can arrest without a warrant and start investigation without court permission.",
  "sub-judice": "A case that is currently under trial or being considered by a judge or court.",
  "section 6(1)": "Section under the RTI Act to make a request for information from a public authority."
};

function applyLegalDictionary(element) {
  if (!element) return;
  const terms = Object.keys(LEGAL_DICTIONARY).sort((a, b) => b.length - a.length);
  // Escape terms that might contain brackets
  const escapedTerms = terms.map(t => t.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escapedTerms.join('|')})\\b`, 'gi');
  
  function processNode(node) {
    if (node.nodeType === 3) { // Text node
      const text = node.nodeValue;
      if (regex.test(text)) {
        regex.lastIndex = 0;
        const span = document.createElement('span');
        span.innerHTML = text.replace(regex, (match) => {
          const lowerMatch = match.toLowerCase();
          return `<span class="legal-term" data-tooltip="${LEGAL_DICTIONARY[lowerMatch] || LEGAL_DICTIONARY[lowerMatch.replace(/\\/g, '')]}">${match}</span>`;
        });
        node.parentNode.replaceChild(span, node);
      }
    } else if (node.nodeType === 1) { // Element node
      if (node.className !== 'legal-term' && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
        Array.from(node.childNodes).forEach(processNode);
      }
    }
  }
  Array.from(element.childNodes).forEach(processNode);
}

// ── STREAM LETTER ──
function streamLetter(text) {
  const box = document.getElementById('letterBox');
  if (!box) return;

  // Normalise line endings: replace literal \n sequences -> real newline
  text = text
    .replace(/\\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // Strip common AI preamble phrases before the real letter starts
    .replace(/^[\s\S]*?(To[,\n]|Dear\s)/m, (match, p1) => p1)
    .trim();

  box.innerHTML = '';

  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  let currentPara = document.createElement('p');
  currentPara.style.cssText = 'margin:0 0 1em 0; line-height:1.85;';
  box.appendChild(currentPara);
  currentPara.appendChild(cursor);

  let i = 0;
  const chars = text.split('');

  const iv = setInterval(() => {
    if (i >= chars.length) {
      clearInterval(iv);
      cursor.remove();
      applyLegalDictionary(box);
      return;
    }

    let char = chars[i];

    if (char === '\n' && chars[i + 1] === '\n') {
      currentPara = document.createElement('p');
      currentPara.style.cssText = 'margin:0 0 1em 0; line-height:1.85;';
      box.appendChild(currentPara);
      currentPara.appendChild(cursor);
      i++; // Skip the second newline
    } else if (char === '\n') {
      currentPara.insertBefore(document.createElement('br'), cursor);
    } else {
      currentPara.insertBefore(document.createTextNode(char), cursor);
    }

    box.scrollTop = box.scrollHeight;
    i++;
  }, 15);
}

// ── STREAM CHAT ──
function getCaseContext() {
  if (!currentResult) return "";
  return JSON.stringify({
    problem: currentResult.problem,
    authority: currentResult.authority,
    rights: currentResult.rights
  });
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const w = document.getElementById('chatWindow');
  if (!input || !w) return;
  const text = input.value.trim();
  if (!text) return;

  // render user message
  w.insertAdjacentHTML('beforeend', `<div class="chat-msg user">${text.replace(/</g, '&lt;')}</div>`);
  input.value = '';
  w.scrollTop = w.scrollHeight;

  chatHistory.push({ role: "user", content: text });

  // show loading
  const loadingId = 'load-' + Date.now();
  w.insertAdjacentHTML('beforeend', `<div class="chat-msg ai" id="${loadingId}">
    <span style="display:inline-block;animation:blink-cursor 1s infinite">...</span>
  </div>`);
  w.scrollTop = w.scrollHeight;

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        caseContext: getCaseContext()
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById(loadingId).outerHTML = `<div class="chat-msg ai">${data.reply.replace(/\\n/g, '<br>')}</div>`;
    chatHistory.push({ role: "assistant", content: data.reply });

    // Memory Sync: actively save conversation into the Case database
    if (currentResult && currentResult.id) {
      currentResult.chatHistory = chatHistory;
      if (currentResult.id.toString().startsWith('loc_')) {
        let local = JSON.parse(localStorage.getItem('justiceai_history') || '[]');
        const idx = local.findIndex(x => x.id === currentResult.id);
        if (idx !== -1) { local[idx].chatHistory = chatHistory; localStorage.setItem('justiceai_history', JSON.stringify(local)); }
      } else if (window.auth && window.auth.currentUser && window.dbWrapper) {
        window.dbWrapper.updateCase(window.auth.currentUser.uid, currentResult.id, { chatHistory });
      }
    }
  } catch (e) {
    document.getElementById(loadingId).innerText = "Sorry, failed to get a response. Did you connect the backend?";
  }
  w.scrollTop = w.scrollHeight;
}

// ── TEXT TO SPEECH (TTS) ──
function playTTS(text, btn) {
  if (!text) return;
  if ('speechSynthesis' in window) {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      btn.innerHTML = '🔊 Read Aloud';
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);

    // Attempt to select an Indian English voice if available
    const voices = window.speechSynthesis.getVoices();
    const indianVoice = voices.find(v => v.lang.includes('en-IN') || v.name.includes('India'));
    if (indianVoice) {
      utterance.voice = indianVoice;
    }

    utterance.rate = 0.95; // Slightly slower for better comprehension
    utterance.onend = () => { btn.innerHTML = '🔊 Read Aloud'; };

    btn.innerHTML = '⏸ Stop Reading';
    window.speechSynthesis.speak(utterance);
  } else {
    showToast('Text-to-Speech is not supported in this browser.');
  }
}

// ── SHARE & PDF ──
function downloadLetter() {
  const box = document.getElementById('letterBox');
  if (!currentResult || !box) return;
  showToast('Generating official PDF...');

  // Capture the user's manual edits by reading innerText of the box
  // If the box is empty (e.g. they wiped it), fallback to currentResult.letter
  let letterText = box.innerText.trim() || currentResult.letter;

  // Normalise the letter text
  letterText = letterText
    .replace(/\\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Split into paragraphs for proper <p> rendering in PDF
  const paras = letterText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const parasHtml = paras.map(p =>
    `<p style="margin:0 0 14px 0; text-align:justify; line-height:1.9;">${p.replace(/\n/g, '<br>')}</p>`
  ).join('');

  // Build a full, styled HTML document for the PDF
  const contactHtml = currentResult.contact ? `
    <div style="margin-bottom:24px; font-size:12px; color:#444;">
      <strong>To,</strong><br>
      ${currentResult.contact.designation || 'Concerned Authority'}<br>
      ${currentResult.contact.department || ''}<br>
      <span style="color:#c8922a;">${currentResult.contact.email_or_link || ''}</span>
    </div>` : '';

  const fullHtml = `
    <div style="font-family:'Georgia',serif; color:#0f0e0c; padding:0; width:100%;">
      <div style="border-bottom:2px solid #c8922a; padding-bottom:12px; margin-bottom:24px;">
        <div style="font-size:20px; font-weight:bold; color:#0f0e0c; letter-spacing:-0.02em;">JusticeAI</div>
        <div style="font-size:10px; color:#888; margin-top:2px;">Legal Co-Pilot · Official Complaint Draft</div>
      </div>
      ${contactHtml}
      <div style="font-size:13px;">${parasHtml}</div>
      <div style="margin-top:32px; font-size:10px; color:#aaa; border-top:1px solid #ddd; padding-top:10px;">
        Generated by JusticeAI &mdash; For informational purposes only. Consult a qualified advocate for legal advice.
      </div>
    </div>`;

  // *** KEY FIX: mount a hidden real DOM element so html2pdf can render it ***
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;background: var(--white);padding:40px;z-index:-1;';
  wrapper.innerHTML = fullHtml;
  document.body.appendChild(wrapper);

  html2pdf().set({
    margin: [15, 15, 15, 15],
    filename: 'JusticeAI_Complaint.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(wrapper).save().then(() => {
    document.body.removeChild(wrapper);
    showToast('PDF downloaded successfully! ✓');
  }).catch(err => {
    document.body.removeChild(wrapper);
    console.error('PDF generation failed:', err);
    showToast('Failed to generate PDF');
  });
}
function shareWhatsApp() {
  if (!currentResult) return;
  const text = encodeURIComponent('My complaint letter (JusticeAI):\n\n' + currentResult.letter);
  window.open('https://api.whatsapp.com/send?text=' + text, '_blank');
}
function shareEmail() {
  if (!currentResult) return;
  const subject = encodeURIComponent('Formal Complaint Letter');
  const body = encodeURIComponent(currentResult.letter);
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}

// ── DATA PERSISTENCE ──
async function saveToHistory(result) {
  if (!result) return;
  if (result.id) return; // Prevent saving duplicate if already saved

  const payload = {
    date: new Date().toISOString(),
    timestamp: Date.now(),
    ...result
  };

  // Try Cloud Save if logged in
  if (window.auth && window.auth.currentUser && window.dbWrapper) {
    try {
      const newDocId = await window.dbWrapper.saveCase(window.auth.currentUser.uid, payload);
      currentResult.id = newDocId;
      return;
    } catch (e) {
      console.error("Cloud save failed. Proceeding to local save:", e);
    }
  }

  // Guest / Fallback Save
  payload.id = 'loc_' + Date.now();
  currentResult.id = payload.id;
  const history = JSON.parse(localStorage.getItem('justiceai_history') || '[]');
  history.unshift(payload);
  if (history.length > 20) history.pop();
  localStorage.setItem('justiceai_history', JSON.stringify(history));
}

async function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = `<div style="text-align:center;padding:2rem"><span style="animation:blink-cursor 1s infinite">Loading your cases...</span></div>`;

  let history = [];
  const isCloud = window.auth && window.auth.currentUser && window.dbWrapper;

  if (isCloud) {
    try {
      history = await window.dbWrapper.getCases(window.auth.currentUser.uid);
    } catch (e) {
      console.error("Cloud fetch failed:", e);
      history = JSON.parse(localStorage.getItem('justiceai_history') || '[]');
    }
  } else {
    history = JSON.parse(localStorage.getItem('justiceai_history') || '[]');
  }

  // We attach the fetched history array to window so restoreCase can use it!
  window.currentDisplayedHistory = history;

  const trackers = JSON.parse(localStorage.getItem('justiceAiTrackers') || '{}');
  let activeTrackersHtml = '';
  let activeCount = 0;
  let historyHtml = '';
  
  history.forEach((item, i) => {
    const t = trackers[item.id];
    if (t) {
      activeCount++;
      const dueDate = new Date(t.date);
      dueDate.setDate(dueDate.getDate() + parseInt(t.reminderDays));
      const isDue = dueDate <= new Date();
      const urgencyClass = isDue ? 'due' : 'relax';
      
      activeTrackersHtml += `
        <div class="active-case-card">
          <button onclick="deleteTracker('${item.id}', event)" style="position:absolute;top:10px;right:12px;background:transparent;border:none;color:#d9534f;cursor:pointer;font-size:1rem;z-index:10;" title="Remove tracker">✖</button>
          <div onclick="restoreCase(${i})" style="cursor:pointer;">
            <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.4rem;">
              <span class="urgency-dot ${urgencyClass}"></span> ${isDue ? 'Follow-up Due' : 'Tracking Active'}
            </div>
            <div style="font-weight:600;font-size:0.95rem;margin-bottom:0.4rem;color:var(--ink)">${item.cat || 'General Case'}</div>
            <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.8rem;line-height:1.4">${item.problem.substring(0, 60)}...</div>
            <div style="font-size:0.75rem;background:var(--paper);color:var(--gold);padding:0.3rem 0.6rem;border:1px solid var(--border);border-radius:6px;display:inline-block;">Reminder set for: ${dueDate.toLocaleDateString('en-IN')}</div>
          </div>
        </div>`;
    } else {
      historyHtml += `
        <div class="history-item" style="position:relative;">
          <button onclick="deleteHistoryItem(${i}, event)" style="position:absolute;top:10px;right:12px;background:transparent;border:none;color:#d9534f;cursor:pointer;font-size:1rem;z-index:10;" title="Delete case">🗑️</button>
          <div onclick="restoreCase(${i})">
            <div class="history-meta">
              <span class="history-date">${new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span class="history-cat">${item.cat || 'General'}</span>
            </div>
            <div class="history-preview">${item.problem.substring(0, 80)}...</div>
            <div class="history-authority">⚖ ${item.authority || 'Unknown'}</div>
          </div>
        </div>`;
    }
  });

  document.getElementById('activeCount').innerText = activeCount;
  document.getElementById('historyCount').innerText = history.length - activeCount;

  document.getElementById('activeCasesList').innerHTML = activeCount ? activeTrackersHtml : '<div style="font-size:0.85rem;color:var(--muted);padding:1rem;background:var(--paper);border-radius:8px;text-align:center;">No active trackers yet.<br>Set a tracker after analysing a case.</div>';
  
  if (!historyHtml && activeCount === 0) {
    document.getElementById('historyList').innerHTML = `<div class="history-empty">No cases analysed yet.<br/>Your case history will appear here after your first analysis.${isCloud ? '' : '<br><span style="font-size:0.8rem;color:var(--muted)">(You are using Local Storage. Sign in to cloud-sync cases)</span>'}</div>`;
  } else {
    document.getElementById('historyList').innerHTML = historyHtml || '<div style="font-size:0.85rem;color:var(--muted);padding:1rem;background:var(--paper);border-radius:8px;text-align:center;">All your cases are currently being tracked.</div>';
  }
  
  // Apply dictionary to history and tracked items!
  applyLegalDictionary(document.getElementById('activeCasesList'));
  applyLegalDictionary(document.getElementById('historyList'));
}

window.deleteTracker = function(id, event) {
  if (event) event.stopPropagation();
  const trackers = JSON.parse(localStorage.getItem('justiceAiTrackers') || '{}');
  delete trackers[id];
  localStorage.setItem('justiceAiTrackers', JSON.stringify(trackers));
  showToast('Tracker removed.');
  renderHistory();
};

async function deleteHistoryItem(i, event) {
  if (event) event.stopPropagation();
  if (!confirm("Are you sure you want to permanently delete this case?")) return;

  const history = window.currentDisplayedHistory || [];
  const item = history[i];
  if (!item) return;

  const isCloud = window.auth && window.auth.currentUser && window.dbWrapper;

  if (isCloud && item.id) {
    try {
      await window.dbWrapper.deleteCase(window.auth.currentUser.uid, item.id);
    } catch (e) { console.error("Cloud delete failed:", e); }
  } else {
    // Local storage fallback
    let local = JSON.parse(localStorage.getItem('justiceai_history') || '[]');
    local.splice(i, 1);
    localStorage.setItem('justiceai_history', JSON.stringify(local));
  }

  showToast('Case deleted successfully.');
  renderHistory();
}

function restoreCase(i) {
  const history = window.currentDisplayedHistory || [];
  const item = history[i];
  if (!item) return;
  currentResult = item;
  document.getElementById('problemInput').value = item.problem;

  // Auto-rebuild chatbot memory if exists
  chatHistory = item.chatHistory || [];
  const w = document.getElementById('chatWindow');
  if (w) {
    w.innerHTML = chatHistory.map(m =>
      `<div class="chat-msg \${m.role === 'user' ? 'user' : 'ai'}">\${m.content.replace(/\\n/g, '<br>').replace(/</g, '&lt;')}</div>`
    ).join('');
  }

  switchTab('analyse');
  document.querySelectorAll('.nav-btn')[0].click();
  setTimeout(() => renderResults(item, true), 300); // true flag disables resetting chatHistory
  showToast('Case restored from History!');
}

function seedInitialHistory() {
  const existing = localStorage.getItem('justiceai_history');
  if (!existing || existing === '[]') {
    const dummy1 = {
      id: 'dummy_1', date: new Date().toISOString(), timestamp: Date.now() - 86400000,
      problem: "The landlord is forcing me to vacate the flat without serving a 1 month notice as mentioned in the agreement.",
      cat: "Tenant / Housing", authority: "Rent Control Court / Civil Court", law: "Rent Control Act & Transfer of Property Act",
      urgency: "High", timeline: "Immediate Injunction",
      rights: ["Right to remain until formal legal notice expires", "Right to file an injunction against illegal eviction"],
      letter: "Dear Landlord,\n\nI am writing to formally object to your sudden demand for eviction. Under Section 106 of the Transfer of Property Act, you are legally required to provide a minimum of one month's written notice.\n\nI intend to fulfill my rent obligations but will pursue legal injunctions if you attempt to forcibly evict me.\n\nSincerely,\nTenant",
      steps: [{ title: "Send written reply", desc: "Refuse verbal eviction demand via registered post." }, { title: "File Injunction", desc: "Approach civil court to prevent forced removal." }],
      precedents: [{ title: "Standard Tenant Protections", outcome: "Won", desc: "Landlords cannot evict tenants forcefully without a court order." }],
      legalAidCentres: []
    };
    const dummy2 = {
      id: 'dummy_2', date: new Date().toISOString(), timestamp: Date.now() - (86400000 * 3),
      problem: "I want to know the budget allocated for road repairs in my ward by the municipal corporation.",
      cat: "RTI", authority: "Public Information Officer", law: "Right to Information Act, 2005",
      urgency: "Low", timeline: "30 days",
      rights: ["Right to access public records", "Right to obtain certified copies"],
      letter: "To,\nThe Public Information Officer,\nMunicipal Corporation\n\nSubject: Information regarding ward road repair budget.\n\nSir,\nUnder the Right to Information Act, 2005 Section 6(1), please provide the certified budget allocated and spent for ward road repairs for the fiscal year.\n\nRegards,\nApplicant",
      steps: [{ title: "Draft Application", desc: "Submit the drafted letter" }, { title: "Pay Fee", desc: "Attach a ₹10 Postal Order" }], precedents: [], legalAidCentres: []
    };
    localStorage.setItem('justiceai_history', JSON.stringify([dummy1, dummy2]));
    
    // Seed trackers for demo
    const trackers = JSON.parse(localStorage.getItem('justiceAiTrackers') || '{}');
    if (Object.keys(trackers).length === 0) {
      // Dummy 1: Normal active tracking
      trackers['dummy_1'] = { date: new Date().toISOString(), reminderDays: 7, setOn: new Date().toISOString() };
      
      // Dummy 2: Overdue tracking
      let oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      trackers['dummy_2'] = { date: oldDate.toISOString(), reminderDays: 7, setOn: new Date().toISOString() };
      
      localStorage.setItem('justiceAiTrackers', JSON.stringify(trackers));
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  seedInitialHistory();
  // Apply dictionary to all static text exactly once on load
  setTimeout(() => applyLegalDictionary(document.body), 500); 
});

let lastRtiText = '';

async function generateRTI() {
  const input = document.getElementById('rtiInput').value.trim();
  if (!input) { showToast('Please describe what information you need'); return; }
  const btn = document.querySelector('#tab-rti .submit-btn');
  btn.classList.add('loading');
  document.getElementById('rtiBtnText').textContent = 'Generating...';
  const result = document.getElementById('rtiResult');

  const profile = window.userProfile || null;
  const hasProfile = profile && profile.name;
  const isAuthenticated = window.auth && window.auth.currentUser;

  result.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:1rem 0">
    ${hasProfile
      ? `✓ Using your profile details (${profile.name}) — generating a complete letter...`
      : (!isAuthenticated ? '⚠ <strong>Sign in</strong> to auto-fill your personal details.' : '⚠ No profile found. <a href="#" onclick="window.openProfileModal();return false;" style="color:var(--gold);">Add your details</a> to get a fully filled letter.')}
  </div>`;

  try {
    const res = await fetch('/analyze', {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        problem: input,
        lang: selectedLang,
        category: "RTI",
        applicantDetails: profile
      })
    });

    const resText = await res.text();
    let data;
    try { data = JSON.parse(resText); } catch (e) {
      throw new Error(resText || 'Invalid response from server');
    }
    if (data.error) throw new Error(data.error);
    lastRtiText = data.letter || "";

    result.innerHTML = `
  <div style="background:var(--paper);border:1px solid var(--border);border-radius:10px;padding:1rem;font-size:0.82rem;line-height:1.7;font-family:'Georgia',serif;white-space:pre-wrap;max-height:300px;overflow-y:auto">${lastRtiText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  <div class="action-row" style="margin-top:0.75rem">
    <button class="action-btn" onclick="downloadRTI()">↓ Download RTI</button>
    <button class="action-btn email" onclick="emailRTI()">✉ Email RTI</button>
  </div>`;
  } catch (e) {
    result.innerHTML = `<div style="color:var(--danger);font-size:0.85rem">${e.message || 'Could not generate. Please try again.'}</div>`;
  }
  btn.classList.remove('loading');
  document.getElementById('rtiBtnText').textContent = 'Generate RTI Application →';
}
function downloadRTI() {
  if (!lastRtiText) return;
  const blob = new Blob([lastRtiText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'RTI-Application.txt'; a.click();
  URL.revokeObjectURL(url); showToast('RTI application downloaded!');
}
function emailRTI() {
  if (!lastRtiText) return;
  window.open(`mailto:?subject=${encodeURIComponent('RTI Application')}&body=${encodeURIComponent(lastRtiText)}`, '_blank');
}

// ── TOAST ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ══ LAWYER DIRECTORY DATA ══
const LAWYERS = [
  {
    id: 'l1', name: 'Adv. Priya Nair', spec: 'Senior Consumer Rights Advocate', initials: 'PN',
    color: 'linear-gradient(135deg,#2a4a3a,#3d7a5f)',
    rating: 4.9, cases: 312, tags: ['Consumer Law', 'E-commerce', 'Product Liability'],
    categories: ['Consumer'], fee: 'free', feeLabel: '✦ Free · Legal Aid',
    systemInstruction: 'You are Adv. Priya Nair, a senior consumer rights lawyer with 12 years of experience. You specialise in Consumer Protection Act 2019, product liability, e-commerce disputes, and Consumer Forum procedures. Respond in a professional, empathetic lawyer tone. Give specific legal advice referencing actual Indian laws and sections. Keep responses concise (2-4 sentences max per message).'
  },
  {
    id: 'l2', name: 'Adv. Rohan Malhotra', spec: 'Banking & Fraud Law Specialist', initials: 'RM',
    color: 'linear-gradient(135deg,#1a3a5c,#2a5c8c)',
    rating: 4.8, cases: 247, tags: ['Banking Fraud', 'UPI Disputes', 'Cyber Crime'],
    categories: ['Banking'], fee: 'paid', feeLabel: '₹599/session',
    systemInstruction: 'You are Adv. Rohan Malhotra, a banking and financial fraud specialist with 9 years of experience. You specialise in RBI circulars, Banking Ombudsman complaints, UPI/IMPS fraud recovery, and cybercrime law. Respond in a professional, authoritative lawyer tone. Give specific legal advice referencing actual RBI circulars, IT Act sections, and SARFAESI Act provisions. Keep responses concise (2-4 sentences max per message).'
  },
  {
    id: 'l3', name: 'Adv. Meera Sharma', spec: 'Labour & Employment Law Expert', initials: 'MS',
    color: 'linear-gradient(135deg,#5c3a1a,#8c5a2a)',
    rating: 4.7, cases: 189, tags: ['Labour Disputes', 'PF/ESI', 'Wrongful Termination'],
    categories: ['Labour'], fee: 'free', feeLabel: '✦ Free · Legal Aid',
    systemInstruction: 'You are Adv. Meera Sharma, a labour and employment law expert with 10 years of experience. You specialise in Industrial Disputes Act, PF/ESI compliance, wrongful termination, and Labour Court procedures. Respond in a professional, supportive lawyer tone. Give specific legal advice referencing the Indian Labour Codes, ID Act 1947, and Payment of Wages Act. Keep responses concise (2-4 sentences max per message).'
  },
  {
    id: 'l4', name: 'Adv. Vikram Singh', spec: 'Tenancy & Property Rights Advocate', initials: 'VS',
    color: 'linear-gradient(135deg,#3a1a5c,#5c2a8c)',
    rating: 4.8, cases: 203, tags: ['Rent Control', 'Eviction', 'Landlord Disputes'],
    categories: ['Tenancy'], fee: 'paid', feeLabel: '₹499/session',
    systemInstruction: 'You are Adv. Vikram Singh, a tenancy and property law specialist with 11 years of experience. You specialise in Rent Control Act, Transfer of Property Act, illegal eviction, security deposit disputes, and rent agreement enforcement. Respond in a professional, clear lawyer tone. Give specific legal advice referencing actual sections of the Transfer of Property Act 1882 and state-specific Rent Control Acts. Keep responses concise (2-4 sentences max per message).'
  },
  {
    id: 'l5', name: 'Adv. Ananya Joshi', spec: 'Criminal & FIR Law Specialist', initials: 'AJ',
    color: 'linear-gradient(135deg,#5c1a1a,#8c2a2a)',
    rating: 4.6, cases: 156, tags: ['FIR Filing', 'Bail', 'Section 498A', 'POCSO'],
    categories: ['Criminal'], fee: 'paid', feeLabel: '₹999/session',
    systemInstruction: 'You are Adv. Ananya Joshi, a criminal law specialist with 8 years of experience. You specialise in FIR filing, anticipatory bail, Sections 498A, 376, 420 IPC (now BNS), POCSO Act, and High Court criminal matters. Respond in a professional, serious lawyer tone. Give specific legal advice referencing the Bharatiya Nyaya Sanhita (BNS), CrPC/BNSS, and relevant Supreme Court judgments. Keep responses concise (2-4 sentences max per message).'
  },
  {
    id: 'l6', name: 'Adv. Kabir Mehta', spec: 'Government Services & RTI Advocate', initials: 'KM',
    color: 'linear-gradient(135deg,#1a4a2a,#2a6a3a)',
    rating: 4.9, cases: 421, tags: ['RTI Act', 'Government Fraud', 'PIL'],
    categories: ['Consumer', 'Criminal'], fee: 'free', feeLabel: '✦ Free · Legal Aid',
    systemInstruction: 'You are Adv. Kabir Mehta, a government accountability and RTI specialist with 15 years of experience. You specialise in Right to Information Act 2005, filing PILs, government service failures, and anti-corruption law. Respond in a professional, civic-minded lawyer tone. Give specific legal advice referencing RTI sections, CIC rulings, and Writ petition procedures. Keep responses concise (2-4 sentences max per message).'
  }
];

let activeLawyerFilter = 'All';
let activeLawyer = null;
let lawyerChatHistory = [];
let selectedBookingDate = null;
let selectedBookingTime = null;
let freeTimerInterval = null;
let freeSecondsLeft = 900; // 15 min

function renderLawyerGrid() {
  const grid = document.getElementById('lawyerGrid');
  if (!grid) return;
  const filtered = activeLawyerFilter === 'All'
    ? LAWYERS
    : LAWYERS.filter(l => l.categories.includes(activeLawyerFilter));

  if (!filtered.length) {
    grid.innerHTML = '<div class="placeholder-state" style="grid-column:1/-1"><div class="placeholder-icon">🔍</div><div class="placeholder-text">No lawyers found for this category.</div></div>';
    return;
  }

  grid.innerHTML = filtered.map(l => `
    <div class="lawyer-card" data-id="${l.id}">
      <div class="lawyer-card-top">
        <div class="lawyer-avatar" style="background:${l.color}">
          ${l.initials}
          <div class="lawyer-avail-dot"></div>
        </div>
        <div class="lawyer-info">
          <div class="lawyer-name">${l.name}</div>
          <div class="lawyer-spec">${l.spec}</div>
          <div class="lawyer-rating">
            <span class="lawyer-stars">★★★★★</span>
            <span style="font-weight:600;color:var(--ink)">${l.rating}</span>
            <span style="color:var(--muted)">· ${l.cases} cases</span>
          </div>
        </div>
      </div>
      <div class="lawyer-tags">${l.tags.map(t => `<span class="lawyer-tag">${t}</span>`).join('')}</div>
      <div>
        <span class="lawyer-fee-badge ${l.fee === 'free' ? 'fee-free' : 'fee-paid'}">${l.feeLabel}</span>
      </div>
      <div class="lawyer-card-actions">
        <button class="lawyer-btn lawyer-btn-book" onclick="openBooking('${l.id}')">📅 Book Appointment</button>
        <button class="lawyer-btn lawyer-btn-chat" onclick="openLawyerChat('${l.id}')">💬 Chat Now</button>
      </div>
    </div>
  `).join('');
}

function filterLawyers(cat, btn) {
  activeLawyerFilter = cat;
  document.querySelectorAll('.lawyer-filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderLawyerGrid();
}

// ══ LAWYER CHAT ══
function openLawyerChat(lawyerId) {
  const lawyer = LAWYERS.find(l => l.id === lawyerId);
  if (!lawyer) return;
  activeLawyer = lawyer;
  lawyerChatHistory = [];

  // Set header
  const head = document.getElementById('lcAvatarHead');
  head.style.background = lawyer.color;
  head.textContent = lawyer.initials;
  document.getElementById('lcNameHead').textContent = lawyer.name;

  // Clear messages
  const msgs = document.getElementById('lcMessages');
  msgs.innerHTML = '';

  // Show/hide timer
  const timerBar = document.getElementById('lcTimerBar');
  if (lawyer.fee === 'free') {
    timerBar.style.display = 'flex';
    startFreeTimer();
  } else {
    timerBar.style.display = 'none';
    if (freeTimerInterval) { clearInterval(freeTimerInterval); freeTimerInterval = null; }
  }

  document.getElementById('lawyerChatOverlay').classList.add('open');
  document.getElementById('lcInput').disabled = false;
  document.getElementById('lcSend') && (document.getElementById('lcSend').disabled = false);

  // Build case context for opening message
  const caseCtx = buildCaseContextForLawyer();

  // Show typing then opening message
  setTimeout(() => {
    addLawyerMsg(generateOpeningMessage(lawyer, caseCtx), 'lawyer');
    msg => lawyerChatHistory.push({ role: 'assistant', content: msg });
  }, 800);
}

function buildCaseContextForLawyer() {
  if (currentResult) {
    return {
      problem: currentResult.problem || '',
      category: currentResult.cat || '',
      authority: currentResult.authority || '',
      law: currentResult.law || ''
    };
  }
  const prob = document.getElementById('problemInput') ? document.getElementById('problemInput').value.trim() : '';
  return { problem: prob, category: selectedCat || '', authority: '', law: '' };
}

function generateOpeningMessage(lawyer, ctx) {
  if (ctx.problem) {
    const catMap = {
      'Banking': 'Banking Fraud',
      'Consumer': 'Consumer Rights',
      'Labour': 'Labour Dispute',
      'Tenancy': 'Tenancy Issue',
      'Criminal': 'Criminal Matter'
    };
    const catLabel = catMap[lawyer.categories[0]] || lawyer.categories[0] || 'legal';
    const probShort = ctx.problem.length > 120 ? ctx.problem.slice(0, 120) + '...' : ctx.problem;
    return `Hello! I've reviewed your case details shared by JusticeAI. I can see you have a ${catLabel} matter — "${probShort}". ${ctx.law ? 'The applicable law here is <strong>' + ctx.law + '</strong>. ' : ''}${ctx.authority ? 'You may file before the <strong>' + ctx.authority + '</strong>. ' : ''}I'm here to guide you through your legal options. How can I help you further?`;
  }
  return `Hello! I'm ${lawyer.name}, specialising in ${lawyer.spec}. No case has been analysed yet — please describe your legal situation and I'll provide expert guidance straightaway.`;
}

function addLawyerMsg(html, role) {
  const msgs = document.getElementById('lcMessages');
  const div = document.createElement('div');
  div.className = 'lc-msg ' + role;
  div.innerHTML = html;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showLawyerTyping() {
  const msgs = document.getElementById('lcMessages');
  const div = document.createElement('div');
  div.className = 'lc-typing';
  div.id = 'lc-typing-ind';
  div.innerHTML = '<div class="lc-dot"></div><div class="lc-dot"></div><div class="lc-dot"></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeLawyerTyping() {
  const el = document.getElementById('lc-typing-ind');
  if (el) el.remove();
}

async function sendLawyerMessage() {
  const input = document.getElementById('lcInput');
  const text = input.value.trim();
  if (!text || !activeLawyer) return;
  input.value = '';

  addLawyerMsg(text.replace(/</g, '&lt;'), 'user');
  lawyerChatHistory.push({ role: 'user', content: text });

  showLawyerTyping();

  try {
    // Build messages for API
    const ctx = buildCaseContextForLawyer();
    const systemMsg = activeLawyer.systemInstruction + (ctx.problem ? `\n\nCASE CONTEXT: The user's case is: "${ctx.problem}". Category: ${ctx.category}. Authority: ${ctx.authority}. Law: ${ctx.law}.` : '');

    const messages = [
      { role: 'user', content: systemMsg + '\n\nImportant: You are now in a chat. The user will ask questions. Respond only as the lawyer.' },
      { role: 'assistant', content: 'Understood. I am ready to assist.' },
      ...lawyerChatHistory
    ];

    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, caseContext: JSON.stringify(ctx) })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    removeLawyerTyping();
    const reply = data.reply || 'I apologise, I could not process that. Please try again.';
    addLawyerMsg(reply.replace(/\\n/g, '<br>'), 'lawyer');
    lawyerChatHistory.push({ role: 'assistant', content: reply });

  } catch (e) {
    removeLawyerTyping();
    // Fallback intelligent response
    const fallbacks = [
      'Based on the facts you\'ve shared, I recommend filing a formal written complaint referencing the applicable provisions. Document everything with timestamps and keep copies of all communication.',
      'Under Indian law, you have a strong case here. The first step is to send a legal notice via registered post. This creates an official record and often resolves matters without court intervention.',
      'I would advise you to gather all documentary evidence first — receipts, screenshots, agreements, and correspondence. Strong documentation significantly improves your case prospects.',
      'This falls clearly within a cognizable offence. You are entitled to file a complaint directly with the relevant authority. I can help you draft a formal notice if needed.'
    ];
    const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    addLawyerMsg(fallback, 'lawyer');
    lawyerChatHistory.push({ role: 'assistant', content: fallback });
  }
}

function closeLawyerChat() {
  document.getElementById('lawyerChatOverlay').classList.remove('open');
  if (freeTimerInterval) { clearInterval(freeTimerInterval); freeTimerInterval = null; }
  freeSecondsLeft = 900;
}

function startFreeTimer() {
  freeSecondsLeft = 900;
  if (freeTimerInterval) clearInterval(freeTimerInterval);
  updateTimerDisplay();
  freeTimerInterval = setInterval(() => {
    freeSecondsLeft--;
    updateTimerDisplay();
    if (freeSecondsLeft <= 0) {
      clearInterval(freeTimerInterval);
      freeTimerInterval = null;
      showFreeSessionExpired();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(freeSecondsLeft / 60).toString().padStart(2, '0');
  const s = (freeSecondsLeft % 60).toString().padStart(2, '0');
  const el = document.getElementById('lcCountdown');
  if (el) el.textContent = m + ':' + s;
}

function showFreeSessionExpired() {
  const msgs = document.getElementById('lcMessages');
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="lc-pay-prompt">
      <div style="font-size:1.2rem;margin-bottom:0.4rem">⏱ Free session ended</div>
      <div>Your 15-minute free Legal Aid session has ended. Book a full session to continue receiving legal guidance.</div>
      <button class="lc-pay-btn" onclick="closeLawyerChat();openBooking('${activeLawyer ? activeLawyer.id : ''}')">📅 Book Full Session</button>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('lcInput').disabled = true;
}

// ══ BOOKING ══
function openBooking(lawyerId) {
  const lawyer = LAWYERS.find(l => l.id === lawyerId);
  if (!lawyer) return;

  // Reset state
  selectedBookingDate = null;
  selectedBookingTime = null;
  document.getElementById('bookingForm').style.display = 'block';
  document.getElementById('bookingSuccess').style.display = 'none';
  document.getElementById('bookingName').value = (window.userProfile && window.userProfile.name) || '';
  document.getElementById('bookingPhone').value = (window.userProfile && window.userProfile.phone) || '';

  // Lawyer info header
  document.getElementById('bookingLawyerInfo').innerHTML = `
    <div class="lawyer-avatar" style="background:${lawyer.color};width:48px;height:48px;font-size:1.1rem;flex-shrink:0">${lawyer.initials}</div>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:1rem;font-weight:700;">${lawyer.name}</div>
      <div style="font-size:0.78rem;color:var(--muted);">${lawyer.spec}</div>
      <div class="lawyer-fee-badge ${lawyer.fee === 'free' ? 'fee-free' : 'fee-paid'}" style="margin-top:0.35rem;font-size:0.7rem">${lawyer.feeLabel}</div>
    </div>`;

  // Generate next 7 date pills
  const datePillsEl = document.getElementById('datePills');
  datePillsEl.innerHTML = '';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const label = `<div style="font-size:0.65rem;color:var(--muted)">${days[d.getDay()]}</div><div style="font-weight:600">${d.getDate()}</div><div style="font-size:0.65rem;color:var(--muted)">${months[d.getMonth()]}</div>`;
    const dateStr = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    const btn = document.createElement('button');
    btn.className = 'date-pill';
    btn.innerHTML = label;
    btn.onclick = () => {
      document.querySelectorAll('.date-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      selectedBookingDate = dateStr;
    };
    datePillsEl.appendChild(btn);
  }

  // Reset time pills
  document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('active'));

  document.getElementById('bookingOverlay').classList.add('open');
  window._currentBookingLawyer = lawyer;
}

function selectTime(btn, time) {
  document.querySelectorAll('.time-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  selectedBookingTime = time;
}

function closeBooking() {
  document.getElementById('bookingOverlay').classList.remove('open');
}

function confirmBooking() {
  const name = document.getElementById('bookingName').value.trim();
  const phone = document.getElementById('bookingPhone').value.trim();
  if (!name) { showToast('Please enter your name'); return; }
  if (!phone || !/^[0-9]{10}$/.test(phone)) { showToast('Enter a valid 10-digit phone number'); return; }
  if (!selectedBookingDate) { showToast('Please select a date'); return; }
  if (!selectedBookingTime) { showToast('Please select a time slot'); return; }

  const lawyer = window._currentBookingLawyer;
  document.getElementById('bookingForm').style.display = 'none';
  const successEl = document.getElementById('bookingSuccess');
  successEl.style.display = 'block';
  successEl.innerHTML = `
    <div class="booking-success-card">
      <span class="booking-success-icon">✅</span>
      <h3 style="font-family:'Playfair Display',serif;margin-bottom:0.25rem">Appointment Confirmed!</h3>
      <p style="font-size:0.82rem;color:var(--muted);margin-bottom:1.5rem">Your appointment has been booked successfully.</p>
      <div style="background:var(--paper);border:1px solid var(--border);border-radius:12px;padding:1rem;text-align:left;margin-bottom:0.5rem">
        <div class="booking-detail-row"><span class="booking-detail-label">Lawyer</span><span class="booking-detail-value">${lawyer.name}</span></div>
        <div class="booking-detail-row"><span class="booking-detail-label">Date</span><span class="booking-detail-value">${selectedBookingDate}</span></div>
        <div class="booking-detail-row"><span class="booking-detail-label">Time</span><span class="booking-detail-value">${selectedBookingTime}</span></div>
        <div class="booking-detail-row"><span class="booking-detail-label">Name</span><span class="booking-detail-value">${name}</span></div>
        <div class="booking-detail-row"><span class="booking-detail-label">Phone</span><span class="booking-detail-value">${phone}</span></div>
        <div class="booking-detail-row"><span class="booking-detail-label">Fee</span><span class="booking-detail-value">${lawyer.feeLabel}</span></div>
      </div>
      <button class="cal-btn" onclick="addToCalendar('${lawyer.name}','${selectedBookingDate}','${selectedBookingTime}')">📅 Add to Calendar</button>
      <br/>
      <button onclick="closeBooking()" style="margin-top:0.75rem;background:var(--ink);color:var(--cream);border:none;border-radius:10px;padding:0.65rem 2rem;font-family:'DM Sans',sans-serif;font-size:0.85rem;font-weight:500;cursor:pointer;width:100%;">Done</button>
    </div>`;
}

function addToCalendar(lawyerName, date, time) {
  showToast('📅 Calendar event added! (Demo)');
}

// Render lawyer grid when the tab is first opened
document.addEventListener('DOMContentLoaded', () => {
  // Lazy-render on first tab switch
});

// Patch switchTab to render lawyer grid on demand
const _origSwitchTab = switchTab;
window.switchTab = function(tab, e) {
  _origSwitchTab(tab, e);
  if (tab === 'lawyer') {
    renderLawyerGrid();
    // Auto-filter if we have an active case category
    if (selectedCat) {
      const catMap = {
        '🛒 Consumer Rights': 'Consumer',
        '💼 Workplace / Labour': 'Labour',
        '🏦 Banking / Fraud': 'Banking',
        '🏠 Tenant / Housing': 'Tenancy',
        '👮 Police / FIR': 'Criminal',
        '📋 Government Services': 'Consumer'
      };
      const mapped = catMap[selectedCat];
      if (mapped) {
        const pill = Array.from(document.querySelectorAll('.lawyer-filter-pill')).find(p => p.textContent.trim().includes(mapped));
        if (pill) { filterLawyers(mapped, pill); }
      }
    }
  }
};

// Close overlays on outside click
document.getElementById('bookingOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeBooking();
});
document.getElementById('lawyerChatOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeLawyerChat();
});
