import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: "JusticeAI — know your rights, file the complaint",
  description:
    "Describe an everyday legal problem in English, Hindi or Marathi. JusticeAI names the law, the office, the deadline and drafts the letter — citing only sections it can retrieve from a verified statute set.",
  applicationName: "JusticeAI",
  manifest: "/manifest.webmanifest",
  keywords: ["legal aid India", "RTI application", "consumer complaint", "FIR", "tenant rights", "free legal aid"],
  authors: [{ name: "JusticeAI" }],
};

export const viewport: Viewport = {
  themeColor: "#1a2a5c",
  width: "device-width",
  initialScale: 1,
};

/**
 * The inline script applies the saved theme before first paint. `suppressHydrationWarning`
 * on <html> is what makes that legal in a server-rendered document.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('justiceai_theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
