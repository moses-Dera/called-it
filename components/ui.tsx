"use client";
import Link from "next/link";
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { GUIDES, MODES, art } from "@/lib/data";
import type { Seal } from "@/lib/store";

export function Img({ n, size, h, alt = "", style, className }: { n: string; size: number; h?: number; alt?: string; style?: React.CSSProperties; className?: string }) {
  return <img src={art(n)} alt={alt} width={size} height={h ?? size} loading="lazy" decoding="async" className={className} style={{ width: size, height: h ?? size, ...style }} />;
}

const BADGE_COLORS = ["#e63946","#1d3557","#2a9d8f","#e9c46a","#f4a261","#264653","#6a4c93","#1982c4","#8ac926","#ff595e"];
export function TeamBadge({ name, size = 56, side }: { name: string; size?: number; side?: "home" | "away" }) {
  const abbr = name.slice(0, 3).toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % BADGE_COLORS.length;
  const bg = side === "away" ? BADGE_COLORS[(idx + 5) % BADGE_COLORS.length] : BADGE_COLORS[idx];
  const fs = size * 0.32;
  return (
    <div style={{ width: size, height: size * 1.15, position: "relative", flexShrink: 0 }}>
      <svg viewBox="0 0 56 65" width={size} height={size * 1.15} style={{ display: "block" }}>
        <path d="M28 2 L52 12 L52 38 Q52 56 28 63 Q4 56 4 38 L4 12 Z" fill={bg} stroke="#111" strokeWidth="3" />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: size * 0.08, fontWeight: 800, fontSize: fs, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.4)", letterSpacing: 0.5 }}>{abbr}</span>
    </div>
  );
}

export function Skeleton({ w, h = 20, r = 10, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w ?? "100%", height: h, borderRadius: r, ...style }} />;
}

export function SkeletonCard({ h = 80 }: { h?: number }) {
  return (
    <div style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 18, padding: 14, display: "flex", alignItems: "center", gap: 12, minHeight: h }}>
      <Skeleton w={40} h={40} r={12} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton w="70%" h={16} />
        <Skeleton w="40%" h={12} />
      </div>
    </div>
  );
}

export function SkeletonFeatured() {
  return (
    <div style={{ background: "var(--panel)", border: "3px solid var(--line)", borderRadius: 22, padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 160 }}>
      <Skeleton w={100} h={12} />
      <Skeleton w="80%" h={28} r={8} />
      <Skeleton w={130} h={14} />
      <div style={{ flex: 1 }} />
      <Skeleton h={42} r={14} />
    </div>
  );
}

type EBState = { error: Error | null };
export class ErrorBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{ padding: 20, background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 18, display: "flex", flexDirection: "column", gap: 10, alignItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--red)" }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{this.state.error.message}</div>
          <button onClick={() => this.setState({ error: null })} style={{ minHeight: 40, padding: "0 16px", borderRadius: 12, border: "2px solid var(--line)", background: "var(--panel)", color: "var(--text)", fontWeight: 800, fontSize: 13 }}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
const Back = ({ color }: { color: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
);
export const Lock = ({ size = 22, color = "#111" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);

/** Header with back, title and the "?" how-to-play guide. The guide opens by itself on first visit (phones and tablets). */
export function TopBar({ mode, eyebrow, title, accent = "var(--lime)", light = false }: { mode?: string; eyebrow: string; title: string; accent?: string; light?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // On wide screens the dashboard rail already shows the guide, so do not pop it up.
    if (!mode || matchMedia("(min-width: 1180px)").matches) return;
    try { if (!localStorage.getItem("guide:" + mode)) { setOpen(true); localStorage.setItem("guide:" + mode, "1"); } } catch {}
  }, [mode]);
  const bg = light ? "var(--black)" : "var(--paper)", fg = light ? accent : "#111";
  const g = mode ? GUIDES[mode] : null;
  return (
    <>
      <header className="topbar" style={{ padding: "16px 20px 8px", display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 2 }}>
        <Link href="/" aria-label="Back to home" className="iconbtn" style={{ background: bg }}><Back color={fg} /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ color: light ? "#111" : accent }}>{eyebrow}</div>
          <div className="display topbar-title" style={{ fontSize: 21 }}>{title}</div>
        </div>
        {g && <button aria-label="How to play" onClick={() => setOpen(true)} className="iconbtn display" style={{ background: bg, color: fg, fontSize: 20 }}>?</button>}
      </header>
      {g && open && (
        <div role="dialog" aria-modal="true" aria-label={"How to play " + g.title} onClick={() => setOpen(false)} className="guide" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(5,7,10,.7)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
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

/** Two honest steps: "Sealed" at once, then "Stamped" when the batch is anchored. */
export function SealStatus({ seal }: { seal?: Seal | null }) {
  if (!seal) return null;
  const on = seal.status === "onchain";
  return (
    <span className="chip" style={{ background: on ? "var(--lime)" : "var(--amber)" }}>
      <Lock size={12} />{on ? "SEALED & STAMPED" : "SEALED · STAMPING…"}
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
   
  <img src={art("cardback")} alt="Sealed" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: radius, border: "2px solid #111", display: "block" }} />
);

const NAV = [
  { href: "/", label: "Home", d: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/contests", label: "Contests", d: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" },
  null,
  { href: "/rooms", label: "Friends", d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
];
const MORE = [
  { href: "/vault", label: "My prizes and proofs" },
  { href: "/profile", label: "Profile and wallet" },
  { href: "/ranks", label: "Ranks" },
  { href: "/play/arena", label: "Live Arena" },
  { href: "/sponsor", label: "Run a contest" },
  { href: "/how", label: "How your seal works" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];
const MORE_ICON = "M4 6h16M4 12h16M4 18h16";
// Sits just above the tab bar (70px tall, 14px from the bottom, scaled with the phone zoom --z).
const SHEET_BOTTOM = "calc(96px * var(--z, 1) + env(safe-area-inset-bottom))";

function MoreSheet({ open, active, onClose }: { open: boolean; active: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  // Swipe down to dismiss, but only once the sheet's own list is scrolled to the top.
  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    let startY = 0, lastY = 0, lastT = 0, speed = 0, pulling = false;
    const start = (e: TouchEvent) => { startY = lastY = e.touches[0].clientY; lastT = e.timeStamp; speed = 0; pulling = false; };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY, dy = y - startY;
      if (!pulling && dy > 6 && el.scrollTop <= 0) pulling = true;
      if (!pulling) return;
      e.preventDefault();
      speed = (y - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = y; lastT = e.timeStamp;
      setDrag(Math.max(0, dy));
    };
    const end = () => {
      if (!pulling) return;
      pulling = false;
      if (lastY - startY > 90 || speed > 0.5) onClose();
      setDrag(0);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [open, onClose]);
  return createPortal(
    <div className="navwrap" inert={!open} aria-hidden={!open} style={{ position: "fixed", inset: 0, zIndex: 19, pointerEvents: open ? "auto" : "none" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", opacity: open ? Math.max(0.2, 1 - drag / 300) : 0, transition: drag ? "none" : "opacity 220ms" }} />
      <div ref={ref} id="more-sheet" role="dialog" aria-label="More" style={{ position: "absolute", left: 14, right: 14, bottom: SHEET_BOTTOM, maxHeight: `calc(100dvh - ${SHEET_BOTTOM} - 24px)`, overflowY: "auto", overscrollBehavior: "contain", background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 24, boxShadow: "0 10px 30px rgba(0,0,0,.45)", padding: "14px 14px 18px", display: "flex", flexDirection: "column", gap: 4, opacity: open ? 1 : 0, transform: `translateY(${open ? drag : 24}px)`, transition: drag ? "none" : "transform 260ms cubic-bezier(.3,1.2,.4,1), opacity 180ms" }}>
        {MORE.map((m) => (
          <Link key={m.href} href={m.href} onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, padding: "0 14px", borderRadius: 14, background: active === m.href ? "rgba(17,17,17,.08)" : "transparent", color: "#111", fontWeight: 800, fontSize: 15 }}>
            {m.label}<span>→</span>
          </Link>
        ))}
        <div className="eyebrow" style={{ color: "#6b6455", padding: "12px 14px 4px" }}>Games</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          {MODES.map((m) => (
            <Link key={m.key} href={m.href} onClick={onClose} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "#111", fontSize: 11, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>
              <Img n={m.img} size={56} style={{ borderRadius: 14, border: "2px solid #111" }} />{m.name}
            </Link>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BottomNav({ active }: { active: string }) {
  const [hide, setHide] = useState(false);
  const [more, setMore] = useState(false);
  const [mounted, setMounted] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const close = useCallback(() => setMore(false), []);
  useEffect(() => { setMore(false); }, [pathname]);
  useEffect(() => {
    setMounted(true);
    let last = window.scrollY;
    const on = () => { const y = window.scrollY; if (Math.abs(y - last) > 6) { setHide(y > last && y > 40); last = y; } };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!more) return;
    const btn = moreBtn.current;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    window.addEventListener("keydown", esc);
    // The sheet only exists on phones; widening the screen must not leave the page scroll-locked.
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => { if (wide.matches) setMore(false); };
    wide.addEventListener("change", onWide);
    window.addEventListener("resize", onWide);
    // Lock both scroll roots so scrolling the sheet never moves the page behind it.
    const html = document.documentElement, body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); wide.removeEventListener("change", onWide); window.removeEventListener("resize", onWide); [html.style.overflow, body.style.overflow] = prev; btn?.focus({ preventScroll: true }); };
  }, [more]);
  const inBar = NAV.some((n) => n?.href === active);
  const tab = { display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 800, minWidth: 48, minHeight: 44, justifyContent: "center", background: "none", border: 0, padding: 0, fontFamily: "inherit" } as const;
  const icon = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
  return (
    <><div className="navspace" />
    <nav aria-label="Main" className={"tabbar" + (hide && !more ? " hide" : "")} style={{ height: 70, background: "var(--paper)", borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "space-around", color: "#111", flexShrink: 0 }}>
      {NAV.map((n, i) => n ? (
        <Link key={n.href} href={n.href} onClick={close} style={{ ...tab, color: active === n.href ? "#111" : "#6b6455" }}>{icon(n.d)}{n.label}</Link>
      ) : (
        <Link key={i} href="/seal" onClick={close} aria-label="Seal a call" style={{ width: 62, height: 62, marginTop: -34, borderRadius: "50%", background: "var(--lime)", border: "3px solid #111", boxShadow: "0 6px 0 #111", display: "flex", alignItems: "center", justifyContent: "center" }}><Lock size={26} /></Link>
      ))}
      <button ref={moreBtn} type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="more-sheet" style={{ ...tab, color: !inBar ? "#111" : "#6b6455" }}>{icon(MORE_ICON)}More</button>
    </nav>
    {mounted && <MoreSheet open={more} active={active} onClose={close} />}
    </>
  );
}

/** Under a game's header: switch from the practice version (bots) to a real game with friends. */
export function RealPlay({ game, dark = false }: { game: string; dark?: boolean }) {
  return (
    <Link href={`/rooms?game=${game}`} style={{ margin: "0 20px 6px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderRadius: 14, background: dark ? "#111" : "rgba(17,17,17,.88)", color: "var(--paper)", fontSize: 13, fontWeight: 700, position: "relative", zIndex: 2 }}>
      <span>Practice vs bots. <span style={{ color: "var(--lime)" }}>Play a real person</span></span><span style={{ color: "var(--lime)" }}>→</span>
    </Link>
  );
}
