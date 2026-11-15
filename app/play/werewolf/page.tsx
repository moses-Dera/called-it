"use client";
import { useEffect, useState } from "react";
import { TopBar, RealPlay } from "@/components/ui";
import { PLAYERS, art } from "@/lib/data";
import { commit, createSeal, randomHex, short } from "@/lib/store";

type Deal = { roles: string[]; salt: string; hash: string };

export default function Werewolf() {
  const [deal, setDeal] = useState<Deal | null>(null), [pick, setPick] = useState(3);
  const [seen, setSeen] = useState<number | null>(null), [audit, setAudit] = useState<boolean | null>(null);

  // The dealer commits to the whole role deal up front, then reveals it at the end for audit.
  useEffect(() => {
    (async () => {
      const wolves = new Set<number>();
      while (wolves.size < 2) wolves.add(1 + (crypto.getRandomValues(new Uint8Array(1))[0] % 6));
      const roles = PLAYERS.map((_, i) => (i === 0 ? "Seer" : wolves.has(i) ? "Werewolf" : "Villager"));
      const salt = randomHex(16);
      setDeal({ roles, salt, hash: await commit("dealer", "ww-night-2", roles.join(","), salt) });
    })();
  }, []);
  async function inspect() {
    if (!deal || seen !== null) return;
    await createSeal("werewolf", "ww-night-2", "inspect:" + PLAYERS[pick].name, `Werewolf night 2: inspect ${PLAYERS[pick].name}`);
    setSeen(pick);
  }
  async function runAudit() { if (deal) setAudit((await commit("dealer", "ww-night-2", deal.roles.join(","), deal.salt)) === deal.hash); }
  const wolf = seen !== null && deal?.roles[seen] === "Werewolf";
  return (
    <main className="screen" style={{ background: "linear-gradient(180deg, #120e2a 0%, #0b0f14 60%)" }}>
      { }
      <img src={art("village")} alt="" loading="lazy" style={{ position: "absolute", left: 0, bottom: 0, width: "100%", height: 240, objectFit: "cover", opacity: 0.85 }} />
      <TopBar mode="werewolf" eyebrow="Werewolf Night" title="Night 2" accent="var(--lilac)" />
      <RealPlay game="werewolf" />
      <div style={{ margin: "10px 20px 0", display: "flex", gap: 14, alignItems: "center", position: "relative" }}>
        <div style={{ width: 92, height: 124, borderRadius: 16, background: "linear-gradient(160deg, #2b2160, #17123a)", border: "2px solid var(--lilac)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, flexShrink: 0 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#b9a5ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          <span className="display">Seer</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="eyebrow" style={{ color: "var(--lilac)" }}>Your secret role</span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: "#d9d3f5" }}>Sent privately to you. Pick one player to inspect tonight. Your choice is sealed.</span>
        </div>
      </div>
      <div className="ww-grid" style={{ margin: "20px 20px 0", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px 8px", position: "relative" }}>
        {PLAYERS.map((p, k) => {
          const out = k === 7, on = k === pick, me = k === 0;
          return (
            <button key={p.name} disabled={out || me || seen !== null} onClick={() => setPick(k)} aria-pressed={on} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "transparent", border: 0, color: out ? "#7d7899" : "var(--text)", opacity: out ? 0.45 : 1, filter: out ? "grayscale(1)" : "none", minHeight: 44 }}>
              { }
              <img src={p.av} alt="" width={58} height={58} style={{ borderRadius: 18, border: `3px solid ${on ? "var(--lilac)" : "#33305a"}`, boxShadow: on ? "0 0 0 4px rgba(185,165,255,.35), 0 0 24px #b9a5ff" : "none", transform: `scale(${on ? 1.08 : 1})`, transition: "transform 200ms, box-shadow 200ms" }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{p.name}{out ? " · out" : ""}</span>
            </button>
          );
        })}
      </div>
      <div role="status" style={{ margin: "18px 20px 0", padding: "14px 16px", borderRadius: 18, background: seen !== null ? (wolf ? "var(--pink)" : "var(--mint)") : "rgba(18,14,42,.85)", color: seen !== null ? "#111" : "#d9d3f5", border: "1px solid rgba(185,165,255,.3)", fontSize: 13, lineHeight: 1.5, position: "relative" }}>
        {seen !== null ? <><span className="display" style={{ fontSize: 20, display: "block" }}>{PLAYERS[seen].name} is a {deal?.roles[seen]}</span>Your inspection was sealed before the answer was shown.</>
          : <>Day 1: the village voted out <b style={{ color: "var(--text)" }}>Bayo</b>, a villager. Votes were sealed before anyone saw the others.</>}
        <div className="mono" style={{ marginTop: 8, fontSize: 11, opacity: 0.85 }}>role deal sealed: {short(deal?.hash)}{audit === null ? "" : audit ? " · ✓ deal matches its seal" : " · ✗ mismatch"}</div>
      </div>
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", display: "flex", gap: 10, position: "relative" }}>
        <button className="btn btn-quiet" style={{ flex: 1 }} onClick={runAudit}>Audit deal</button>
        <button className="btn btn-primary" style={{ flex: 2, background: "var(--lilac)", minHeight: 56, fontSize: 16 }} onClick={inspect}>{seen !== null ? "Sealed for tonight" : `Seal: inspect ${PLAYERS[pick].name}`}</button>
      </div>
    </main>
  );
}
