import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JusticeAI — Legal co-pilot for every Indian",
    short_name: "JusticeAI",
    description: "Know your rights. Draft the complaint, the RTI and the deadlines — in English, Hindi or Marathi.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#1a2a5c",
    lang: "en",
    dir: "ltr",
    categories: ["government", "legal", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Analyse a case", url: "/?tab=analyse", short_name: "Analyse" },
      { name: "RTI application", url: "/?tab=rti", short_name: "RTI" },
      { name: "Case history", url: "/?tab=history", short_name: "History" },
      { name: "Fake notice check", url: "/?tab=detector", short_name: "Detector" },
    ],
  };
}
