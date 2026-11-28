"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errors";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportError(error, {
      source: "global-error-boundary",
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", background: "#0B0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 20, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ width: 80, height: 80, borderRadius: 24, background: "#FF8FB1", border: "3px solid #111", boxShadow: "4px 4px 0 #111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
          !
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: "#f2f5f7" }}>called</span>
          <span style={{ background: "#C6F432", color: "#111", padding: "2px 8px", borderRadius: 8, fontSize: 32, fontWeight: 800, display: "inline-block", transform: "rotate(-4deg)" }}>it!</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#f2f5f7" }}>Something broke</h1>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#5b6878", maxWidth: 360, lineHeight: 1.5 }}>
          An unexpected error stopped the app. Try reloading.
        </p>
        <button onClick={reset} style={{ minHeight: 48, padding: "0 24px", borderRadius: 14, border: "2px solid #111", background: "#C6F432", color: "#111", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "3px 3px 0 #111" }}>
          Reload
        </button>
      </body>
    </html>
  );
}
