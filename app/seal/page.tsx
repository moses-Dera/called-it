"use client";
import Link from "next/link";
import { openShare } from "@/components/share-sheet";
import { useEffect, useState } from "react";
import { fixtureOf, phaseOf } from "@/lib/data";
import { announceTip, useCloud, useFixtures } from "@/lib/cloud";
import { Img, Lock, SealStatus, TeamBadge, TopBar } from "@/components/ui";
import { BackupNudge } from "@/components/account";
import { createSeal, short, useStore, type Seal } from "@/lib/store";
import { useTelegram } from "@/lib/telegram";

const SIDES = ["Striker scores first", "Red card shown", "Goal after 85’"];
const clamp = (n: number) => Math.max(0, Math.min(9, n));

function playSealSound() {
  try {
    const ctx = new AudioContext();
    // Thunk: short low hit
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.type = "sine"; o1.frequency.setValueAtTime(180, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
    g1.gain.setValueAtTime(0.4, ctx.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o1.connect(g1).connect(ctx.destination);
    o1.start(); o1.stop(ctx.currentTime + 0.15);
    // Click: short high tap
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = "square"; o2.frequency.setValueAtTime(800, ctx.currentTime);
    g2.gain.setValueAtTime(0.15, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    o2.connect(g2).connect(ctx.destination);
    o2.start(); o2.stop(ctx.currentTime + 0.04);
    setTimeout(() => ctx.close(), 300);
  } catch {}
}

function Wheel({ v, set, name }: { v: number; set: (n: number) => void; name: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <button aria-label={name + " plus one"} onClick={() => set(clamp(v + 1))} className="btn" style={{ width: 96, minHeight: 44, borderRadius: 14, border: "2px solid #111", background: "#fff", fontSize: 22, color: "#111" }}>+</button>
      <div className="display" style={{ width: 96, height: 110, borderRadius: 20, background: "#111", color: "var(--lime)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 84 }}>{v}</div>
      <button aria-label={name + " minus one"} onClick={() => set(clamp(v - 1))} className="btn" style={{ width: 96, minHeight: 44, borderRadius: 14, border: "2px solid #111", background: "#fff", fontSize: 22, color: "#111" }}>−</button>
    </div>
  );
}

export default function SealPage() {
  const [home, setHome] = useState(2), [away, setAway] = useState(1), [side, setSide] = useState(-1);
  const [sealId, setSealId] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const fixtures = useFixtures();
  const [fid, setFid] = useState<string | null>(null), [now, setNow] = useState<number | null>(null);
  const { haptic, user: tgUser } = useTelegram();
  const session = useCloud().session;
  const userName = tgUser?.first_name || session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "A Player";

  // No fixture in the link (or an unknown one): default to the next match that can still be sealed.
  const nextOpen = now == null ? undefined : fixtures.filter((f) => phaseOf(f, now) === "upcoming").sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  const fx = (fid ? fixtures.find((f) => f.id === fid) : undefined) ?? nextOpen ?? fixtureOf(fid, fixtures);
  const closed = now !== null && Date.parse(fx.kickoff) <= now; // sealing ends at kickoff
  // Which fixture: /seal?f=<fixture id>. Read on the client so the page stays static.
  useEffect(() => { setFid(new URLSearchParams(location.search).get("f")); setNow(Date.now()); }, []);
  const seal: Seal | undefined = useStore().seals.find((s) => s.id === sealId);

  async function doSeal() {
    if (closed) return;
    if (busy) return;
    setBusy(true);
    const s = await createSeal("classic", fx.id, `${home}-${away}${side >= 0 ? "|" + SIDES[side] : ""}`, `${fx.home} ${home} – ${away} ${fx.away}`);
    setSealId(s.id); setBusy(false);
    announceTip(s.id);
    haptic("success");
    playSealSound();
  }

  function challengeFriends() {
    const url = `${window.location.origin}/call?f=${encodeURIComponent(fx.id)}&h=${home}&a=${away}&by=${encodeURIComponent(userName)}`;
    const text = `I just sealed my call for ${fx.home} vs ${fx.away} (${home} – ${away}) on Called It! Can you beat me? Tail or counter my call now:`;
    openShare({ title: "Challenge your friends", text, url });
  }
  return (
    <main className="screen">
      <TopBar mode="classic" eyebrow="Classic Call" title={`${fx.home} vs ${fx.away}`} />
      <div style={{ padding: "4px 20px 0", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        <div style={{ background: closed ? "var(--pink)" : "var(--amber)", color: "#111", borderRadius: 14, padding: "10px 14px", fontSize: 13, fontWeight: 600, transform: "rotate(-1deg)" }}>{closed ? <><b>Sealing closed.</b> This match kicked off {fx.when}.</> : <><b>Early bird x2</b> if sealed a day before kickoff · Kickoff {fx.when}</>}</div>
        <div className="paper" style={{ borderRadius: 28, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "6px 6px 0 var(--lime)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around" }}>
            <TeamBadge name={fx.home} size={56} side="home" /><span className="eyebrow" style={{ color: "#6b6455" }}>Final score</span><TeamBadge name={fx.away} size={56} side="away" />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <Wheel v={home} set={setHome} name={fx.home} /><span className="display" style={{ fontSize: 50 }}>:</span><Wheel v={away} set={setAway} name={fx.away} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontSize: 13 }}>Side call (optional)</b>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SIDES.map((s, i) => (
              <button key={s} onClick={() => setSide(side === i ? -1 : i)} aria-pressed={side === i} style={{ minHeight: 44, padding: "0 14px", borderRadius: 999, border: `2px solid ${side === i ? "#111" : "var(--line)"}`, background: side === i ? "var(--lime)" : "var(--panel)", color: side === i ? "#111" : "var(--text)", fontWeight: 700, fontSize: 13 }}>{s}</button>
            ))}
          </div>
        </div>
        {!closed && <Link href={`/tip?f=${encodeURIComponent(fx.id)}`} style={{ fontSize: 13, fontWeight: 700 }}>Rather tip the result, goals or both teams scoring? Seal a tip instead</Link>}
      </div>
      <div style={{ padding: "14px 20px 30px" }}>
        <button className="btn btn-primary" style={{ width: "100%", opacity: closed ? 0.5 : 1 }} disabled={closed} onClick={doSeal}><Lock />{closed ? "Kickoff passed" : busy ? "Sealing…" : `Seal ${home} – ${away}`}</button>
      </div>

      {seal && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(11,15,20,.95)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 30, textAlign: "center" }}>
          <Img n="seal" size={200} alt="Wax seal" className="stamp" />
          <div className="display" style={{ fontSize: 40 }}>Sealed.</div>
          <div style={{ fontSize: 14, color: "#c9d3de", lineHeight: 1.5 }}>{seal.label} is locked.<br />Only its fingerprint is timestamped. Nobody can see your call before the reveal.</div>
          <SealStatus seal={seal} />
          <details style={{ fontSize: 12, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>View proof details</summary>
            <div className="mono" style={{ background: "var(--panel)", borderRadius: 10, padding: "8px 12px", marginTop: 6 }}>
              seal {short(seal.commitment)}{seal.txid ? ` · block ${seal.height?.toLocaleString()} · tx ${short(seal.txid)}` : ""}
            </div>
          </details>
          <div style={{ width: "100%", textAlign: "left" }}><BackupNudge what="calls and proofs" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", marginTop: 8 }}>
            <button onClick={challengeFriends} className="btn" style={{ background: "var(--lime)", color: "#111", border: "2px solid #111", fontWeight: 800 }}>
              🔥 Challenge
            </button>
            <Link href="/waiting" className="btn btn-paper" style={{ width: "100%", fontWeight: 800 }}>
              Waiting Room
            </Link>
          </div>
          <button onClick={() => setSealId(null)} style={{ minHeight: 44, background: "transparent", border: 0, color: "var(--lime)", fontWeight: 700, fontSize: 14 }}>Seal another call</button>
        </div>
      )}
    </main>
  );
}
