"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// App-styled replacements for the browser's confirm(), prompt() and alert().
// Call askConfirm / askText / showNotice from anywhere; <DialogHost /> (rendered once in the shell) shows them.

type Req =
  | { kind: "confirm"; title: string; body?: string; confirmLabel: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "text"; title: string; body?: string; placeholder?: string; confirmLabel: string; type?: "text" | "password"; resolve: (v: string | null) => void }
  | { kind: "notice"; title: string; body?: string; resolve: () => void };

let current: Req | null = null;
const subs = new Set<() => void>();
const set = (r: Req | null) => { current = r; subs.forEach((s) => s()); };

export function askConfirm(o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => set({ kind: "confirm", confirmLabel: "Confirm", ...o, resolve }));
}
export function askText(o: { title: string; body?: string; placeholder?: string; confirmLabel?: string; type?: "text" | "password" }): Promise<string | null> {
  return new Promise((resolve) => set({ kind: "text", confirmLabel: "Save", ...o, resolve }));
}
export function showNotice(o: { title: string; body?: string }): Promise<void> {
  return new Promise((resolve) => set({ kind: "notice", ...o, resolve }));
}

export function DialogHost() {
  const req = useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => current, () => null);
  const [text, setText] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (ok: boolean) => {
    if (!req) return;
    if (req.kind === "confirm") req.resolve(ok);
    else if (req.kind === "text") req.resolve(ok ? text : null);
    else req.resolve();
    setText(""); set(null);
  };

  useEffect(() => {
    if (!req) return;
    (req.kind === "text" ? inputRef.current : confirmRef.current)?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  if (!req) return null;
  return (
    <div onClick={() => close(false)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); close(true); }}
        style={{ width: "min(440px, 100%)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 22, boxShadow: "6px 6px 0 var(--text)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="dlg-title" className="display" style={{ margin: 0, fontSize: 22 }}>{req.title}</h2>
        {req.body && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#4a4436" }}>{req.body}</p>}
        {req.kind === "text" && (
          <input ref={inputRef} type={req.type ?? "text"} autoComplete={req.type === "password" ? "current-password" : "off"} value={text} onChange={(e) => setText(e.target.value)} placeholder={req.placeholder} aria-label={req.title}
            style={{ height: 46, borderRadius: 12, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 15 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {req.kind !== "notice" && <button type="button" className="btn btn-paper" onClick={() => close(false)} style={{ width: "auto", padding: "0 18px" }}>Cancel</button>}
          <button ref={confirmRef} type="submit" className="btn" style={{ width: "auto", padding: "0 18px", border: 0, background: req.kind === "confirm" && req.danger ? "var(--red)" : "#111", color: req.kind === "confirm" && req.danger ? "#111" : "var(--lime)" }}>
            {req.kind === "notice" ? "OK" : req.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
