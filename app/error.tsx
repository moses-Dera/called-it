"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#0B0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 20 }}>
      <div style={{ width: 80, height: 80, borderRadius: 24, background: "#FF8FB1", border: "3px solid #111", boxShadow: "4px 4px 0 #111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, transform: "rotate(-6deg)" }}>
        !
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: "#f2f5f7", fontFamily: "var(--font-display)" }}>called</span>
        <span style={{ background: "#C6F432", color: "#111", padding: "2px 8px", borderRadius: 8, fontSize: 32, fontWeight: 800, fontFamily: "var(--font-display)", display: "inline-block", transform: "rotate(-4deg)" }}>it!</span>
      </div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#f2f5f7", fontFamily: "var(--font-display)" }}>Something went wrong</h1>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#5b6878", maxWidth: 360, lineHeight: 1.5 }}>
        The play was interrupted. This shouldn&apos;t happen — but every good game has a restart button.
      </p>
      {error.message && (
        <div style={{ fontSize: 12, fontWeight: 600, color: "#5b6878", background: "rgba(255,255,255,0.05)", padding: "8px 16px", borderRadius: 12, maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {error.message}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        <button onClick={reset} style={{ minHeight: 48, padding: "0 24px", borderRadius: 14, border: "2px solid #111", background: "#C6F432", color: "#111", fontWeight: 800, fontSize: 15, cursor: "pointer", boxShadow: "3px 3px 0 #111" }}>
          Try again
        </button>
        <a href="/" style={{ minHeight: 48, padding: "0 24px", borderRadius: 14, border: "2px solid #2a3444", background: "transparent", color: "#f2f5f7", fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", textDecoration: "none" }}>
          Go home
        </a>
      </div>
    </div>
  );
}
