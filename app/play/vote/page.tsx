"use client";
import { useEffect, useState } from "react";
import { Img, TopBar, RealPlay } from "@/components/ui";
import { PLAYERS } from "@/lib/data";
import { createSeal } from "@/lib/store";

const PPL = [5, 3, 1, 7].map((i) => PLAYERS[i]);
const BOT_VOTES = [3, 2, 1, 1];
const ROT = [-2, 2, 1, -2];

export default function Vote() {
  const [pick, setPick] = useState(0), [phase, setPhase] = useState<"vote" | "reveal">("vote"), [grow, setGrow] = useState(false);
  useEffect(() => { if (phase === "reveal") { const t = setTimeout(() => setGrow(true), 60); return () => clearTimeout(t); } setGrow(false); }, [phase]);
  const votes = BOT_VOTES.map((v, i) => v + (i === pick ? 1 : 0));
  const max = Math.max(...votes);
  async function act() {
    if (phase === "vote") { await createSeal("vote", "married-first", PPL[pick].name, `Vote: ${PPL[pick].name} marries first`); setPhase("reveal"); }
    else setPhase("vote");
  }
  return (
    <main className="screen" style={{ background: "#ffce80", color: "#111" }}>
      <Img n="cover_vote" size={240} style={{ position: "absolute", right: -70, top: 30, opacity: 0.22, transform: "rotate(10deg)", pointerEvents: "none" }} />
      <TopBar mode="vote" eyebrow="Secret Vote · Uni squad" title={phase === "vote" ? "7 of 8 votes sealed" : "All 8 votes are in"} light accent="#ffce80" />
      <RealPlay game="vote" />
      <div className="display" style={{ padding: "6px 20px 0", fontSize: 36, letterSpacing: -1, position: "relative" }}>Who gets married first?</div>
      {phase === "vote" ? (
        <div className="vote-grid" style={{ padding: "18px 20px 0", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, position: "relative" }}>
          {PPL.map((p, i) => {
            const on = pick === i;
            return (
              <button key={p.name} onClick={() => setPick(i)} aria-pressed={on} style={{ height: 150, borderRadius: 22, background: on ? "var(--lime)" : "var(--paper)", border: "3px solid #111", boxShadow: on ? "0 8px 0 #111" : "0 4px 0 #111", transform: `rotate(${ROT[i]}deg) translateY(${on ? -6 : 0}px)`, transition: "transform 180ms, box-shadow 180ms", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#111", position: "relative" }}>
                <img src={p.av} alt="" width={76} height={76} style={{ borderRadius: 20, border: "2px solid #111" }} />
                <span className="display" style={{ fontSize: 17 }}>{p.name}</span>
                {on && <Img n="seal" size={52} alt="Your pick" className="stamp" style={{ position: "absolute", top: -12, right: -12 }} />}
              </button>
            );
          })}
        </div>
      ) : (
        <section className="paper" style={{ margin: "20px 20px 0", padding: 18, display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
          <span className="eyebrow">All 8 votes opened together</span>
          {PPL.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={p.av} alt="" width={40} height={40} style={{ borderRadius: 12, border: "2px solid #111" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}><span>{p.name}{i === pick ? " · your vote" : ""}</span><span>{votes[i]}</span></div>
                <div style={{ height: 16, borderRadius: 99, background: "#e6dcc2", border: "2px solid #111", overflow: "hidden" }}><div style={{ height: "100%", width: grow ? (votes[i] / max) * 100 + "%" : 0, background: votes[i] === max ? "var(--lime)" : "var(--amber)", transition: "width 900ms cubic-bezier(.3,1.2,.5,1)" }} /></div>
              </div>
            </div>
          ))}
        </section>
      )}
      <div style={{ padding: "20px 20px 24px", position: "relative" }}>
        <button className="btn btn-primary" style={{ width: "100%", background: "#111", color: "#ffce80", boxShadow: "0 6px 0 var(--paper)" }} onClick={act}>{phase === "vote" ? `Seal my vote for ${PPL[pick].name}` : "Vote again"}</button>
      </div>
    </main>
  );
}
