"use client";
import Link from "next/link";
import { useState } from "react";
import { CardBack, Img, SealStatus, TeamBadge, TopBar } from "@/components/ui";
import { PLAYERS, fixtureOf } from "@/lib/data";
import { useStore } from "@/lib/store";

export default function Waiting() {
  const mine = useStore().seals.find((s) => s.game === "classic" && !s.revealed && !!s.move);
  const [nudged, setNudged] = useState(false);
  const sealed = (k: number) => (k === 0 ? !!mine : k < 6 || (nudged && k === 6));
  const count = PLAYERS.filter((_, k) => sealed(k)).length;
  return (
    <main className="screen">
      <TopBar eyebrow="Naija Ballers · 8" title={`${fixtureOf(mine?.round).home} vs ${fixtureOf(mine?.round).away}`} />
      <div style={{ margin: "6px 20px 0", borderRadius: 26, background: "var(--lime)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div><div className="eyebrow">Reveal at full time</div><div className="display" style={{ fontSize: 48 }}>5d 21h</div></div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}><TeamBadge name={fixtureOf(mine?.round).home} size={40} side="home" /><b style={{ fontSize: 11 }}>vs</b><TeamBadge name={fixtureOf(mine?.round).away} size={40} side="away" /></div>
      </div>
      <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="display" style={{ fontSize: 20 }}>{count} of 8 sealed</div><span style={{ fontSize: 12, color: "var(--muted)" }}>Calls stay face down</span>
      </div>
      <div className="wait-grid" style={{ padding: "12px 20px 0", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "14px 10px" }}>
        {PLAYERS.map((p, k) => (
          <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative", width: 68, height: 94 }}>
              {sealed(k) ? <div className="pop" style={{ width: 68, height: 94, transform: `rotate(${((k * 7) % 9) - 4}deg)` }}><CardBack /></div>
                : <div className="display" style={{ width: 68, height: 94, borderRadius: 10, border: "2px dashed #5b6878", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#5b6878" }}>?</div>}
              { }
              <img src={p.av} alt="" width={30} height={30} style={{ position: "absolute", left: "50%", bottom: -12, marginLeft: -15, borderRadius: 10, border: "2px solid var(--ink)" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: sealed(k) ? "var(--text)" : "var(--muted)" }}>{p.name}</span>
          </div>
        ))}
      </div>
      <div style={{ margin: "18px 20px 0", background: "var(--paper)", color: "#111", borderRadius: 18, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="eyebrow" style={{ color: "#6b6455" }}>Your call</span>
        {mine ? (<><div className="display" style={{ fontSize: 24 }}>{mine.label}</div><div><SealStatus seal={mine} /></div></>)
          : <div style={{ fontSize: 14, fontWeight: 600 }}>You haven&apos;t sealed yet. <Link href="/seal" style={{ textDecoration: "underline", fontWeight: 800 }}>Seal your call</Link></div>}
      </div>
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", display: "flex", gap: 10 }}>
        <button className="btn btn-quiet" style={{ flex: 1 }} onClick={() => setNudged(true)}>{nudged ? "Ify just sealed!" : "Nudge Ify and Bayo"}</button>
        <Link href="/reveal" className="btn btn-primary" style={{ flex: 1, minHeight: 56, fontSize: 16, boxShadow: "0 5px 0 var(--text)" }}>Skip to reveal</Link>
      </div>
    </main>
  );
}
