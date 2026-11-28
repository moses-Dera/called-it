"use client";
import { useEffect, useRef, useState } from "react";
import { Chips } from "@/components/chips";
import { CardBack, Flip, Img, TopBar, RealPlay } from "@/components/ui";
import { PLAYERS } from "@/lib/data";
import { addReward, commit, randomHex, short } from "@/lib/store";

const NAMES = ["Rock", "Paper", "Scissors"];
const beats = (a: number, b: number) => (a - b + 3) % 3 === 1;
type Bot = { move: number; salt: string; hash: string; round: string };

export default function Arcade() {
  const [totalRounds, setTotalRounds] = useState(3);
  const [roundNum, setRoundNum] = useState(1);
  const [bot, setBot] = useState<Bot | null>(null), [mine, setMine] = useState<number | null>(null), [shown, setShown] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null), [me, setMe] = useState(0), [them, setThem] = useState(0);
  const [matchDone, setMatchDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (t.current) { clearTimeout(t.current); t.current = null; }
    if (nextTimer.current) { clearTimeout(nextTimer.current); nextTimer.current = null; }
  }

  // The opponent's move is committed BEFORE you pick. You see its hash up front.
  async function deal() {
    clearTimers();
    const move = crypto.getRandomValues(new Uint8Array(1))[0] % 3, salt = randomHex(16), round = "rps-" + randomHex(4);
    setBot({ move, salt, round, hash: await commit("chi", round, NAMES[move], salt) });
    setMine(null); setShown(false); setOk(null);
  }

  function startMatch(rounds = totalRounds) {
    setTotalRounds(rounds);
    setRoundNum(1);
    setMe(0);
    setThem(0);
    setMatchDone(false);
    deal();
  }

  useEffect(() => {
    deal();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function play(i: number) {
    if (!bot || mine !== null || matchDone) return;
    setMine(i);
    t.current = setTimeout(async () => {
      const verified = (await commit("chi", bot.round, NAMES[bot.move], bot.salt)) === bot.hash;
      setOk(verified); setShown(true);
      let nextMe = me;
      let nextThem = them;
      if (beats(i, bot.move)) { nextMe += 1; setMe(nextMe); }
      else if (beats(bot.move, i)) { nextThem += 1; setThem(nextThem); }
      if (navigator.vibrate) navigator.vibrate(30);

      if (roundNum >= totalRounds) {
        setMatchDone(true);
        if (nextMe > nextThem) addReward("Arcade: Rock Paper Scissors win", 18);
      } else {
        nextTimer.current = setTimeout(() => {
          setRoundNum((r) => r + 1);
          deal();
        }, 1600);
      }
    }, 700);
  }

  function advanceNow() {
    if (!shown || matchDone) return;
    clearTimers();
    setRoundNum((r) => r + 1);
    deal();
  }

  const result = !bot ? "Dealing…"
    : matchDone ? (me > them ? `You win the match (${me}–${them})! +18` : them > me ? `Chi wins the match (${them}–${me})` : `Match drawn (${me}–${them})`)
    : mine === null ? `Round ${roundNum} of ${totalRounds} · Pick your move`
    : !shown ? "Revealing…"
    : mine === bot.move ? "Draw! Next round starting…"
    : beats(mine, bot.move) ? "You take the round!"
    : "Chi takes the round";

  return (
    <main className="screen" style={{ background: "var(--yellow)", color: "#111" }}>
      <Img n="cover_arcade" size={300} style={{ position: "absolute", right: -90, top: 40, opacity: 0.18, transform: "rotate(14deg)", pointerEvents: "none" }} />
      <TopBar mode="arcade" eyebrow="Fair-Play Arcade" title="Rock Paper Scissors" light accent="var(--yellow)" />
      <RealPlay game="arcade" />
      <div style={{ margin: "10px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", position: "relative" }}>
        <span className="chip" style={{ background: "#111", color: "var(--yellow)", border: 0 }}>Round {roundNum} / {totalRounds}</span>
        <Chips label="Match rounds" value={totalRounds} onChange={(r) => startMatch(r)} options={[[3, "3 rounds"], [5, "5 rounds"], [7, "7 rounds"], [10, "10 rounds"]]} light />
      </div>
      <div style={{ margin: "10px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Img n="avatar_1" size={52} alt="You" style={{ borderRadius: 16, border: "3px solid #111" }} /><div><b>You</b><div className="display" style={{ fontSize: 26 }}>{me}</div></div></div>
        <span className="display" style={{ fontSize: 30 }}>VS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ textAlign: "right" }}><b>Chi</b><div className="display" style={{ fontSize: 26 }}>{them}</div></div><img src={PLAYERS[5].av} alt="Chi" width={52} height={52} style={{ borderRadius: 16, border: "3px solid #111" }} /></div>
      </div>
      <section style={{ margin: "16px 20px 0", minHeight: 196, padding: "18px 16px", borderRadius: 28, background: "#111", display: "flex", alignItems: "center", justifyContent: "space-evenly", gap: 16, position: "relative" }}>
        <div style={{ width: 120, height: 150, borderRadius: 20, background: "#fff4c2", border: "3px solid var(--paper)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, transform: "rotate(-6deg)" }}>
          <span className="display" style={{ fontSize: 22 }}>{mine === null ? "?" : NAMES[mine]}</span><span className="eyebrow">You</span>
        </div>
        <Flip on={shown} w={120} h={150} style={{ transform: "rotate(6deg)" }} front={<CardBack radius={20} />}
          back={<div style={{ width: "100%", height: "100%", borderRadius: 20, background: "var(--pink)", border: "3px solid var(--paper)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}><span className="display" style={{ fontSize: 22 }}>{bot ? NAMES[bot.move] : ""}</span><span className="eyebrow">Chi</span></div>} />
      </section>
      <div className="mono" style={{ margin: "10px 20px 0", fontSize: 11, fontWeight: 700, textAlign: "center", position: "relative" }}>
        Chi&apos;s sealed move: {short(bot?.hash)} {ok === null ? "(locked before you pick)" : ok ? "· ✓ verified, not changed" : "· ✗ mismatch"}
      </div>
      <div role="status" className="display" style={{ marginTop: 10, textAlign: "center", fontSize: 24, padding: "0 16px", position: "relative" }}>{result}</div>
      <div style={{ margin: "14px 20px 0", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, position: "relative" }}>
        {NAMES.map((n, i) => (
          <button key={n} disabled={matchDone || mine !== null} onClick={() => play(i)} className="display" style={{ height: 84, borderRadius: 20, border: "3px solid #111", background: mine === i ? "var(--pink)" : "#fff4c2", boxShadow: "0 5px 0 #111", color: "#111", fontSize: 16, opacity: matchDone ? 0.5 : 1 }}>{n}</button>
        ))}
      </div>
      <div style={{ padding: "16px 20px 24px", position: "relative" }}>
        {matchDone ? (
          <button className="btn btn-primary" style={{ width: "100%", background: "#111", color: "var(--yellow)", border: 0, boxShadow: "0 5px 0 rgba(0,0,0,0.35)" }} onClick={() => startMatch(totalRounds)}>Play new match</button>
        ) : shown ? (
          <button className="btn btn-primary" style={{ width: "100%", background: "#111", color: "var(--yellow)", border: 0, boxShadow: "0 5px 0 rgba(0,0,0,0.35)" }} onClick={advanceNow}>Next round now →</button>
        ) : null}
      </div>
    </main>
  );
}
