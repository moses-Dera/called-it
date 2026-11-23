import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100dvh", background: "#0B0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 20 }}>
      <div style={{ width: 80, height: 80, borderRadius: 24, background: "#FFB547", border: "3px solid #111", boxShadow: "4px 4px 0 #111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800, color: "#111", transform: "rotate(4deg)", fontFamily: "var(--font-display)" }}>
        ?
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, color: "#f2f5f7", fontFamily: "var(--font-display)" }}>called</span>
        <span style={{ background: "#C6F432", color: "#111", padding: "2px 8px", borderRadius: 8, fontSize: 32, fontWeight: 800, fontFamily: "var(--font-display)", display: "inline-block", transform: "rotate(-4deg)" }}>it!</span>
      </div>
      <h1 style={{ margin: 0, fontSize: 56, fontWeight: 800, color: "#f2f5f7", fontFamily: "var(--font-display)", letterSpacing: -2 }}>404</h1>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#5b6878", maxWidth: 320, lineHeight: 1.5 }}>
        This page doesn&apos;t exist — like a prediction that was never sealed.
      </p>
      <Link href="/" style={{ minHeight: 48, padding: "0 24px", borderRadius: 14, border: "2px solid #111", background: "#C6F432", color: "#111", fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", textDecoration: "none", boxShadow: "3px 3px 0 #111" }}>
        Back to the game
      </Link>
    </div>
  );
}
