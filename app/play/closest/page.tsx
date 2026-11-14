"use client";
import { useState } from "react";
import { Img, Lock, TopBar } from "@/components/ui";
import { PLAYERS } from "@/lib/data";
import { addReward, createSeal } from "@/lib/store";

const ACTUAL = 24; // demo result
const BOTS = [30, 12, 41, 23, 55, 67, 88];

export default function Closest() {
  const [guess, setGuess] = useState(20), [phase, setPhase] = useState<"guess" | "sealed" | "open">("guess");
  const all = [{ ...PLAYERS[0], m: guess }, ...BOTS.map((m, i) => ({ ...PLAYERS[i + 1], m }))];
  const best = Math.min(...all.map((p) => Math.abs(p.m - ACTUAL)));
  const winner = all.find((p) => Math.abs(p.m - ACTUAL) === best)!;
  const open = phase === "open";

  async function act() {
    if (phase === "guess") { await createSeal("closest", "derby-first-goal", String(guess), `First goal minute: ${guess}'`); setPhase("sealed"); }
    else if (phase === "sealed") { setPhase("open"); if (winner.name === "You") addReward("Closest Wins: first goal minute", 40); }
    else setPhase("guess");
  }
  return (
    <main className="screen" style={{ background: "var(--blue)", color: "#111" }}>
      <Img n="cover_closest" size={260} style={{ position: "absolute", right: -80, top: 20, opacity: 0.25, transform: "rotate(-10deg)" }} />
      <TopBar mode="closest" eyebrow="Closest Wins · Office pool" title="8 players" light accent="var(--blue)" />
      <section className="paper" style={{ margin: "6px 20px 0", padding: 18, boxShadow: "5px 5px 0 #111", position: "relative" }}>
        <div className="display" style={{ fontSize: 28 }}>Minute of the first goal in the derby?</div>
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#4a4436" }}>{open ? "All 8 guesses opened together." : phase === "sealed" ? "8 guesses sealed. Nobody can copy anybody." : "Slide to your guess, then seal it."}</div>
      </section>

      {phase === "guess" && (
        <section style={{ margin: "22px 20px 0", background: "#111", color: "var(--text)", borderRadius: 24, padding: 20, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", position: "relative" }}>
          <div className="display" style={{ fontSize: 72, color: "var(--lime)" }}>{guess}&apos;</div>
          <label htmlFor="g" style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Your guess (minute 1 to 90)</label>
          <input id="g" type="range" min={1} max={90} value={guess} onChange={(e) => setGuess(Number(e.target.value))} style={{ width: "100%", height: 44, accentColor: "#c6f432" }} />
        </section>
      )}
      {phase !== "guess" && (
        <section style={{ margin: "22px 20px 0", position: "relative", height: 230, background: "#111", borderRadius: 24, overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 16, right: 16, top: 172, height: 4, background: "var(--paper)", borderRadius: 4 }} />
          {open && <><div style={{ position: "absolute", left: `calc(16px + ${(ACTUAL / 90) * 100}% * 0.9)`, top: 14, bottom: 54, width: 3, background: "var(--lime)" }} /><span className="chip pop" style={{ position: "absolute", left: 62, top: 10, background: "var(--lime)" }}>GOAL {ACTUAL}&apos;</span></>}
          {all.map((p, k) => {
            const win = open && p === winner, s = win ? 40 : 30, stem = 40 + (k % 3) * 22;
            return (
              <div key={p.name} style={{ position: "absolute", left: `calc(16px + ${(p.m / 90) * 90}% - ${s / 2}px)`, top: open ? 172 - stem - s - 4 : -90, opacity: open ? 1 : 0, display: "flex", flexDirection: "column", alignItems: "center", transition: `top 600ms cubic-bezier(.3,1.5,.5,1) ${k * 90}ms, opacity 300ms ${k * 90}ms` }}>
                { }
                <img src={p.av} alt={`${p.name} guessed ${p.m}`} width={s} height={s} style={{ borderRadius: 10, border: `2px solid ${win ? "var(--lime)" : "var(--blue)"}`, boxShadow: win ? "0 0 0 4px rgba(198,244,50,.35)" : "none" }} />
                <div style={{ width: 2, height: stem, background: win ? "var(--lime)" : "var(--blue)" }} />
              </div>
            );
          })}
          {!open && <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text)" }}><Lock size={34} color="#c6f432" /><b>Your guess is sealed</b></div>}
          <div style={{ position: "absolute", left: 16, right: 16, top: 184, display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}><span>0&apos;</span><span>30&apos;</span><span>60&apos;</span><span>90&apos;</span></div>
        </section>
      )}
      {open && (
        <div className="pop" style={{ margin: "16px 20px 0", display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, background: "var(--lime)", border: "3px solid #111", position: "relative" }}>
          { }
          <img src={winner.av} alt="" width={50} height={50} style={{ borderRadius: 14, border: "2px solid #111" }} />
          <div style={{ flex: 1 }}><div className="display" style={{ fontSize: 20 }}>{winner.name === "You" ? "You win!" : `${winner.name} wins`}</div><b style={{ fontSize: 13 }}>Guessed {winner.m}&apos;, {best === 0 ? "spot on" : `${best} off`}</b></div>
          <span className="display" style={{ fontSize: 26 }}>+40</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", position: "relative" }}>
        <button className="btn btn-primary" style={{ width: "100%", background: "#111", color: "var(--blue)", boxShadow: "0 5px 0 var(--paper)" }} onClick={act}>{phase === "guess" ? `Seal ${guess}'` : phase === "sealed" ? "Reveal all guesses" : "Play again"}</button>
      </div>
    </main>
  );
}
