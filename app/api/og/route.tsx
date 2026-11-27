import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

function clamp(s: string | null, fallback: string, max = 40): string {
  return (s ?? fallback).slice(0, max);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "default";
  const home = clamp(searchParams.get("home"), "Home");
  const away = clamp(searchParams.get("away"), "Away");
  const scoreH = clamp(searchParams.get("h"), "", 2);
  const scoreA = clamp(searchParams.get("a"), "", 2);
  const result = searchParams.get("result");
  const contest = clamp(searchParams.get("contest"), "", 60);
  const rank = clamp(searchParams.get("rank"), "", 4);
  const points = clamp(searchParams.get("points"), "", 10);
  const prize = clamp(searchParams.get("prize"), "", 10);
  const game = clamp(searchParams.get("game"), "", 30);
  const sponsor = clamp(searchParams.get("sponsor"), "", 40);

  if (type === "reveal") {
    const isExact = result === "exact";
    const isCorrect = result === "correct";
    const bg = isExact ? "#C6F432" : isCorrect ? "#5AB8FF" : "#FF8FB1";
    const label = isExact ? "🎯 CALLED IT!" : isCorrect ? "⚡ NICE CALL!" : "SEALED CALL";
    const pill = isExact ? "EXACT SCORE" : isCorrect ? "RIGHT RESULT" : "SEALED PREDICTION";

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: "#0B0F14",
            color: "#f2f5f7",
            fontFamily: "sans-serif",
            padding: 24,
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              background: bg,
              color: "#111",
              borderRadius: 36,
              border: "6px solid #111",
              padding: "48px 40px",
              boxShadow: "10px 10px 0 #111",
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ background: "#111", color: bg, padding: "8px 24px", borderRadius: 999, fontSize: 24, fontWeight: 800 }}>
                {label}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1, color: "#111" }}>called</div>
                <div style={{ background: "#111", color: "#C6F432", padding: "4px 14px", borderRadius: 12, fontSize: 28, fontWeight: 900, transform: "rotate(-4deg)" }}>it!</div>
              </div>
            </div>

            {/* Main Score Area */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 38, fontWeight: 800, color: "#111", opacity: 0.85, letterSpacing: -0.5 }}>
                {`${home} vs ${away}`}
              </div>
              {scoreH && scoreA && (
                <div
                  style={{
                    fontSize: 140,
                    fontWeight: 900,
                    letterSpacing: -6,
                    lineHeight: 1,
                    color: "#111",
                    background: "#fff",
                    padding: "10px 60px",
                    borderRadius: 32,
                    border: "5px solid #111",
                    boxShadow: "6px 6px 0 #111",
                  }}
                >
                  {`${scoreH} : ${scoreA}`}
                </div>
              )}
              <div style={{ background: "#111", color: "#fff", padding: "6px 20px", borderRadius: 16, fontSize: 22, fontWeight: 800, marginTop: 10 }}>
                {pill}
              </div>
            </div>

            {/* Footer row */}
            <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", borderTop: "3px dashed rgba(17,17,17,0.3)", paddingTop: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#111" }}>
                🔒 Locked before kickoff · Zero chance of foul play
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111", opacity: 0.75 }}>
                Timestamped on Bitcoin
              </div>
            </div>
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
          <div style={{ fontSize: 24, fontWeight: 700, color: "#ffb547", marginBottom: 10 }}>{game ? `${game.toUpperCase()} CONTEST` : "FOOTBALL CONTEST"}</div>
          <div style={{ fontSize: 56, fontWeight: 800, textAlign: "center", maxWidth: 900, lineHeight: 1.1 }}>{contest || "Join the contest"}</div>
          {prize && <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 20 }}><div style={{ fontSize: 64, fontWeight: 800, color: "#ffb547" }}>{prize}</div><div style={{ fontSize: 28, fontWeight: 700 }}>ZEC prize · free to play</div></div>}
          {sponsor && <div style={{ marginTop: 12, fontSize: 24, fontWeight: 700, color: "#9aa9ba" }}>{`by ${sponsor}`}</div>}
          {rank && <div style={{ marginTop: 20, fontSize: 24, fontWeight: 700, color: "#c6f432" }}>{`#${rank} · ${points} points`}</div>}
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
          <div style={{ fontSize: 48, fontWeight: 800, textAlign: "center" }}>{`${home} vs ${away}`}</div>
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
