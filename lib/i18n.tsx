"use client";

/**
 * English / Hindi / Marathi. Ported from the legacy data-i18n dictionary and extended
 * for the new surfaces. Keys are flat and stable; missing keys fall back to English so
 * a half-translated release never shows a blank button.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { track, type Opts, type WorkResult } from "./diag";
import { CATEGORY_VALUES } from "./schema";

export type Lang = "en" | "hi" | "mr";

export const LANGS: { code: Lang; label: string; native: string; speech: string }[] = [
  { code: "en", label: "English", native: "English", speech: "en-IN" },
  { code: "hi", label: "Hindi", native: "हिन्दी", speech: "hi-IN" },
  { code: "mr", label: "Marathi", native: "मराठी", speech: "mr-IN" },
];

type Dict = Record<string, string>;

const en: Dict = {
  "app.tagline": "Know your rights. File the complaint.",
  "app.hero": "Your rights, explained. Your case, filed.",
  "app.sub": "Describe an everyday problem in your own words. JusticeAI tells you the law, the office to visit, the deadline, and drafts the letter.",
  "nav.analyse": "Analyse case",
  "nav.rti": "RTI application",
  "nav.history": "Case history",
  "nav.precedents": "Published cases",
  "nav.aid": "Find help",
  "nav.detector": "Fake notice check",
  "nav.sources": "Official sources",
  "nav.vitals": "System vitals",
  "nav.login": "Sign in",
  "nav.signup": "Create account",
  "nav.logout": "Sign out",
  "nav.guest": "Guest",
  "lbl.lang": "Language",
  "lbl.category": "Category",
  "lbl.city": "Your city",
  "lbl.pincode": "Pincode",
  "lbl.problem": "What happened",
  "ph.problem": "Tell it plainly: what, when, who, how much money. Example - I paid Rs 32,000 for a washing machine on 4 March; the motor died in 20 days and the shop refuses to replace it.",
  "ph.rti": "What information do you want from a government office? Ask for records and dates, not opinions.",
  "btn.analyse": "Analyse my case",
  "btn.rti": "Draft my RTI application",
  "btn.analysing": "Reading the law for your case…",
  "btn.copy": "Copy",
  "btn.copied": "Copied",
  "btn.pdf": "Download PDF",
  "btn.share": "Share on WhatsApp",
  "btn.read": "Read aloud",
  "btn.stop": "Stop",
  "btn.listen": "Dictate",
  "btn.attach": "Attach a photo",
  "btn.clearImage": "Remove photo",
  "btn.retry": "Try again",
  "btn.newCase": "New case",
  "btn.runSelfTest": "Run self-test",
  "result.authority": "Where to go first",
  "result.law": "The law that applies",
  "result.urgency": "Urgency",
  "result.timeline": "Realistic timeline",
  "result.rights": "What you are entitled to",
  "result.strength": "Strength of your file",
  "result.contact": "Who to address",
  "result.letter": "Your complaint letter",
  "result.steps": "What to do, in order",
  "result.citations": "Sections used",
  "result.precedents": "Similar published cases",
  "result.deadlines": "Legal clocks",
  "result.checklist": "Documents to attach",
  "result.escalation": "Where it goes next",
  "result.review": "Before you send it",
  "result.summary": "In plain words",
  "result.stripped": "Removed because we could not verify them",
  "result.warning": "Notes",
  "result.noPrecedents": "No verified judgment for this category yet — coming soon. We would rather show nothing than invent a case.",
  "rti.title": "Right to Information application",
  "rti.sub": "Drafted under Section 6(1) of the RTI Act, 2005. One subject per application.",
  "history.title": "Your cases",
  "history.empty": "No cases saved yet. Anything you analyse while signed in is stored against your account.",
  "history.guest": "You are browsing as a guest: history is kept in this browser only.",
  "history.migrate": "Move my guest cases to my account",
  "history.status.open": "Open",
  "history.status.filed": "Filed",
  "history.status.waiting": "Waiting",
  "history.status.resolved": "Resolved",
  "history.status.saved": "Saved",
  "chat.title": "Ask a follow-up about this case",
  "chat.ph": "e.g. What happens if they still do not reply?",
  "chat.send": "Send",
  "chat.empty": "Ask anything about the case above. Answers are limited to the sections this app has verified.",
  "aid.title": "Find real help",
  "aid.sub": "No invented lawyer profiles here. These are the official directories and the steps that actually work.",
  "detector.title": "Fake notice check",
  "detector.sub": "Paste the text of a summon, tax notice, warrant or bank letter. We compare it with how a real one looks.",
  "detector.ph": "Paste the notice text here…",
  "vitals.title": "System vitals",
  "vitals.sub": "Every function in this app takes an is_working flag and reports its own checks. This tab runs them all.",
  "disclaimer": "AI-generated information, not legal advice. Verify with a qualified lawyer.",
  "err.empty": "Please describe what happened first.",
  "err.network": "Could not reach the server. Check your connection and try again.",
  "ok.saved": "Saved to your account.",
  "quota.left": "analyses left today",
  "app.step1": "Step 1",
  "cat.Consumer": "Consumer",
  "cat.RTI": "RTI",
  "cat.Tenant / Housing": "Tenant / Housing",
  "cat.Workplace / Labour": "Workplace / Labour",
  "cat.Police / FIR": "Police / FIR",
  "cat.Banking / Fraud": "Banking / Fraud",
  "cat.Cyber Fraud": "Cyber fraud",
  "cat.Family / Marriage": "Family / Marriage",
  "cat.General": "General",
};

const hi: Dict = {
  "app.tagline": "अपने अधिकार जानें। शिकायत दर्ज करें।",
  "app.hero": "आपके अधिकार, स्पष्ट। आपका मामला, दर्ज।",
  "app.sub": "अपनी समस्या सादे शब्दों में बताइए। JusticeAI कानून, दफ़्तर, समय-सीमा बताता है और पत्र तैयार करता है।",
  "nav.analyse": "मामले का विश्लेषण",
  "nav.rti": "सूचना अधिकार आवेदन",
  "nav.history": "पिछला इतिहास",
  "nav.precedents": "प्रकाशित निर्णय",
  "nav.aid": "मदद खोजें",
  "nav.detector": "नकली नोटिस जाँच",
  "nav.sources": "सरकारी स्रोत",
  "nav.vitals": "सिस्टम स्थिति",
  "nav.login": "साइन इन",
  "nav.signup": "खाता बनाएँ",
  "nav.logout": "साइन आउट",
  "nav.guest": "अतिथि",
  "lbl.lang": "भाषा",
  "lbl.category": "श्रेणी",
  "lbl.city": "आपका शहर",
  "lbl.pincode": "पिन कोड",
  "lbl.problem": "क्या हुआ",
  "ph.problem": "साफ़ बताइए: क्या, कब, किसके खिलाफ, कितना पैसा।",
  "ph.rti": "आप सरकारी दफ़्तर से कौन सी जानकारी चाहते हैं?",
  "btn.analyse": "मेरे मामले का विश्लेषण करें",
  "btn.rti": "RTI आवेदन तैयार करें",
  "btn.analysing": "आपके मामले के लिए कानून पढ़ा जा रहा है…",
  "btn.copy": "कॉपी",
  "btn.copied": "कॉपी हो गया",
  "btn.pdf": "पीडीएफ़ डाउनलोड",
  "btn.share": "व्हाट्सएप पर साझा करें",
  "btn.read": "पढ़कर सुनाएँ",
  "btn.stop": "रोकें",
  "btn.listen": "बोलकर लिखें",
  "btn.attach": "फोटो जोड़ें",
  "btn.clearImage": "फोटो हटाएँ",
  "btn.retry": "फिर कोशिश करें",
  "btn.newCase": "नया मामला",
  "btn.runSelfTest": "स्टील-टेस्ट चलाएँ",
  "result.authority": "पहले कहाँ जाएँ",
  "result.law": "लागू कानून",
  "result.urgency": "तात्कालिकता",
  "result.timeline": "यथार्थ समय-सीमा",
  "result.rights": "आपके अधिकार",
  "result.strength": "आपकी फ़ाइल की मज़बूती",
  "result.contact": "किस के नाम",
  "result.letter": "आपका शिकायत पत्र",
  "result.steps": "क्रमांकित कदम",
  "result.citations": "प्रयोग की गई धाराएँ",
  "result.precedents": "मिलते-जुलते प्रकाशित निर्णय",
  "result.deadlines": "कानूनी समय-घड़ी",
  "result.checklist": "संलग्न करने वाले दस्तावेज़",
  "result.escalation": "आगे कहाँ जाएँ",
  "result.review": "भेजने से पहले",
  "result.summary": "सादे शब्दों में",
  "result.stripped": "हटाए गए क्योंकि सत्यापन नहीं हो सका",
  "result.warning": "सूचनाएँ",
  "result.noPrecedents": "इस श्रेणी के लिए अभी सत्यापित निर्णय उपलब्ध नहीं — जल्द आ रहा है।",
  "rti.title": "सूचना अधिकार आवेदन",
  "rti.sub": "सूचना अधिकार अधिनियम, 2005 की धारा 6(1) के अंतर्गत।",
  "history.title": "आपके मामले",
  "history.empty": "अभी कोई मामला सहेजा नहीं गया।",
  "history.guest": "आप अतिथि हैं: इतिहास केवल इस ब्राउज़र में रहेगा।",
  "history.migrate": "मेरे अतिथि मामले खाते में भेजें",
  "history.status.open": "खुला",
  "history.status.filed": "दर्ज",
  "history.status.waiting": "प्रतीक्षित",
  "history.status.resolved": "हल",
  "history.status.saved": "सहेजा",
  "chat.title": "इस मामले के बारे में पूछें",
  "chat.ph": "जैसे: अगर वे जवाब न दें तो क्या होगा?",
  "chat.send": "भेजें",
  "chat.empty": "ऊपर के मामले के बारे में कुछ भी पूछें।",
  "aid.title": "असली मदद खोजें",
  "aid.sub": "यहाँ बनाई गई वकील प्रोफ़ाइल नहीं हैं। केवल सरकारी निर्देशिकाएँ।",
  "detector.title": "नकली नोटिस जाँच",
  "detector.sub": "समन, कर नोटिस या वारंट का पाठ यहाँ चिपकाएँ।",
  "detector.ph": "नोटिस का पाठ यहाँ चिपकाएँ…",
  "vitals.title": "सिस्टम स्थिति",
  "vitals.sub": "हर फ़ंक्शन is_working फ़ैग लेता है और अपनी जाँच बताता है।",
  "disclaimer": "AI द्वारा 생성ित सूचना, कानूनी सलाह नहीं। योग्य वकील से पुष्टि करें।",
  "err.empty": "कृपया पहले बताइए क्या हुआ।",
  "err.network": "सर्वर से संपर्क नहीं हो सका।",
  "ok.saved": "आपके खाते में सहेजा गया।",
  "quota.left": "आज के बचे विश्लेषण",
  "app.step1": "चरण 1",
  "cat.Consumer": "उपभोक्ता",
  "cat.RTI": "सूचना अधिकार",
  "cat.Tenant / Housing": "किरायेदार / आवास",
  "cat.Workplace / Labour": "कार्यस्थल / श्रम",
  "cat.Police / FIR": "पुलिस / प्राथमिकी",
  "cat.Banking / Fraud": "बैंकिंग / धोखाधड़ी",
  "cat.Cyber Fraud": "साइबर धोखाधड़ी",
  "cat.Family / Marriage": "परिवार / विवाह",
  "cat.General": "सामान्य",
};

const mr: Dict = {
  "app.tagline": "तुमचे हक्क जाणून घ्या. तक्रार दाखल करा.",
  "app.hero": "तुमचे हक्क, स्पष्ट. तुमचे प्रकरण, दाखल.",
  "app.sub": "तुमची समस्या सोप्या शब्दांत सांगा. JusticeAI कायदा, कार्यालय, मुदत सांगते आणि पत्र तयार करते.",
  "nav.analyse": "प्रकरणाचे विश्लेषण",
  "nav.rti": "माहिती अधिकार अर्ज",
  "nav.history": "मागील इतिहास",
  "nav.precedents": "प्रसिद्ध निर्णय",
  "nav.aid": "मदत शोधा",
  "nav.detector": "बनावट नोटीस तपास",
  "nav.sources": "सरकारी स्रोत",
  "nav.vitals": "सिस्टम स्थिती",
  "nav.login": "साइन इन",
  "nav.signup": "खाते तयार करा",
  "nav.logout": "साइन आउट",
  "nav.guest": "पाहुणे",
  "lbl.lang": "भाषा",
  "lbl.category": "श्रेणी",
  "lbl.city": "तुमचे शहर",
  "lbl.pincode": "पिन कोड",
  "lbl.problem": "काही झाले",
  "ph.problem": "साध्या शब्दांत सांगा: काय, कधी, कोणाविरोधात, किती रक्कम.",
  "ph.rti": "तुम्हाला सरकारी कार्यालयाकडून कोणती माहिती हवी आहे?",
  "btn.analyse": "माझ्या प्रकरणाचे विश्लेषण करा",
  "btn.rti": "RTI अर्ज तयार करा",
  "btn.analysing": "तुमच्या प्रकरणासाठी कायदा वाचला जात आहे…",
  "btn.copy": "कॉपी",
  "btn.copied": "कॉपी झाले",
  "btn.pdf": "पीडीएफ डाउनलोड",
  "btn.share": "व्हॉट्सअ‍ॅपवर शेअर करा",
  "btn.read": "मोठ्याने वाचून दाखवा",
  "btn.stop": "थांबा",
  "btn.listen": "बोलून लिहा",
  "btn.attach": "फोटो जोडा",
  "btn.clearImage": "फोटो काढा",
  "btn.retry": "पुन्हा प्रयत्न करा",
  "btn.newCase": "नवे प्रकरण",
  "btn.runSelfTest": "सेल्फ-टेस्ट चालवा",
  "result.authority": "प्रथम कोठे जावे",
  "result.law": "लागू होणारा कायदा",
  "result.urgency": "तातडी",
  "result.timeline": "वास्तविक कालमर्यादा",
  "result.rights": "तुमचे हक्क",
  "result.strength": "तुमच्या फायलीची ताकद",
  "result.contact": "कोणास उद्देशून",
  "result.letter": "तुमचे तक्रार पत्र",
  "result.steps": "क्रमाने पावले",
  "result.citations": "वापरलेले कलम",
  "result.precedents": "सारखे प्रसिद्ध निर्णय",
  "result.deadlines": "कायदेशीर घड्याळे",
  "result.checklist": "संलग्न करायचे कागदपत्रे",
  "result.escalation": "पुढे कोठे जावे",
  "result.review": "पाठवण्यापूर्वी",
  "result.summary": "साध्या शब्दांत",
  "result.stripped": "पडताळणी न झाल्याने काढून टाकले",
  "result.warning": "सूचना",
  "result.noPrecedents": "या श्रेणीसाठी अद्याप पडताळलेले निर्णय नाहीत — लवकरच.",
  "rti.title": "माहिती अधिकार अर्ज",
  "rti.sub": "माहिती अधिकार कायदा, २००५ च्या कलम ६(१) नुसार.",
  "history.title": "तुमची प्रकरणे",
  "history.empty": "अद्याप कोणतेही प्रकरण जतन केलेले नाही.",
  "history.guest": "तुम्ही पाहुणे आहात: इतिहास फक्त या ब्राउझरमध्ये राहील.",
  "history.migrate": "माझी पाहुणे प्रकरणे खात्यात नका",
  "history.status.open": "चालू",
  "history.status.filed": "दाखल",
  "history.status.waiting": "प्रतीक्षेत",
  "history.status.resolved": "निकाली",
  "history.status.saved": "जतन केले",
  "chat.title": "या प्रकरणाबद्दल विचारा",
  "chat.ph": "उदा. उत्तर न आले तर काय?",
  "chat.send": "पाठवा",
  "chat.empty": "वरील प्रकरणाबद्दल काहीही विचारा.",
  "aid.title": "खरी मदत शोधा",
  "aid.sub": "येथे बनावट वकील प्रोफाइल नाहीत. फक्त सरकारी निर्घिका.",
  "detector.title": "बनावट नोटीस तपास",
  "detector.sub": "समन, कर नोटीस किंवा वॉरंटचा मजकूर येथे टाक.",
  "detector.ph": "नोटीसचा मजकूर येथे टाका…",
  "vitals.title": "सिस्टम स्थिती",
  "vitals.sub": "प्रत्येक फंक्शन is_working घेते आणि तपासणी सांगते.",
  "disclaimer": "AI द्वारे तयार केलेली माहिती, कायदेशीर सल्ला नाही. पात्र वकिलांकडून खात्री करा.",
  "err.empty": "कृपया आधी काय झाले ते सांगा.",
  "err.network": "सर्व्हरशी संपर्क झाला नाही.",
  "ok.saved": "तुमच्या खात्यात जतन झाले.",
  "quota.left": "आज शिल्लक विश्लेषणे",
  "app.step1": "पायरी 1",
  "cat.Consumer": "ग्राहक",
  "cat.RTI": "माहिती अधिकार",
  "cat.Tenant / Housing": "भाडेकरू / रहिवास",
  "cat.Workplace / Labour": "कार्यस्थळ / कामगार",
  "cat.Police / FIR": "पोलिस / FIR",
  "cat.Banking / Fraud": "बँकिंग / फसवणूक",
  "cat.Cyber Fraud": "सायबर फसवणूक",
  "cat.Family / Marriage": "कुटुंब / विवाह",
  "cat.General": "सर्वसाधारण",
};

const DICTS: Record<Lang, Dict> = { en, hi, mr };

/** Translate with an English fallback and a recorded self-test check. */
export function translate(lang: Lang, key: string, opts: Opts = {}): WorkResult<string> {
  const p = track<string>(`i18n.translate(${key})`, opts);
  const value = DICTS[lang]?.[key] ?? DICTS.en[key];
  p.check(`"${key}" exists for ${lang}`, !!value, value ? "found" : "missing in every dictionary");
  return p.done(value ?? key);
}

/**
 * Exhaustive coverage check: every English key must exist in every locale.
 * The Vitals tab used to sample five keys and call that green - useless.
 */
export function coverageReport(opts: Opts = {}): WorkResult<{ total: number; missing: string[]; byLang: Record<string, number> }> {
  const p = track<{ total: number; missing: string[]; byLang: Record<string, number> }>("i18n.coverageReport", opts);
  const keys = Object.keys(DICTS.en);
  const missing: string[] = [];
  const byLang: Record<string, number> = {};
  for (const l of LANGS) {
    let count = 0;
    for (const k of keys) {
      const hit = DICTS[l.code]?.[k];
      if (!hit) missing.push(`${l.code}.${k}`);
      else count += 1;
    }
    byLang[l.code] = count;
  }
  p.check(`all ${keys.length} keys translated in every locale`, missing.length === 0, missing.length ? missing.slice(0, 8).join(", ") : `${keys.length} × ${LANGS.length} locales`);
  // and every category the API can return must have a label in every locale, otherwise a
  // new schema value silently renders as "cat.Something" in the UI
  const unlabelled = CATEGORY_VALUES.filter((c) => !DICTS.en[`cat.${c}`]);
  p.check(`every category has a translated label (${CATEGORY_VALUES.length})`, unlabelled.length === 0, unlabelled.length ? `missing cat.* for: ${unlabelled.join(", ")}` : "all labelled");
  return p.done({ total: keys.length, missing: [...missing, ...unlabelled.map((c) => `cat.${c}`)], byLang });
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  /** t() for keys that may legitimately not exist (server-supplied labels, categories) */
  tOr: (key: string, fallback: string) => string;
  speechLocale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("justiceai_lang");
    if (saved === "en" || saved === "hi" || saved === "mr") setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("justiceai_lang", l);
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key: string) => translate(lang, key).data ?? key,
      tOr: (key: string, fallback: string) => {
        const hit = DICTS[lang]?.[key] ?? DICTS.en[key];
        return hit ?? fallback;
      },
      speechLocale: LANGS.find((l) => l.code === lang)?.speech ?? "en-IN",
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    const p = track<I18nValue>("i18n.useI18n", { is_working: true });
    p.check("I18nProvider is mounted", false, "wrap the tree in <I18nProvider>");
    return { lang: "en", setLang: () => {}, t: (k) => k, tOr: (_k, f) => f, speechLocale: "en-IN" };
  }
  return ctx;
}
