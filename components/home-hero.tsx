"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Img } from "./ui";
import { useFixtures } from "@/lib/cloud";

export function HomeHero() {
  const fixtures = useFixtures();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);

  // Find the best fixture to feature: a live one (past kickoff, no result) or the nearest upcoming
  const live = fixtures.find((f) => now && Date.parse(f.kickoff) <= now && f.homeGoals == null);
  const upcoming = fixtures.filter((f) => now && Date.parse(f.kickoff) > now).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  const recent = fixtures.filter((f) => f.homeGoals != null).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0];
  const f = live ?? upcoming ?? recent;

  const isLive = !!live && f === live;
  const isUpcoming = !!upcoming && f === upcoming;
  const hasResult = f?.homeGoals != null;

  const chipBg = isLive ? "var(--red)" : isUpcoming ? "var(--sky)" : "var(--amber)";
  const chipText = isLive
    ? "LIVE"
    : isUpcoming
      ? new Date(f!.kickoff).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "FULL TIME";

  if (!f) {
    // No fixtures at all — show arena promo
    return (
      <Link href="/play/arena" className="home-hero" style={{ display: "block", color: "var(--text)", borderRadius: 26, background: "#1e7a47", border: "2px solid #111", boxShadow: "5px 5px 0 var(--lime)", padding: 16, position: "relative", overflow: "hidden" }}>
        <Img n="cover_arena" size={170} style={{ position: "absolute", right: -40, top: -40, opacity: 0.25, transform: "rotate(12deg)" }} />
        <span className="chip" style={{ background: "var(--lime)", border: 0 }}>PLAY NOW</span>
        <div style={{ marginTop: 10, position: "relative" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 28 }}>Predict. Seal. Prove it.</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600, opacity: 0.8 }}>Free-to-play football predictions on Zcash. Every call is sealed and timestamped.</p>
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111", borderRadius: 14, padding: "11px 14px", fontSize: 14, fontWeight: 700 }}>
          <span>Quick call is open <span style={{ color: "var(--lime)" }}>now</span></span><span style={{ color: "var(--lime)" }}>Enter →</span>
        </div>
      </Link>
    );
  }

  const href = isUpcoming ? `/seal?f=${f.id}` : "/play/arena";
  const score = hasResult ? `${f.homeGoals}–${f.awayGoals}` : isLive ? "vs" : "vs";

  return (
    <Link href={href} className="home-hero" style={{ display: "block", color: "var(--text)", borderRadius: 26, background: isLive ? "#1e7a47" : "var(--panel)", border: "2px solid #111", boxShadow: "5px 5px 0 var(--lime)", padding: 16, position: "relative", overflow: "hidden" }}>
      <Img n="cover_arena" size={170} style={{ position: "absolute", right: -40, top: -40, opacity: 0.15, transform: "rotate(12deg)" }} />
      <span className="chip" style={{ background: chipBg, border: 0 }}>
        {isLive && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#111", display: "inline-block", marginRight: 4 }} />}
        {chipText}
      </span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
          <b style={{ fontSize: 15, textAlign: "center", lineHeight: 1.2 }}>{f.home}</b>
        </div>
        <div className="display" style={{ fontSize: hasResult ? 54 : 36, padding: "0 8px" }}>{score}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
          <b style={{ fontSize: 15, textAlign: "center", lineHeight: 1.2 }}>{f.away}</b>
        </div>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111", borderRadius: 14, padding: "11px 14px", fontSize: 14, fontWeight: 700 }}>
        {isUpcoming ? (
          <><span>Seal your prediction <span style={{ color: "var(--lime)" }}>now</span></span><span style={{ color: "var(--lime)" }}>Seal →</span></>
        ) : isLive ? (
          <><span>Quick call is open <span style={{ color: "var(--lime)" }}>now</span></span><span style={{ color: "var(--lime)" }}>Enter →</span></>
        ) : (
          <><span>See results</span><span style={{ color: "var(--lime)" }}>→</span></>
        )}
      </div>
    </Link>
  );
}
