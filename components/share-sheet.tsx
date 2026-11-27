"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

// One app-styled share panel for every Share button, instead of the device's own share sheet (which looks
// different everywhere and, on desktops without one, used to open Telegram on its own).
type Req = { title: string; text: string; url: string };
let current: Req | null = null;
const subs = new Set<() => void>();
const set = (r: Req | null) => { current = r; subs.forEach((s) => s()); };

/** Open the share panel. */
export function openShare(r: Req) { set(r); }

export function ShareHost() {
  const req = useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => current, () => null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!req) return;
    setCopied(false);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") set(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [req]);
  if (!req) return null;
  const t = encodeURIComponent(req.text), u = encodeURIComponent(req.url);
  const targets = [
    ["X", `https://x.com/intent/post?text=${t}&url=${u}`],
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${req.text} ${req.url}`)}`],
    ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`],
  ] as const;
  const copy = () => navigator.clipboard?.writeText(req.url).then(() => setCopied(true), () => setCopied(false));
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const btn = { minHeight: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" } as const;
  return (
    <div onClick={() => set(null)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(440px, 100%)", background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 22, boxShadow: "6px 6px 0 var(--text)", padding: 18, display: "flex", flexDirection: "column", gap: 10, marginBottom: "env(safe-area-inset-bottom)" }}>
        <h2 id="share-title" className="display" style={{ margin: 0, fontSize: 22 }}>{req.title}</h2>
        <button onClick={copy} style={{ ...btn, background: copied ? "var(--lime)" : "#111", color: copied ? "#111" : "var(--lime)", border: 0 }}>{copied ? "✓ Link copied" : "Copy link"}</button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {targets.map(([name, href]) => <a key={name} href={href} target="_blank" rel="noopener noreferrer" onClick={() => set(null)} style={btn}>{name}</a>)}
        </div>
        {canNative && <button onClick={() => { navigator.share({ title: req.title, text: req.text, url: req.url }).catch(() => {}); set(null); }} style={{ ...btn, background: "transparent" }}>More apps…</button>}
        <button onClick={() => set(null)} style={{ background: "none", border: 0, fontWeight: 800, color: "#4a4436", minHeight: 40 }}>Close</button>
      </div>
    </div>
  );
}
