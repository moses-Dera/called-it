"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUIDES, PLAYERS } from "@/lib/data";
import { short, totals, useStore } from "@/lib/store";
import { SealStatus } from "./ui";

const MODE: Record<string, string> = { "/seal": "classic", "/waiting": "classic", "/reveal": "classic" };
const HOW = ["Make your call: a score, a card, a vote or a move.", "It's sealed on your device. Only a fingerprint is sent out.", "At reveal, everyone's seal opens together and is checked."];
const BOTS = [410, 355, 320, 290, 240, 150, 95];

/** Desktop-only side dashboard that fills the space beside the game board on every tab. */
export function DeskPanel() {
  const path = usePathname();
  const s = useStore();
  const t = totals(s);
  const g = GUIDES[MODE[path] ?? path.replace("/play/", "")];
  const board = PLAYERS.map((p, i) => ({ ...p, name: i === 0 ? s.profile.name || "You" : p.name, me: i === 0, pts: i === 0 ? t.points : BOTS[i - 1] })).sort((a, b) => b.pts - a.pts).slice(0, 5);
  return (
    <aside className="desk" aria-label="Dashboard">
      <section className="dcard paper">
        <div className="eyebrow" style={{ color: "#6b6455" }}>{g ? "How to play" : "How Called It works"}</div>
        <div className="display" style={{ fontSize: 26 }}>{g ? g.title : "Seal now, prove it later"}</div>
        {(g ? g.steps : HOW).map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span className="display" style={{ width: 28, height: 28, borderRadius: 9, background: "#111", color: "var(--lime)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4, paddingTop: 4 }}>{step}</span>
          </div>
        ))}
        {g && <div style={{ borderTop: "2px dashed #c9bfa6", paddingTop: 10, fontSize: 13, lineHeight: 1.5 }}><b>Scoring:</b> {g.scoring}<br /><b>Why it&apos;s fair:</b> {g.fair}</div>}
      </section>

      <section className="dcard" style={{ background: "var(--amber)", color: "#111", border: "3px solid #111" }}>
        <div className="eyebrow">Your stats</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[["Points", t.points], ["Seals", s.seals.length], ["Wins", s.ledger.length]].map(([k, v]) => (
            <div key={k} style={{ background: "#111", color: "var(--paper)", borderRadius: 14, padding: "10px 6px", textAlign: "center" }}><div className="display" style={{ fontSize: 26 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{k}</div></div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 13, fontWeight: 700 }}>Prize balance (testnet)</span><span className="display" style={{ fontSize: 24 }}>{t.available.toFixed(4)} ZEC</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/vault" className="btn" style={{ flex: 1, minHeight: 44, background: "#111", color: "var(--amber)" }}>Open Vault</Link>
          <Link href="/profile" className="btn btn-paper" style={{ flex: 1, minHeight: 44 }}>{s.profile.address ? "Wallet " + short(s.profile.address) : "Add wallet"}</Link>
        </div>
      </section>

      <section className="dcard" style={{ background: "var(--panel)", border: "2px solid var(--line)" }}>
        <div className="eyebrow" style={{ color: "var(--lime)" }}>Your recent seals</div>
        {s.seals.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>Nothing sealed yet. Play any game and each seal appears here with its proof status.</div>}
        {s.seals.slice(0, 5).map((x) => (
          <div key={x.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.label}</span><SealStatus seal={x} />
          </div>
        ))}
      </section>

      <section className="dcard" style={{ background: "var(--panel)", border: "2px solid var(--line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span className="eyebrow" style={{ color: "var(--lime)" }}>Top players this week</span><Link href="/ranks" style={{ fontSize: 12, fontWeight: 700, color: "var(--lime)" }}>All ranks</Link></div>
        {board.map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: p.me ? "rgba(198,244,50,.12)" : "transparent", borderRadius: 10, padding: "2px 4px" }}>
            <span className="display" style={{ width: 18, fontSize: 16 }}>{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.av} alt="" width={30} height={30} style={{ borderRadius: 10, border: "2px solid #111" }} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{p.name}</span><span className="display" style={{ fontSize: 16 }}>{p.pts}</span>
          </div>
        ))}
      </section>
    </aside>
  );
}
