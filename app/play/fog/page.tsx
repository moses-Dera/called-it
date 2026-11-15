"use client";
import { useState } from "react";
import { Img, TopBar, RealPlay } from "@/components/ui";
import { addReward, createSeal } from "@/lib/store";

const MINE: Record<number, string> = { 30: "A", 25: "S", 32: "K", 19: "A", 27: "S" };
const KNOWN: Record<number, string> = { 10: "K", 14: "A" };
const HIDDEN: Record<number, string> = { 8: "S", 3: "A", 5: "K" };

export default function Fog() {
  const [picks, setPicks] = useState<number[]>([]), [revealed, setRevealed] = useState(false), [turn, setTurn] = useState(6);
  const hits = picks.filter((i) => HIDDEN[i] || KNOWN[i]);
  function tap(i: number) {
    if (revealed || MINE[i]) return;
    setPicks(picks.includes(i) ? picks.filter((x) => x !== i) : picks.length < 3 ? [...picks, i] : picks);
  }
  async function act() {
    if (revealed) { setRevealed(false); setPicks([]); setTurn(turn + 1); return; }
    if (!picks.length) return;
    await createSeal("fog", `fog-turn-${turn}`, picks.join(","), `Fog of War turn ${turn}: ${picks.length} targets`);
    setRevealed(true);
    if (hits.length) addReward(`Fog of War: ${hits.length} hit${hits.length > 1 ? "s" : ""} on turn ${turn}`, hits.length * 15);
  }
  return (
    <main className="screen">
      <TopBar mode="fog" eyebrow={`Fog of War · turn ${turn}`} title="You vs Emeka" accent="var(--mint)" />
      <RealPlay game="fog" />
      <div style={{ margin: "4px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Img n="avatar_1" size={32} style={{ borderRadius: 10, border: "2px solid var(--mint)" }} /><b style={{ fontSize: 13 }}>5 units</b></div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>targets hidden from Emeka</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ fontSize: 13 }}>5 units</b><Img n="avatar_3" size={32} style={{ borderRadius: 10, border: "2px solid var(--pink)" }} /></div>
      </div>
      <div className="fog-board" style={{ margin: "16px 16px 0", padding: 10, borderRadius: 26, background: "#12302a", border: "3px solid #111", boxShadow: "0 8px 0 #0a1a16", transform: "perspective(900px) rotateX(14deg)", transformOrigin: "50% 100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 5 }}>
          {Array.from({ length: 36 }, (_, i) => {
            const fog = Math.floor(i / 6) < 2, picked = picks.includes(i);
            let t = "", bg = "#1c4a3d", bd = "#2a6252", fg = "#111", label = "Open field";
            if (fog) { bg = "#2a3138"; bd = "#3a434c"; label = "Fog"; }
            if (revealed && picked && fog) { bg = "#1c4a3d"; bd = "#2a6252"; label = "Fog lifted, empty"; }
            if (revealed && picked && HIDDEN[i]) { t = HIDDEN[i]; bg = "var(--pink)"; bd = "#111"; label = "Enemy found"; }
            if (KNOWN[i]) { t = KNOWN[i]; bg = "var(--pink)"; bd = "#111"; label = "Enemy unit"; }
            if (MINE[i]) { t = MINE[i]; bg = "var(--mint)"; bd = "#111"; label = "Your unit"; }
            if (!revealed && picked) { t = "+"; bg = "rgba(141,227,192,.18)"; bd = "var(--mint)"; fg = "var(--mint)"; label = "Target"; }
            return <button key={i} onClick={() => tap(i)} aria-label={`${label}, cell ${i + 1}`} className="display" style={{ aspectRatio: "1", borderRadius: 10, background: bg, border: `2px solid ${bd}`, color: fg, fontSize: 14, padding: 0, transition: "background 500ms, border-color 500ms" }}>{t}</button>;
          })}
        </div>
      </div>
      <section className="paper" style={{ margin: "22px 20px 0", borderRadius: 20, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="display" style={{ fontSize: 18 }}>{revealed ? (hits.length ? `${hits.length} hit${hits.length > 1 ? "s" : ""}!` : "No hits this turn") : "Plan your sealed moves"}</span>
          <span className="chip" style={{ background: "var(--mint)" }}>{picks.length} / 3 TARGETS</span>
        </div>
        <div role="status" style={{ fontSize: 13, fontWeight: 600, color: "#4a4436", lineHeight: 1.45 }}>{revealed ? "Both turns revealed together. Your targets matched their seal." : "Tap fog or field to target. Seal the turn and nobody can see or change it."}</div>
      </section>
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", display: "flex", gap: 10 }}>
        <button className="btn btn-quiet" style={{ flex: 1 }} onClick={() => { setPicks([]); setRevealed(false); }}>Clear</button>
        <button className="btn btn-primary" style={{ flex: 2, background: "var(--mint)", minHeight: 56, fontSize: 17, opacity: picks.length || revealed ? 1 : 0.5 }} onClick={act}>{revealed ? "Next turn" : "Seal turn"}</button>
      </div>
    </main>
  );
}
