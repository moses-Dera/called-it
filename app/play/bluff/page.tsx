"use client";
import { useEffect, useRef, useState } from "react";
import { CardBack, Flip, TopBar, RealPlay } from "@/components/ui";
import { PLAYERS, art } from "@/lib/data";
import { addReward, commit, createSeal, randomHex } from "@/lib/store";

type Card = string; // "1".."10", "ST" (steal), "SH" (shield)
const DECK: Card[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "ST", "SH"];
const TAG = (c: Card) => (c === "ST" ? "STEAL" : c === "SH" ? "SHIELD" : "NUMBER");
const BG = (c: Card) => (c === "ST" ? "var(--pink)" : c === "SH" ? "#9FD8FF" : "var(--paper)");
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(1))[0] % n;
const SEATS = [{ p: PLAYERS[1], x: 8, y: 110 }, { p: PLAYERS[2], x: 128, y: 14 }, { p: PLAYERS[5], x: 248, y: 110 }];
const TAUNTS = ["I have a 10. Fold.", "Easy money.", "Don't even try."];
type Bot = { card: Card; salt: string; hash: string };

/** Shield beats Steal, Steal beats numbers, otherwise the highest number wins. Ties split. */
function winners(cards: Card[]): number[] {
  const idx = (c: Card) => cards.map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0);
  const st = idx("ST"), sh = idx("SH");
  if (st.length && sh.length) return sh;
  if (st.length) return st;
  const nums = cards.map((c) => (c === "SH" ? 0 : Number(c)));
  const max = Math.max(...nums);
  return nums.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
}

export default function Bluff() {
  const [round, setRound] = useState(1), [hand, setHand] = useState<Card[]>([]), [bots, setBots] = useState<Bot[]>([]);
  const [chosen, setChosen] = useState(0), [sealed, setSealed] = useState(false), [flipped, setFlipped] = useState(false);
  const [verified, setVerified] = useState<number | null>(null), [chips, setChips] = useState(380);
  const ridRef = useRef("");

  // Every bot card is committed at deal time, before anyone bids.
  async function deal(r: number) {
    const rid = `bluff-${randomHex(3)}-r${r}`;
    const b = await Promise.all(SEATS.map(async (s) => { const card = DECK[rnd(DECK.length)], salt = randomHex(16); return { card, salt, hash: await commit(s.p.name, rid, card, salt) }; }));
    setBots(b); setHand([DECK[rnd(9)], DECK[rnd(9)], "SH", "ST"]); setChosen(0); setSealed(false); setFlipped(false); setVerified(null);
    ridRef.current = rid;
  }
  useEffect(() => { deal(1); }, []);
  const rid = () => ridRef.current;

  async function act() {
    if (!sealed) { await createSeal("bluff", rid(), hand[chosen], `Bluff Vault round ${round}: ${TAG(hand[chosen]).toLowerCase()} ${hand[chosen]}`); setSealed(true); return; }
    if (!flipped) {
      let ok = 0;
      for (let i = 0; i < bots.length; i++) if ((await commit(SEATS[i].p.name, rid(), bots[i].card, bots[i].salt)) === bots[i].hash) ok++;
      setVerified(ok); setFlipped(true);
      const w = winners([hand[chosen], ...bots.map((b) => b.card)]);
      if (w.includes(0)) { const share = Math.round(240 / w.length); setChips((c) => c + share); addReward(`Bluff Vault: won round ${round}`, 20); } else setChips((c) => c - 60);
      if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
      return;
    }
    setRound(round + 1); deal(round + 1);
  }
  const w = flipped ? winners([hand[chosen], ...bots.map((b) => b.card)]) : [];
  const banner = !sealed ? "Pick a card and seal it" : !flipped ? "All 4 cards sealed" : w.includes(0) ? (w.length > 1 ? "Split pot!" : "You take the pot!") : `${w.map((i) => SEATS[i - 1].p.name).join(" & ")} win${w.length > 1 ? "" : "s"}`;
  return (
    <main className="screen">
      <TopBar mode="bluff" eyebrow="Bluff Vault" title={`Round ${round} · ${chips} chips`} accent="var(--pink)" />
      <RealPlay game="bluff" />
      <section style={{ position: "relative", margin: "10px 20px 0", padding: "16px 12px 18px", borderRadius: 32, overflow: "hidden", border: "3px solid #111", boxShadow: "0 6px 0 #3b2a1a", backgroundImage: `url(${art("felt")})`, backgroundSize: "cover", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, alignItems: "start" }}>
          {SEATS.map((s, i) => (
            <div key={s.p.name} style={{ marginTop: i === 1 ? 0 : 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ position: "relative" }}>
                <img src={s.p.av} alt={s.p.name} width={46} height={46} style={{ borderRadius: 14, border: "2px solid var(--paper)" }} />
                {sealed && !flipped && i === round % 3 && (
                  <span style={{ position: "absolute", ...(i === 2 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }), top: -24, whiteSpace: "nowrap", background: "var(--paper)", color: "#111", border: "2px solid #111", borderRadius: 10, padding: "3px 8px", fontSize: 11, fontWeight: 700, zIndex: 2 }}>{TAUNTS[round % 3]}</span>
                )}
              </div>
              <Flip on={flipped} w={58} h={81} delay={i * 150} front={<CardBack radius={8} />}
                back={<div style={{ width: "100%", height: "100%", borderRadius: 8, background: BG(bots[i]?.card ?? "2"), border: "2px solid #111", color: "#111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><span className="display" style={{ fontSize: 28 }}>{bots[i]?.card}</span><span style={{ fontSize: 8, fontWeight: 800 }}>{TAG(bots[i]?.card ?? "2")}</span></div>} />
              <span style={{ fontSize: 11, fontWeight: 800, background: w.includes(i + 1) ? "var(--lime)" : "#111", color: w.includes(i + 1) ? "#111" : "var(--text)", borderRadius: 99, padding: "3px 9px" }}>{s.p.name} · bid 60</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span className="display" style={{ fontSize: 38, color: "var(--paper)", textShadow: "3px 3px 0 #111" }}>240</span><span className="eyebrow" style={{ color: "var(--paper)" }}>Pot</span>
          <span role="status" className="chip" style={{ marginTop: 4, background: flipped ? "var(--amber)" : "var(--lime)", fontSize: 12 }}>{banner}</span>
          {verified !== null && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--paper)" }}>✓ {verified}/3 opponent seals verified</span>}
        </div>
      </section>
      <div style={{ padding: "14px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}><span>{sealed ? "Your sealed card" : "Your hand · tap one"}</span><span style={{ color: "var(--muted)" }}>Shield beats Steal beats numbers</span></div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", paddingTop: 10 }}>
          {hand.map((c, i) => {
            const on = chosen === i;
            return (
              <button key={i} disabled={sealed} onClick={() => setChosen(i)} aria-pressed={on} aria-label={`${TAG(c)} ${c}`} style={{ width: 70, height: 98, borderRadius: 12, background: BG(c), color: "#111", border: "3px solid #111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, transform: `translateY(${on ? -14 : 0}px) rotate(${on ? -3 : 0}deg)`, boxShadow: on ? "0 6px 0 var(--pink)" : "none", transition: "transform 200ms", opacity: sealed && !on ? 0.35 : 1 }}>
                <span className="display" style={{ fontSize: 30 }}>{c}</span><span style={{ fontSize: 9, fontWeight: 800 }}>{TAG(c)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ padding: "16px 20px 24px" }}>
        <button className="btn btn-primary" style={{ width: "100%", background: "var(--pink)" }} onClick={act}>{!sealed ? "Seal my card" : !flipped ? "Flip all cards" : "Next round"}</button>
      </div>
    </main>
  );
}
