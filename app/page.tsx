import { App } from "@/components/App";

/**
 * Single-page shell. Everything interactive lives in the client `App` component, which
 * keeps the tab state; this server component exists so the document has real content and
 * metadata without a client-only boundary at the root.
 */
export default function Home() {
  return <App />;
}
