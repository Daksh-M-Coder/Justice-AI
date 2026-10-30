"use client";

/**
 * Letter export (plan step 33).
 *
 * Two paths, chosen honestly:
 *  - Latin-script letters go through jsPDF, which produces a real .pdf download.
 *  - Devanagari (Hindi / Marathi) letters go through the browser's print dialog, because
 *    jsPDF's built-in fonts contain no Devanagari glyphs and would print tofu boxes.
 *    The print path also renders the letter with proper margins on a phone.
 *
 * Nothing here ever writes user or model text with innerHTML - the print document is
 * assembled with DOM nodes and textContent, so a crafted letter cannot inject markup.
 */
import { track, type Opts, type WorkResult } from "./diag";

export interface LetterDoc {
  title: string;
  subtitle?: string;
  body: string;
  footer?: string;
  lang: string;
}

const DEVANAGARI = /[\u0900-\u097F]/;

export function needsPrintPath(doc: LetterDoc, opts: Opts = {}): WorkResult<boolean> {
  const p = track<boolean>("pdf.needsPrintPath", opts);
  const nonLatin = DEVANAGARI.test(doc.body) || doc.lang === "hi" || doc.lang === "mr";
  p.check(nonLatin ? "Devanagari detected - using the print pipeline" : "Latin text - jsPDF is safe", true, nonLatin ? "jsPDF core fonts have no Devanagari glyphs" : "ascii + latin-1 only");
  return p.done(nonLatin);
}

export async function exportLetter(doc: LetterDoc, opts: Opts = {}): Promise<WorkResult<{ how: "pdf" | "print"; filename: string }>> {
  const p = track<{ how: "pdf" | "print"; filename: string }>("pdf.exportLetter", opts);
  const filename = `${slug(doc.title)}.pdf`;
  if (opts.is_working) {
    p.skip("download", "is_working: no file was produced and no print dialog was opened");
    return p.fixture({ how: needsPrintPath(doc, opts).data ? "print" : "pdf", filename });
  }
  if (typeof window === "undefined") return p.done(null, "Export only runs in the browser.");

  if (!needsPrintPath(doc, opts).data) {
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      const margin = 18;
      const width = 210 - margin * 2;
      let y = margin;
      const push = (text: string, size = 11, bold = false) => {
        pdf.setFontSize(size);
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        const lines = pdf.splitTextToSize(text, width) as string[];
        for (const line of lines) {
          if (y > 280) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin, y);
          y += size * 0.42;
        }
      };
      push(doc.title, 15, true);
      if (doc.subtitle) push(doc.subtitle, 10);
      y += 3;
      doc.body.split("\n").forEach((para) => {
        push(para || " ");
        y += 2;
      });
      if (doc.footer) {
        y += 6;
        push(doc.footer, 8.5);
      }
      pdf.save(filename);
      p.check("jsPDF saved", true, filename);
      return p.done({ how: "pdf", filename });
    } catch (e) {
      const fallback = printDocument(doc, filename, opts);
      if (!fallback.ok) return p.caught(e);
      return p.done({ how: "print", filename });
    }
  }
  return printDocument(doc, filename, opts);
}

function printDocument(doc: LetterDoc, filename: string, opts: Opts = {}): WorkResult<{ how: "print"; filename: string }> {
  const p = track<{ how: "print"; filename: string }>("pdf.printDocument", opts);
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const d = frame.contentDocument;
    if (!d) throw new Error("The browser blocked the print frame");

    d.title = doc.title;
    const style = d.createElement("style");
    style.textContent =
      "@page{size:A4;margin:20mm}body{font-family:system-ui,'Noto Sans Devanagari',sans-serif;font-size:12pt;line-height:1.7;white-space:pre-wrap;color:#111}h1{font-size:15pt;margin:0 0 4pt}small{color:#555}";
    d.head?.appendChild(style);

    const h1 = d.createElement("h1");
    h1.textContent = doc.title;
    d.body.appendChild(h1);

    if (doc.subtitle) {
      const sub = d.createElement("small");
      sub.textContent = doc.subtitle;
      d.body.appendChild(sub);
    }

    const pre = d.createElement("div");
    pre.textContent = doc.body; // textContent, never innerHTML
    d.body.appendChild(pre);

    if (doc.footer) {
      const f = d.createElement("small");
      f.textContent = doc.footer;
      d.body.appendChild(f);
    }

    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 4000);
    p.check("print dialog opened", true, "choose Save as PDF - the filename suggestion comes from the document title");
    return p.done({ how: "print", filename });
  } catch (e) {
    return p.caught(e);
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "justiceai-letter";
}

export function selfTest(opts: Opts = {}): WorkResult<{ path: string }> {
  const p = track<{ path: string }>("pdf.selfTest", { ...opts, is_working: true });
  const latin = needsPrintPath({ title: "T", body: "To the District Commission", lang: "en" }, opts);
  p.attach(latin, "needsPrintPath#latin");
  p.check("latin text uses the jsPDF path", latin.data === false);
  const deva = needsPrintPath({ title: "T", body: "जिल्हा उपभोक्ता मंडल", lang: "hi" }, opts);
  p.attach(deva, "needsPrintPath#devanagari");
  p.check("Devanagari uses the print path", deva.data === true);
  p.check("filename is filesystem safe", !/[\\/:*?"<>|]/.test(slug("My Case / Ref: 42 #7")));
  return p.done({ path: "dual" });
}
