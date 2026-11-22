import { ImageResponse } from "next/og";

export const alt = "Called It — Seal your call. Prove it later.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B0F14", color: "#f2f5f7", fontFamily: "sans-serif", padding: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>
            called
          </div>
          <div style={{ background: "#c6f432", color: "#111", padding: "4px 16px", borderRadius: 14, fontSize: 64, fontWeight: 800, letterSpacing: -2, transform: "rotate(-4deg)" }}>
            it!
          </div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color: "#9aa9ba", textAlign: "center", maxWidth: 700 }}>
          Seal your call before kickoff. Prove it after. Nobody can cheat.
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 40, fontSize: 20, fontWeight: 700 }}>
          <div style={{ background: "#c6f432", color: "#111", padding: "10px 24px", borderRadius: 12 }}>Free to play</div>
          <div style={{ background: "#ffb547", color: "#111", padding: "10px 24px", borderRadius: 12 }}>Win prizes</div>
          <div style={{ background: "#5ab8ff", color: "#111", padding: "10px 24px", borderRadius: 12 }}>Every seal verified</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
