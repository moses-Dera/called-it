"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GUIDES, art } from "@/lib/data";
import type { Seal } from "@/lib/store";

export function Img({ n, size, h, alt = "", style, className }: { n: string; size: number; h?: number; alt?: string; style?: React.CSSProperties; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={art(n)} alt={alt} width={size} height={h ?? size} loading="lazy" decoding="async" className={className} style={{ width: size, height: h ?? size, ...style }} />;
}
const Back = ({ color }: { color: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
);
export const Lock = ({ size = 22, color = "#111" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);

/** Header with back, title and the "?" how-to-play guide. The guide opens by itself on first visit. */
export function TopBar({ mode, eyebrow, title, accent = "var(--lime)", light = false }: { mode?: string; eyebrow: string; title: string; accent?: string; light?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!mode) return;
    try { if (!localStorage.getItem("guide:" + mode)) { setOpen(true); localStorage.setItem("guide:" + mode, "1"); } } catch {}
  }, [mode]);
  const bg = light ? "var(--black)" : "var(--paper)", fg = light ? accent : "#111";
  const g = mode ? GUIDES[mode] : null;
  return (
    <>
      <header style={{ padding: "16px 20px 8px", display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 2 }}>
        <Link href="/" aria-label="Back to home" className="iconbtn" style={{ background: bg }}><Back color={fg} /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ color: light ? "#111" : accent }}>{eyebrow}</div>
          <div className="display" style={{ fontSize: 21 }}>{title}</div>
        </div>
        {g && <button aria-label="How to play" onClick={() => setOpen(true)} className="iconbtn display" style={{ background: bg, color: fg, fontSize: 20 }}>?</button>}
      </header>
      {g && open && (
        <div role="dialog" aria-modal="true" aria-label={"How to play " + g.title} onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,7,10,.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div className="sheet paper" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, borderRadius: "28px 28px 0 0", padding: "22px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="eyebrow" style={{ color: "#6b6455" }}>How to play</div>
            <div className="display" style={{ fontSize: 30 }}>{g.title}</div>
            {g.steps.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="display" style={{ width: 32, height: 32, borderRadius: 10, background: "#111", color: "var(--lime)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, paddingTop: 5 }}>{s}</span>
              </div>
            ))}
            <div style={{ borderTop: "2px dashed #c9bfa6", paddingTop: 12, fontSize: 13, lineHeight: 1.5 }}><b>Scoring:</b> {g.scoring}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}><b>Why it&apos;s fair:</b> {g.fair}</div>
            <button className="btn btn-primary" style={{ boxShadow: "0 6px 0 #111" }} onClick={() => setOpen(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Two honest steps: "Sealed" at once, then "On-chain" when the batch is anchored. */
export function SealStatus({ seal }: { seal?: Seal | null }) {
  if (!seal) return null;
  const on = seal.status === "onchain";
  return (
    <span className="chip" style={{ background: on ? "var(--lime)" : "var(--amber)" }}>
      <Lock size={12} />{on ? (seal.mode === "testnet" ? "ON-CHAIN · TESTNET" : "ANCHORED · SIMULATED") : "SEALED · ANCHORING…"}
    </span>
  );
}

export function Flip({ on, front, back, w, h, delay = 0, style }: { on: boolean; front: React.ReactNode; back: React.ReactNode; w: number | string; h: number | string; delay?: number; style?: React.CSSProperties }) {
  return (
    <div className="flip" style={{ width: w, height: h, ...style }}>
      <div className={"flip-inner" + (on ? " on" : "")} style={{ transitionDelay: delay + "ms" }}>
        <div className="flip-face">{front}</div>
        <div className="flip-face flip-back">{back}</div>
      </div>
    </div>
  );
}
export const CardBack = ({ radius = 10 }: { radius?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={art("cardback")} alt="Sealed" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: radius, border: "2px solid #111", display: "block" }} />
);

const NAV = [
  { href: "/", label: "Home", d: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/play/arena", label: "Live", d: "M13 2L4 14h7l-1 8 9-12h-7z" },
  null,
  { href: "/ranks", label: "Ranks", d: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" },
  { href: "/vault", label: "Vault", d: "M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM12 9.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
];
export function BottomNav({ active }: { active: string }) {
  return (
    <nav aria-label="Main" style={{ margin: "0 14px calc(14px + env(safe-area-inset-bottom))", height: 70, background: "var(--paper)", borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "space-around", color: "#111", flexShrink: 0 }}>
      {NAV.map((n, i) => n ? (
        <Link key={n.href} href={n.href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 800, minWidth: 48, minHeight: 44, justifyContent: "center", color: active === n.href ? "#111" : "#6b6455" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.d} /></svg>{n.label}
        </Link>
      ) : (
        <Link key={i} href="/seal" aria-label="Seal a call" style={{ width: 62, height: 62, marginTop: -34, borderRadius: "50%", background: "var(--lime)", border: "3px solid #111", boxShadow: "0 6px 0 #111", display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={26} /></Link>
      ))}
    </nav>
  );
}
