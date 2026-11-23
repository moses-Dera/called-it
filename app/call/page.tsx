"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fixtureOf, Fixture } from "@/lib/data";
import { useFixtures } from "@/lib/cloud";
import { Img, Lock, SealStatus, TeamBadge, TopBar } from "@/components/ui";
import { BackupNudge } from "@/components/account";
import { createSeal, short, useStore, type Seal } from "@/lib/store";
import { useTelegram } from "@/lib/telegram";

const SIDES = ["Striker scores first", "Red card shown", "Goal after 85’"];
const clamp = (n: number) => Math.max(0, Math.min(9, n));

function playSealSound() {
  try {
    const ctx = new AudioContext();
    const o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.type = "sine"; o1.frequency.setValueAtTime(180, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
    g1.gain.setValueAtTime(0.4, ctx.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    o1.connect(g1).connect(ctx.destination);
    o1.start(); o1.stop(ctx.currentTime + 0.15);

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
      <button aria-label={name + " plus one"} onClick={() => set(clamp(v + 1))} className="btn" style={{ width: 80, minHeight: 40, borderRadius: 14, border: "2px solid #111", background: "#fff", fontSize: 20, color: "#111" }}>+</button>
      <div className="display" style={{ width: 80, height: 90, borderRadius: 18, background: "#111", color: "var(--lime)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 68 }}>{v}</div>
      <button aria-label={name + " minus one"} onClick={() => set(clamp(v - 1))} className="btn" style={{ width: 80, minHeight: 40, borderRadius: 14, border: "2px solid #111", background: "#fff", fontSize: 20, color: "#111" }}>−</button>
    </div>
  );
}

function ChallengeContent() {
  const searchParams = useSearchParams();
  const fParam = searchParams.get("f");
  const hParam = searchParams.get("h");
  const aParam = searchParams.get("a");
  const byParam = searchParams.get("by");

  const challengerHome = hParam !== null ? clamp(parseInt(hParam, 10) || 0) : 2;
  const challengerAway = aParam !== null ? clamp(parseInt(aParam, 10) || 0) : 1;
  const challengerName = byParam ? decodeURIComponent(byParam) : "A friend";

  const [counterHome, setCounterHome] = useState(challengerAway);
  const [counterAway, setCounterAway] = useState(challengerHome);
  const [side, setSide] = useState(-1);
  const [mode, setMode] = useState<"tail" | "counter">("tail");
  const [sealId, setSealId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  const { haptic, shareToTelegram } = useTelegram();
  const fixtures = useFixtures();
  const fx: Fixture = fixtureOf(fParam, fixtures);
  const closed = now !== null && Date.parse(fx.kickoff) <= now;

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const seal: Seal | undefined = useStore().seals.find((s) => s.id === sealId);

  async function handleSeal(h: number, a: number, isTail: boolean) {
    if (closed || busy) return;
    setBusy(true);
    const sideSuffix = side >= 0 ? "|" + SIDES[side] : "";
    const label = `${fx.home} ${h} – ${a} ${fx.away}${isTail ? ` (Tailed ${challengerName})` : ` (Countered ${challengerName})`}`;
    const s = await createSeal("classic", fx.id, `${h}-${a}${sideSuffix}`, label);
    setSealId(s.id);
    setBusy(false);
    haptic("success");
    playSealSound();
  }

  function handleShare(h: number, a: number) {
    const url = typeof window !== "undefined" ? window.location.href : "";
    const text = `I just answered ${challengerName}'s call on ${fx.home} vs ${fx.away} with ${h}–${a}! Can you beat both of us?`;
    if (navigator.share) {
      navigator.share({ title: "Called It Challenge", text, url }).catch(() => {});
    } else {
      shareToTelegram(text, url);
    }
  }

  return (
    <main className="screen">
      <TopBar mode="classic" eyebrow="PvP Challenge" title={`${fx.home} vs ${fx.away}`} />
      <div style={{ padding: "4px 20px 0", display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
        {/* Challenge Hero Header */}
        <div style={{ background: "var(--amber)", color: "#111", borderRadius: 18, padding: "12px 16px", border: "2px solid #111", boxShadow: "4px 4px 0 var(--text)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="eyebrow" style={{ color: "#111" }}>🔥 Challenge Incoming</span>
            <span style={{ fontSize: 12, fontWeight: 800, background: "#111", color: "var(--lime)", padding: "2px 8px", borderRadius: 999 }}>TAIL OR COUNTER</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.3 }}>
            <b>{challengerName}</b> sealed their call on <b>{fx.home} vs {fx.away}</b> before kickoff!
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#423820" }}>
            Kickoff: {fx.when} · {closed ? "Match has started" : "Early bird bonus active"}
          </div>
        </div>

        {/* Challenger Card */}
        <div className="paper" style={{ borderRadius: 24, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, border: "2px solid #111", boxShadow: "5px 5px 0 var(--lime)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="eyebrow" style={{ color: "#6b6455" }}>{challengerName}&apos;s Locked Call</span>
            <Img n="seal" size={28} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <TeamBadge name={fx.home} size={42} side="home" />
              <b style={{ fontSize: 14 }}>{fx.home}</b>
            </div>
            <div className="display" style={{ fontSize: 44, color: "#111", background: "var(--lime)", padding: "4px 18px", borderRadius: 16, border: "2px solid #111" }}>
              {challengerHome} : {challengerAway}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <TeamBadge name={fx.away} size={42} side="away" />
              <b style={{ fontSize: 14 }}>{fx.away}</b>
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b6455", textAlign: "center" }}>
            Locked cryptographically before kickoff · Timestamped on Bitcoin via OTS
          </div>
        </div>

        {/* Decision Toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button
            onClick={() => setMode("tail")}
            style={{
              padding: "12px 10px",
              borderRadius: 16,
              border: `2px solid ${mode === "tail" ? "var(--lime)" : "var(--line)"}`,
              background: mode === "tail" ? "rgba(198,244,50,0.18)" : "var(--panel)",
              color: "var(--text)",
              fontWeight: 800,
              fontSize: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>⚡ Tail Call</span>
            <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>Same score ({challengerHome}–{challengerAway})</span>
          </button>
          <button
            onClick={() => setMode("counter")}
            style={{
              padding: "12px 10px",
              borderRadius: 16,
              border: `2px solid ${mode === "counter" ? "var(--pink)" : "var(--line)"}`,
              background: mode === "counter" ? "rgba(255,143,177,0.18)" : "var(--panel)",
              color: "var(--text)",
              fontWeight: 800,
              fontSize: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>⚔️ Counter Call</span>
            <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>Pick your score</span>
          </button>
        </div>

        {/* Counter Mode Controls */}
        {mode === "counter" && (
          <div className="paper" style={{ borderRadius: 24, padding: "16px", display: "flex", flexDirection: "column", gap: 12, border: "2px solid #111", animation: "pop 200ms ease-out" }}>
            <span className="eyebrow" style={{ color: "#6b6455", textAlign: "center" }}>Your Counter Score</span>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <Wheel v={counterHome} set={setCounterHome} name={fx.home} />
              <span className="display" style={{ fontSize: 42 }}>:</span>
              <Wheel v={counterAway} set={setCounterAway} name={fx.away} />
            </div>
          </div>
        )}

        {/* Optional Side Call */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontSize: 13 }}>Add a side call (optional bonus)</b>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SIDES.map((s, i) => (
              <button
                key={s}
                onClick={() => setSide(side === i ? -1 : i)}
                aria-pressed={side === i}
                style={{
                  minHeight: 40,
                  padding: "0 12px",
                  borderRadius: 999,
                  border: `2px solid ${side === i ? "#111" : "var(--line)"}`,
                  background: side === i ? "var(--lime)" : "var(--panel)",
                  color: side === i ? "#111" : "var(--text)",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div style={{ padding: "14px 20px 30px" }}>
        {mode === "tail" ? (
          <button
            className="btn btn-primary"
            style={{ width: "100%", opacity: closed ? 0.5 : 1 }}
            disabled={closed || busy}
            onClick={() => handleSeal(challengerHome, challengerAway, true)}
          >
            <Lock />
            {closed ? "Kickoff passed" : busy ? "Sealing…" : `⚡ Tail & Seal ${challengerHome} – ${challengerAway}`}
          </button>
        ) : (
          <button
            className="btn"
            style={{ width: "100%", background: "var(--pink)", color: "#111", border: "3px solid #111", fontWeight: 800, fontSize: 17, minHeight: 52, boxShadow: "0 4px 0 var(--text)", opacity: closed ? 0.5 : 1 }}
            disabled={closed || busy}
            onClick={() => handleSeal(counterHome, counterAway, false)}
          >
            <Lock />
            {closed ? "Kickoff passed" : busy ? "Sealing…" : `⚔️ Counter & Seal ${counterHome} – ${counterAway}`}
          </button>
        )}
      </div>

      {/* Success Modal */}
      {seal && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(11,15,20,.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 26, textAlign: "center" }}>
          <Img n="seal" size={170} alt="Wax seal" className="stamp" />
          <div className="display" style={{ fontSize: 36 }}>Challenge Accepted!</div>
          <div style={{ fontSize: 14, color: "#c9d3de", lineHeight: 1.5 }}>
            Your call on <b>{fx.home} vs {fx.away}</b> is sealed.<br />
            {mode === "tail" ? `You tailed ${challengerName}'s ${challengerHome}–${challengerAway}.` : `You countered ${challengerName} with ${counterHome}–${counterAway}.`}
          </div>
          <SealStatus seal={seal} />
          <details style={{ fontSize: 12, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>View proof details</summary>
            <div className="mono" style={{ background: "var(--panel)", borderRadius: 10, padding: "8px 12px", marginTop: 6 }}>
              seal {short(seal.commitment)}{seal.txid ? ` · block ${seal.height?.toLocaleString()} · tx ${short(seal.txid)}` : ""}
            </div>
          </details>
          <div style={{ width: "100%", textAlign: "left" }}><BackupNudge what="calls and proofs" /></div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%", marginTop: 8 }}>
            <button
              onClick={() => handleShare(mode === "tail" ? challengerHome : counterHome, mode === "tail" ? challengerAway : counterAway)}
              className="btn btn-paper"
              style={{ fontWeight: 800 }}
            >
              Share Challenge
            </button>
            <Link href="/waiting" className="btn btn-primary" style={{ fontWeight: 800 }}>
              Waiting Room
            </Link>
          </div>
          <button onClick={() => setSealId(null)} style={{ minHeight: 44, background: "transparent", border: 0, color: "var(--lime)", fontWeight: 700, fontSize: 14 }}>
            Seal another call
          </button>
        </div>
      )}
    </main>
  );
}

export default function CallChallengePage() {
  return (
    <Suspense fallback={
      <main className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--muted)", fontWeight: 700 }}>Loading challenge…</div>
      </main>
    }>
      <ChallengeContent />
    </Suspense>
  );
}
