"use client";
import { useEffect, useState } from "react";
import { Img, SealStatus, TeamBadge, TopBar } from "@/components/ui";
import { addReward, createSeal, useStore } from "@/lib/store";
import { useFixtures, useNow } from "@/lib/cloud";
import { phaseOf, type Fixture } from "@/lib/data";

const QS = [
  { q: "Goal in the next 10 minutes?", a: ["Yes", "No"], right: 0, split: [62, 38] },
  { q: "Next card: which team?", a: ["{home}", "{away}"], right: 1, split: [44, 56] },
  { q: "Corner before the 75th minute?", a: ["Yes", "No"], right: 0, split: [71, 29] },
];
type Done = { q: string; you: string; ok: boolean };

export default function Arena() {
  const fixtures = useFixtures();
  const now = useNow();

  const byKickoff = (a: Fixture, b: Fixture) => Date.parse(a.kickoff) - Date.parse(b.kickoff);
  const real = now == null ? [] : fixtures.filter((f) => f.id.startsWith("fd-"));
  const live = real.filter((f) => phaseOf(f, now!) === "live").sort(byKickoff)[0];
  const recent = real.filter((f) => phaseOf(f, now!) === "final").sort((a, b) => byKickoff(b, a))[0];
  const upcoming = real.filter((f) => phaseOf(f, now!) === "upcoming").sort(byKickoff)[0];
  const match = live ?? recent ?? upcoming;

  const home = match?.home ?? "Home";
  const away = match?.away ?? "Away";
  const isLive = !!live;
  const hasResult = match?.homeGoals != null;
  const score = hasResult ? `${match!.homeGoals}–${match!.awayGoals}` : isLive && match!.liveHome != null ? `${match!.liveHome}–${match!.liveAway}` : "vs";
  const label = now == null ? "Loading" : isLive ? "LIVE" : hasResult ? "FULL TIME" : "NEXT UP";
  const canPlay = isLive;

  const [n, setN] = useState(0), [secs, setSecs] = useState(15), [pick, setPick] = useState<number | null>(null);
  const [settled, setSettled] = useState(false), [combo, setCombo] = useState(0), [done, setDone] = useState<Done[]>([]);
  const [sealId, setSealId] = useState<string | null>(null);
  const seal = useStore().seals.find((s) => s.id === sealId);
  const rawQ = QS[n % QS.length];
  const Q = { ...rawQ, q: rawQ.q, a: rawQ.a.map((a) => a.replace("{home}", home).replace("{away}", away)) };

  useEffect(() => {
    if (settled || !canPlay) return;
    const iv = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(iv);
  }, [settled, n, canPlay]);
  useEffect(() => {
    if (secs > 0 || settled) return;
    const t = setTimeout(() => {
      const ok = pick === rawQ.right;
      setSettled(true);
      setCombo((c) => (ok ? c + 1 : 0));
      setDone((d) => [{ q: Q.q, you: pick === null ? "No pick" : Q.a[pick], ok }, ...d].slice(0, 3));
      if (ok) addReward(`Arena: ${Q.q}`, 10 + combo * 5);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs, settled]);

  async function choose(i: number) {
    if (!canPlay || pick !== null || secs === 0) return;
    setPick(i);
    const s = await createSeal("arena", `arena-${Date.now()}`, Q.a[i], `Arena: ${Q.q} → ${Q.a[i]}`);
    setSealId(s.id);
    if (navigator.vibrate) navigator.vibrate(20);
  }
  function next() { setN(n + 1); setSecs(15); setPick(null); setSettled(false); setSealId(null); }
  const locked = pick !== null;
  return (
    <main className="screen">
      <div style={{ background: "#1e7a47", borderBottom: "3px solid #111", position: "relative", overflow: "hidden" }}>
        <TopBar mode="arena" eyebrow={`${label} · Matchday Arena`} title={`${home} vs ${away}`} accent="var(--lime)" />
        <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <TeamBadge name={home} size={46} side="home" />
            <span className="display" style={{ fontSize: 52 }}>{score}</span>
            <TeamBadge name={away} size={46} side="away" />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, height: 12, borderRadius: 99, background: "#111", overflow: "hidden" }}><div style={{ width: Math.min(100, combo * 25) + "%", height: "100%", background: "var(--amber)", transition: "width 400ms" }} /></div>
            <span className="chip" style={{ background: "var(--amber)", fontSize: 13 }}>COMBO x{combo}</span>
          </div>
        </div>
      </div>

      {canPlay ? (
      <section className="paper" style={{ margin: "18px 20px 0", borderRadius: 28, boxShadow: "6px 6px 0 var(--lime)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="eyebrow">Quick call</span>
          <div aria-label={secs + " seconds left"} style={{ width: 50, height: 50, borderRadius: "50%", background: `conic-gradient(#111 0 ${(secs / 15) * 100}%, #d8cfb8 0 100%)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span className="display" style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{secs}</span>
          </div>
        </div>
        <div className="display" style={{ fontSize: 28 }}>{Q.q}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {Q.a.map((label, i) => (
            <button key={label} onClick={() => choose(i)} className="display" style={{ position: "relative", minHeight: 76, padding: "10px 12px", borderRadius: 20, border: "3px solid #111", background: settled && i === rawQ.right ? "var(--lime)" : pick === i ? "var(--amber)" : "#fff", boxShadow: "0 5px 0 #111", color: "#111", fontSize: 18, overflow: "hidden" }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: locked || settled ? rawQ.split[i] + "%" : 0, background: "rgba(17,17,17,.12)", transition: "width 500ms" }} />
              <span style={{ position: "relative" }}>{label}{locked || settled ? ` ${rawQ.split[i]}%` : ""}</span>
            </button>
          ))}
        </div>
        <div role="status" style={{ fontSize: 13, fontWeight: 700, color: "#4a4436", textAlign: "center", minHeight: 20 }}>
          {settled ? `${pick === rawQ.right ? "You called it!" : pick === null ? "No pick this time." : "Missed it."}` : locked ? "Locked. Crowd split revealed." : "Your pick locks instantly."}
        </div>
        {seal && <div style={{ textAlign: "center" }}><SealStatus seal={seal} /></div>}
        {settled && <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} onClick={next}>Next call</button>}
      </section>
      ) : (
      <section className="paper" style={{ margin: "18px 20px 0", borderRadius: 28, boxShadow: "6px 6px 0 var(--lime)", padding: 18, display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center" }}>
        <span className="eyebrow">{hasResult ? "Match ended" : "Waiting for kickoff"}</span>
        <div className="display" style={{ fontSize: 22 }}>{hasResult ? "This match is over." : upcoming ? `${home} vs ${away} hasn't started yet.` : "No matches right now."}</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#4a4436" }}>{hasResult ? "Quick calls are only available during live matches. Come back when the next match kicks off." : "Quick calls open the moment the match goes live."}</span>
      </section>
      )}

      <section style={{ padding: "18px 20px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 18 }}>Resolved this match</h2>
        {done.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>Your settled calls will appear here.</div>}
        {done.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "2px solid #263241", borderRadius: 16, padding: "10px 12px" }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: c.ok ? "var(--lime)" : "var(--pink)", border: "2px solid #111", color: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{c.ok ? "✓" : "✗"}</span>
            <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{c.q}</div><div style={{ fontSize: 12, color: "var(--muted)" }}>You: {c.you}</div></div>
          </div>
        ))}
      </section>
    </main>
  );
}
