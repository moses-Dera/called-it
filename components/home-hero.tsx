"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TeamBadge } from "./ui";
import { useFixtures } from "@/lib/cloud";

export function HomeHero() {
  const allFixtures = useFixtures();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // Only use real fixtures (fd- prefix) for the hero
  const fixtures = allFixtures.filter((f) => f.id.startsWith("fd-"));

  const live = fixtures.find((f) => now && Date.parse(f.kickoff) <= now && f.homeGoals == null);
  const upcoming = fixtures.filter((f) => now && Date.parse(f.kickoff) > now).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  const recent = fixtures.filter((f) => f.homeGoals != null).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0];
  const f = live ?? upcoming ?? recent;

  const isLive = !!live && f === live;
  const isUpcoming = !!upcoming && f === upcoming;
  const hasResult = f?.homeGoals != null;

  if (!f) {
    return (
      <Link href="/play/arena" className="home-hero" style={{ display: "flex", flexDirection: "column", gap: 10, color: "var(--text)", borderRadius: 22, background: "linear-gradient(135deg, #1e7a47 0%, #145a34 100%)", border: "2px solid #111", boxShadow: "4px 4px 0 var(--lime)", padding: "18px 20px" }}>
        <span className="chip" style={{ background: "var(--lime)", border: 0, alignSelf: "flex-start" }}>PLAY NOW</span>
        <h2 className="display" style={{ margin: 0, fontSize: 24 }}>Predict. Seal. Prove it.</h2>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, opacity: 0.7 }}>Free-to-play football predictions sealed on Bitcoin.</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 700 }}>
          <span>Quick call is open <span style={{ color: "var(--lime)" }}>now</span></span><span style={{ color: "var(--lime)" }}>Enter →</span>
        </div>
      </Link>
    );
  }

  const chipBg = isLive ? "var(--red)" : isUpcoming ? "var(--sky)" : "var(--amber)";
  const chipText = isLive
    ? "LIVE"
    : isUpcoming
      ? new Date(f.kickoff).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "FULL TIME";

  const href = isUpcoming ? `/seal?f=${f.id}` : "/play/arena";
  const score = hasResult ? `${f.homeGoals}–${f.awayGoals}` : "vs";
  const bg = isLive ? "linear-gradient(135deg, #1e7a47 0%, #145a34 100%)" : "var(--panel)";

  return (
    <Link href={href} className="home-hero" style={{ display: "flex", flexDirection: "column", gap: 12, color: "var(--text)", borderRadius: 22, background: bg, border: "2px solid #111", boxShadow: "4px 4px 0 var(--lime)", padding: "16px 20px" }}>
      <span className="chip" style={{ background: chipBg, border: 0, alignSelf: "flex-start" }}>
        {isLive && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#111", display: "inline-block", marginRight: 4 }} />}
        {chipText}
      </span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "4px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <TeamBadge name={f.home} size={44} side="home" />
          <b style={{ fontSize: 13, textAlign: "center", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{f.home}</b>
        </div>
        <div className="display" style={{ fontSize: hasResult ? 44 : 28, flexShrink: 0 }}>{score}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <TeamBadge name={f.away} size={44} side="away" />
          <b style={{ fontSize: 13, textAlign: "center", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{f.away}</b>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 700 }}>
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
