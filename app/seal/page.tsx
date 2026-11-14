"use client";
import Link from "next/link";
import { useState } from "react";
import { Img, Lock, SealStatus, TopBar } from "@/components/ui";
import { BackupNudge } from "@/components/account";
import { createSeal, short, useStore, type Seal } from "@/lib/store";

const SIDES = ["Striker scores first", "Red card shown", "Goal after 85’"];
const clamp = (n: number) => Math.max(0, Math.min(9, n));

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
  const seal: Seal | undefined = useStore().seals.find((s) => s.id === sealId);

  async function doSeal() {
    if (busy) return;
    setBusy(true);
    const s = await createSeal("classic", "reds-blues-2026-11-21", `${home}-${away}${side >= 0 ? "|" + SIDES[side] : ""}`, `Reds ${home} – ${away} Blues`);
    setSealId(s.id); setBusy(false);
    if (navigator.vibrate) navigator.vibrate(30);
  }
  return (
    <main className="screen">
      <TopBar mode="classic" eyebrow="Classic Call" title="Reds vs Blues" />
      <div style={{ padding: "4px 20px 0", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        <div style={{ background: "var(--amber)", color: "#111", borderRadius: 14, padding: "10px 14px", fontSize: 13, fontWeight: 600, transform: "rotate(-1deg)" }}><b>Early bird x2.</b> Kickoff in 6 days.</div>
        <div className="paper" style={{ borderRadius: 28, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "6px 6px 0 var(--lime)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around" }}>
            <Img n="crest_home" size={56} h={65} alt="Reds crest" /><span className="eyebrow" style={{ color: "#6b6455" }}>Final score</span><Img n="crest_away" size={56} h={65} alt="Blues crest" />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <Wheel v={home} set={setHome} name="Reds" /><span className="display" style={{ fontSize: 50 }}>:</span><Wheel v={away} set={setAway} name="Blues" />
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
      </div>
      <div style={{ padding: "14px 20px 30px" }}>
        <button className="btn btn-primary" style={{ width: "100%" }} onClick={doSeal}><Lock />{busy ? "Sealing…" : `Seal ${home} – ${away}`}</button>
      </div>

      {seal && (
        <div style={{ position: "absolute", inset: 0, zIndex: 10, background: "rgba(11,15,20,.95)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 30, textAlign: "center" }}>
          <Img n="seal" size={200} alt="Wax seal" className="stamp" />
          <div className="display" style={{ fontSize: 40 }}>Sealed.</div>
          <div style={{ fontSize: 14, color: "#c9d3de", lineHeight: 1.5 }}>{seal.label} is locked.<br />Only its fingerprint left your phone.</div>
          <SealStatus seal={seal} />
          <div className="mono" style={{ fontSize: 12, color: "var(--muted)", background: "var(--panel)", borderRadius: 10, padding: "8px 12px" }}>
            hash {short(seal.commitment)}{seal.txid ? ` · block ${seal.height?.toLocaleString()} · tx ${short(seal.txid)}` : ""}
          </div>
          <div style={{ width: "100%", textAlign: "left" }}><BackupNudge what="calls and proofs" /></div>
          <Link href="/waiting" className="btn btn-paper" style={{ width: "100%", marginTop: 8 }}>Go to waiting room</Link>
          <button onClick={() => setSealId(null)} style={{ minHeight: 44, background: "transparent", border: 0, color: "var(--lime)", fontWeight: 700, fontSize: 14 }}>Seal another call</button>
        </div>
      )}
    </main>
  );
}
