export default function Loading() {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#0B0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: -2, color: "#f2f5f7", fontFamily: "var(--font-display)" }}>called</span>
        <span style={{ background: "#C6F432", color: "#111", padding: "2px 10px", borderRadius: 10, fontSize: 42, fontWeight: 800, fontFamily: "var(--font-display)", display: "inline-block", transform: "rotate(-4deg)" }}>it!</span>
      </div>
      <div className="loading-dots" style={{ display: "flex", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#C6F432", animation: "loadBounce 1.2s ease-in-out infinite" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#C6F432", animation: "loadBounce 1.2s ease-in-out 0.15s infinite" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#C6F432", animation: "loadBounce 1.2s ease-in-out 0.3s infinite" }} />
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#5b6878", margin: 0 }}>Loading your game…</p>
    </div>
  );
}
