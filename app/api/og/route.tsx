import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "default";
  const home = searchParams.get("home") ?? "Home";
  const away = searchParams.get("away") ?? "Away";
  const scoreH = searchParams.get("h");
  const scoreA = searchParams.get("a");
  const result = searchParams.get("result"); // "exact" | "correct" | "wrong"
  const contest = searchParams.get("contest");
  const rank = searchParams.get("rank");
  const points = searchParams.get("points");
  const prize = searchParams.get("prize");

  if (type === "reveal") {
    const bg = result === "exact" ? "#c6f432" : result === "correct" ? "#5ab8ff" : "#ff8fb1";
    const label = result === "exact" ? "CALLED IT!" : result === "correct" ? "NICE CALL!" : "MISSED IT";
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0B0F14", color: "#f2f5f7", fontFamily: "sans-serif", padding: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: bg, color: "#111", borderRadius: 0, padding: 40 }}>
            <div style={{ fontSize: 48, fontWeight: 800, marginBottom: 10 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>{home} vs {away}</div>
            {scoreH && scoreA && <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>{scoreH} – {scoreA}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, fontSize: 18, fontWeight: 800, opacity: 0.7 }}>Sealed before kickoff on Called It</div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  if (type === "contest") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B0F14", color: "#f2f5f7", fontFamily: "sans-serif", padding: 60 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#ffb547", marginBottom: 10 }}>CONTEST</div>
          <div style={{ fontSize: 56, fontWeight: 800, textAlign: "center", maxWidth: 900, lineHeight: 1.1 }}>{contest || "Join the contest"}</div>
          {prize && <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 20 }}><div style={{ fontSize: 64, fontWeight: 800, color: "#ffb547" }}>{prize}</div><div style={{ fontSize: 28, fontWeight: 700 }}>ZEC prize pot</div></div>}
          {rank && <div style={{ marginTop: 20, fontSize: 24, fontWeight: 700, color: "#c6f432" }}>#{rank} · {points} points</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 30 }}>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>called</div>
            <div style={{ background: "#c6f432", color: "#111", padding: "2px 12px", borderRadius: 10, fontSize: 36, fontWeight: 800 }}>it!</div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  if (type === "seal") {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B0F14", color: "#f2f5f7", fontFamily: "sans-serif", padding: 60 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#c6f432", marginBottom: 10 }}>SEALED</div>
          <div style={{ fontSize: 48, fontWeight: 800, textAlign: "center" }}>{home} vs {away}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 30, background: "rgba(198,244,50,0.15)", padding: "16px 32px", borderRadius: 18 }}>
            <div style={{ fontSize: 24, fontWeight: 800 }}>My call is locked. Sealed before kickoff.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 40 }}>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>called</div>
            <div style={{ background: "#c6f432", color: "#111", padding: "2px 12px", borderRadius: 10, fontSize: 36, fontWeight: 800 }}>it!</div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  // Default
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0B0F14", color: "#f2f5f7", fontFamily: "sans-serif", padding: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>called</div>
          <div style={{ background: "#c6f432", color: "#111", padding: "4px 16px", borderRadius: 14, fontSize: 64, fontWeight: 800, transform: "rotate(-4deg)" }}>it!</div>
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color: "#9aa9ba", textAlign: "center" }}>Seal your call. Prove it later. Nobody can cheat.</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
