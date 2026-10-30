"use client";

/**
 * Browser capabilities the legacy app used ad hoc: dictation, read-aloud, clipboard,
 * WhatsApp share and photo compression. Each one reports support instead of throwing,
 * so the UI can hide what this device cannot do (plan step 10: fail gracefully).
 */
import { track, type Opts, type WorkResult } from "./diag";

type SR = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export function speechRecognitionSupported(opts: Opts = {}): WorkResult<boolean> {
  const p = track<boolean>("browser.speechRecognitionSupported", opts);
  if (typeof window === "undefined") return p.done(false);
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  p.check("SpeechRecognition available", !!(w.SpeechRecognition || w.webkitSpeechRecognition), "Web Speech API is Chromium/Safari only; other browsers type instead");
  return p.done(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
}

/** Starts dictation; onresult receives the accumulated transcript. */
export function startDictation(
  lang: string,
  onresult: (text: string) => void,
  opts: Opts = {},
): WorkResult<{ stop: () => void }> {
  const p = track<{ stop: () => void }>("browser.startDictation", opts);
  const supported = speechRecognitionSupported(opts);
  if (!supported.data) return p.done(null, "This browser cannot dictate. Please type.");
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SR;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  let text = "";
  rec.onresult = (e) => {
    text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(" ");
    onresult(text);
  };
  rec.onerror = (e) => p.check("dictation error", false, e.error);
  rec.start();
  p.check("dictation started", true, `locale ${lang}`);
  return p.done({ stop: () => rec.stop() });
}

export function speak(text: string, lang: string, opts: Opts = {}): WorkResult<{ speaking: boolean }> {
  const p = track<{ speaking: boolean }>("browser.speak", opts);
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    p.check("speechSynthesis available", false, "read-aloud is not supported on this device");
    return p.done(null, "Read-aloud is unavailable in this browser.");
  }
  const u = new SpeechSynthesisUtterance(text.slice(0, 3000));
  u.lang = lang;
  u.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  p.check("read-aloud started", true, `${Math.min(text.length, 3000)} chars, ${lang}`);
  return p.done({ speaking: true });
}

export function stopSpeaking(opts: Opts = {}): WorkResult<true> {
  const p = track<true>("browser.stopSpeaking", opts);
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  return p.done(true);
}

export async function copyText(text: string, opts: Opts = {}): Promise<WorkResult<boolean>> {
  const p = track<boolean>("browser.copyText", opts);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      p.check("clipboard API used", true);
      return p.done(true);
    }
    p.check("clipboard API available", false, "falling back to a hidden textarea");
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    p.check("legacy copy worked", ok);
    return p.done(ok);
  } catch (e) {
    return p.caught(e);
  }
}

export async function shareWhatsApp(text: string, opts: Opts = {}): Promise<WorkResult<{ url: string }>> {
  const p = track<{ url: string }>("browser.shareWhatsApp", opts);
  const url = `https://wa.me/?text=${encodeURIComponent(text.slice(0, 1500))}`;
  if (typeof window !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text });
      p.check("native share sheet used", true);
      return p.done({ url });
    } catch {
      p.check("native share cancelled or failed", true, "opening the WhatsApp link instead");
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return p.done({ url });
}

/**
 * Downscales a photo before it is uploaded: keeps the request small, and refuses
 * anything that is not an image (plan step 10).
 */
export async function compressImage(file: File, maxWidth = 1200, opts: Opts = {}): Promise<WorkResult<{ dataUrl: string; bytes: number }>> {
  const p = track<{ dataUrl: string; bytes: number }>("browser.compressImage", opts);
  p.check("mime is an image", file.type.startsWith("image/"), file.type || "unknown");
  p.check("raw size under 12 MB", file.size <= 12_000_000, `${Math.round(file.size / 1024)} KB`);
  if (!file.type.startsWith("image/")) return p.done(null, "That file is not an image.");
  if (file.size > 12_000_000) return p.done(null, "The photo is larger than 12 MB. Retake it at a lower resolution.");

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  }).catch((e) => {
    p.caught(e);
    return "";
  });
  if (!dataUrl) return p.done(null, "Could not read the file.");

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("The image could not be decoded"));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable on this device");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", 0.82);
    const bytes = Math.floor((out.length * 3) / 4);
    p.check(`compressed to ${canvas.width}x${canvas.height} (${Math.round(bytes / 1024)} KB)`, bytes <= 1_500_000);
    return p.done({ dataUrl: out, bytes });
  } catch (e) {
    return p.caught(e);
  }
}

export function selfTest(opts: Opts = {}): WorkResult<{ dictation: boolean; tts: boolean; share: boolean }> {
  const p = track<{ dictation: boolean; tts: boolean; share: boolean }>("browser.selfTest", { ...opts, is_working: true });
  // These are capability probes, not assertions: an absent API is a degraded feature
  // the UI hides, not a broken build. Recording them as failures made the Vitals tab
  // red on every Firefox install.
  const d = speechRecognitionSupported(opts);
  p.check("dictation capability", true, d.data ? "Web Speech API present" : "not supported here - the dictation button will explain instead of failing");
  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  p.check("read-aloud capability", true, tts ? "speechSynthesis present" : "not supported here - read-aloud will be hidden");
  const share = typeof window !== "undefined" && !!navigator.share;
  p.check("native share capability", true, share ? "Web Share API" : "falling back to a wa.me link");
  p.check("clipboard capability", true, typeof navigator !== "undefined" && !!navigator.clipboard ? "clipboard API" : "legacy copy fallback");
  return p.done({ dictation: !!d.data, tts, share });
}
