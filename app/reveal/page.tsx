"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CardBack, Flip, Img, TopBar } from "@/components/ui";
import { addReward, markRevealed, useStore, verifySeal, type Seal } from "@/lib/store";

const FINAL = { home: 2, away: 1 }; // demo fixture result; live scores come from the football feed
function score(move: string) {
  const [h, a] = move.split("|")[0].split("-").map(Number);
  const exact = h === FINAL.home && a === FINAL.away;
  const result = Math.sign(h - a) === Math.sign(FINAL.home - FINAL.away);
  const lines = [{ label: "Correct result", v: result ? 10 : 0 }, { label: "Exact score", v: exact ? 25 : 0 }, { label: "Bold call", v: exact ? 15 : 0 }];
  const base = lines.reduce((s, l) => s + l.v, 0);
  return { exact, result, lines, total: base * 2, h, a };
}
const COLS = ["#C6F432", "#FFB547", "#5AB8FF", "#FF8FB1", "#B9A5FF", "#FFD84D"];

export default function Reveal() {
  const seals = useStore().seals;
  const [shown, setShown] = useState<Seal | null>(null);
  const [check, setCheck] = useState<{ hashOk: boolean; anchored: boolean } | null>(null);
  const pending = seals.find((s) => s.game === "classic" && !s.revealed);
  const seal = shown ?? pending ?? null;
  const sc = useMemo(() => (seal ? score(seal.move) : null), [seal]);
  const open = !!shown;

  async function flip() {
    if (!seal || open) return;
    const c = await verifySeal(seal);
    setCheck(c); setShown(seal);
    if (c.hashOk) { markRevealed(seal.id); addReward(`${seal.label} · Classic Call`, score(seal.move).total); }
    if (navigator.vibrate) navigator.vibrate([20, 40, 60]);
  }
  const win = !!sc && sc.total > 0;
  return (
    <main className="screen">
      {open && win && Array.from({ length: 16 }, (_, i) => (
        <span key={i} className="pop" style={{ position: "absolute", left: ((i * 61) % 360) + 10, top: ((i * 43) % 150) + 70, width: 6 + (i % 3) * 3, height: 14, borderRadius: 3, background: COLS[i % 6], border: "1.5px solid #111", transform: `rotate(${(i * 53) % 180}deg)`, animationDelay: i * 25 + "ms" }} />
      ))}
      <TopBar eyebrow="Full time" title="Reds 2 – 1 Blues" />
      {!seal ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 30, textAlign: "center" }}>
          <Img n="seal" size={120} /><div className="display" style={{ fontSize: 28 }}>Nothing sealed yet</div>
          <Link href="/seal" className="btn btn-primary" style={{ width: "100%" }}>Seal a call first</Link>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 18, position: "relative" }}>
            <button onClick={flip} aria-label="Reveal your call" style={{ background: "transparent", border: 0, padding: 0 }}>
              <Flip on={open} w={300} h={330}
                front={<div style={{ width: "100%", height: "100%", position: "relative", borderRadius: 28, overflow: "hidden", border: "3px solid #111", boxShadow: "6px 6px 0 var(--text)" }}><CardBack radius={0} /><span className="display" style={{ position: "absolute", left: 0, right: 0, bottom: 22, fontSize: 18, color: "#111" }}><span style={{ background: "var(--paper)", border: "2px solid #111", borderRadius: 12, padding: "6px 12px" }}>Tap to reveal</span></span></div>}
                back={<div style={{ width: "100%", height: "100%", borderRadius: 28, background: win ? "var(--lime)" : "var(--pink)", color: "#111", border: "3px solid #111", boxShadow: "6px 6px 0 var(--text)", padding: 22, display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="display" style={{ fontSize: 32 }}>{win ? "CALLED IT!" : "MISSED IT"}</span><Img n="seal" size={54} style={{ transform: "rotate(-10deg)" }} /></div>
                  <div className="display" style={{ fontSize: 76, letterSpacing: -2 }}>{sc?.h} – {sc?.a}</div>
                  <span className="chip" style={{ alignSelf: "flex-start", background: "#111", color: win ? "var(--lime)" : "var(--pink)", border: 0 }}>{sc?.exact ? "EXACT SCORE" : sc?.result ? "RIGHT RESULT" : "WRONG RESULT"}</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ borderTop: "2px dashed rgba(17,17,17,.4)", paddingTop: 10, fontSize: 12, fontWeight: 800, display: "flex", justifyContent: "space-between" }}>
                    <span>{check?.hashOk ? "✓ SEAL VERIFIED" : "✗ SEAL MISMATCH"}</span><span>{check?.anchored ? "✓ IN ANCHORED BATCH" : "NOT ANCHORED YET"}</span>
                  </div>
                </div>} />
            </button>
          </div>
          <div className="paper" style={{ margin: "22px 20px 0", borderRadius: 22, border: 0, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, opacity: open ? 1 : 0, transform: open ? "none" : "translateY(20px)", transition: "opacity 400ms 500ms, transform 400ms 500ms" }}>
            {sc?.lines.map((l) => <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600 }}><span>{l.label}</span><b>+{l.v}</b></div>)}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600 }}><span>Early bird</span><b>x2</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "2px solid #111", paddingTop: 8 }}><b>Total</b><span className="display" style={{ fontSize: 28 }}>+{sc?.total}</span></div>
          </div>
          <div style={{ flex: 1, minHeight: 16 }} />
          <div style={{ padding: "0 20px 28px", display: "flex", gap: 10 }}>
            <Link href="/vault" className="btn btn-quiet" style={{ width: 120 }}>Proof</Link>
            <button className="btn btn-primary" style={{ flex: 1, minHeight: 56, fontSize: 17, boxShadow: "0 5px 0 var(--text)" }} onClick={() => { if (navigator.share && seal) navigator.share({ title: "Called It", text: `I called ${seal.label}, sealed before kickoff.` }).catch(() => {}); }}>Share reveal card</button>
          </div>
        </>
      )}
    </main>
  );
}
