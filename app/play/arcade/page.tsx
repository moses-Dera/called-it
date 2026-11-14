"use client";
import { useEffect, useRef, useState } from "react";
import { CardBack, Flip, Img, TopBar, RealPlay } from "@/components/ui";
import { PLAYERS } from "@/lib/data";
import { addReward, commit, randomHex, short } from "@/lib/store";

const NAMES = ["Rock", "Paper", "Scissors"];
const beats = (a: number, b: number) => (a - b + 3) % 3 === 1;
type Bot = { move: number; salt: string; hash: string; round: string };

export default function Arcade() {
  const [bot, setBot] = useState<Bot | null>(null), [mine, setMine] = useState<number | null>(null), [shown, setShown] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null), [me, setMe] = useState(0), [them, setThem] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The opponent's move is committed BEFORE you pick. You see its hash up front.
  async function deal() {
    const move = crypto.getRandomValues(new Uint8Array(1))[0] % 3, salt = randomHex(16), round = "rps-" + randomHex(4);
    setBot({ move, salt, round, hash: await commit("chi", round, NAMES[move], salt) });
    setMine(null); setShown(false); setOk(null);
  }
  useEffect(() => { deal(); return () => { if (t.current) clearTimeout(t.current); }; }, []);

  function play(i: number) {
    if (!bot || mine !== null) return;
    setMine(i);
    t.current = setTimeout(async () => {
      const verified = (await commit("chi", bot.round, NAMES[bot.move], bot.salt)) === bot.hash;
      setOk(verified); setShown(true);
      if (beats(i, bot.move)) { setMe((x) => x + 1); addReward("Arcade: Rock Paper Scissors win", 18); }
      else if (beats(bot.move, i)) setThem((x) => x + 1);
      if (navigator.vibrate) navigator.vibrate(30);
    }, 700);
  }
  const result = !bot ? "Dealing…" : mine === null ? "Pick your move" : !shown ? "Revealing…" : mine === bot.move ? "Draw!" : beats(mine, bot.move) ? "You win the round" : "Chi takes it";
  return (
    <main className="screen" style={{ background: "var(--yellow)", color: "#111" }}>
      <Img n="cover_arcade" size={300} style={{ position: "absolute", right: -90, top: 40, opacity: 0.18, transform: "rotate(14deg)" }} />
      <TopBar mode="arcade" eyebrow="Fair-Play Arcade" title="Rock Paper Scissors" light accent="var(--yellow)" />
      <RealPlay game="arcade" />
      <div style={{ margin: "10px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Img n="avatar_1" size={52} alt="You" style={{ borderRadius: 16, border: "3px solid #111" }} /><div><b>You</b><div className="display" style={{ fontSize: 26 }}>{me}</div></div></div>
        <span className="display" style={{ fontSize: 30 }}>VS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ textAlign: "right" }}><b>Chi</b><div className="display" style={{ fontSize: 26 }}>{them}</div></div>{ }<img src={PLAYERS[5].av} alt="Chi" width={52} height={52} style={{ borderRadius: 16, border: "3px solid #111" }} /></div>
      </div>
      <section style={{ margin: "18px 20px 0", height: 200, borderRadius: 28, background: "#111", display: "flex", alignItems: "center", justifyContent: "space-around", position: "relative" }}>
        <div style={{ width: 120, height: 150, borderRadius: 20, background: "#fff4c2", border: "3px solid var(--paper)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, transform: "rotate(-6deg)" }}>
          <span className="display" style={{ fontSize: 22 }}>{mine === null ? "?" : NAMES[mine]}</span><span className="eyebrow">You</span>
        </div>
        <Flip on={shown} w={120} h={150} style={{ transform: "rotate(6deg)" }} front={<CardBack radius={20} />}
          back={<div style={{ width: "100%", height: "100%", borderRadius: 20, background: "var(--pink)", border: "3px solid var(--paper)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}><span className="display" style={{ fontSize: 22 }}>{bot ? NAMES[bot.move] : ""}</span><span className="eyebrow">Chi</span></div>} />
      </section>
      <div className="mono" style={{ margin: "10px 20px 0", fontSize: 11, fontWeight: 700, textAlign: "center", position: "relative" }}>
        Chi&apos;s sealed move: {short(bot?.hash)} {ok === null ? "(locked before you pick)" : ok ? "· ✓ verified, not changed" : "· ✗ mismatch"}
      </div>
      <div role="status" className="display" style={{ marginTop: 10, textAlign: "center", fontSize: 26, position: "relative" }}>{result}</div>
      <div style={{ margin: "14px 20px 0", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, position: "relative" }}>
        {NAMES.map((n, i) => (
          <button key={n} onClick={() => play(i)} className="display" style={{ height: 92, borderRadius: 22, border: "3px solid #111", background: mine === i ? "var(--pink)" : "#fff4c2", boxShadow: "0 5px 0 #111", color: "#111", fontSize: 16 }}>{n}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", position: "relative" }}>
        <button className="btn" style={{ width: "100%", background: "#111", color: "var(--yellow)", border: 0, opacity: shown ? 1 : 0.4 }} disabled={!shown} onClick={deal}>Next round</button>
      </div>
    </main>
  );
}
