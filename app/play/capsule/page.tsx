"use client";
import { useState } from "react";
import { Img, SealStatus, TopBar, RealPlay } from "@/components/ui";
import { sha256Hex } from "@/lib/merkle";
import { createSeal, useStore } from "@/lib/store";

const KINDS = ["Letter", "Photo", "Voice note"];
async function hashFile(f: File) {
  const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export default function Capsule() {
  const [kind, setKind] = useState(0), [text, setText] = useState(""), [file, setFile] = useState<File | null>(null);
  const [opens, setOpens] = useState("2031-11-14"), [sealId, setSealId] = useState<string | null>(null), [err, setErr] = useState("");
  const seal = useStore().seals.find((s) => s.id === sealId);
  const buried = !!sealId;
  async function bury() {
    if (buried) { setSealId(null); setText(""); setFile(null); return; }
    if (kind === 0 && !text.trim()) return setErr("Write something to your future self first.");
    if (kind !== 0 && !file) return setErr(`Choose a ${kind === 1 ? "photo" : "voice note"} first.`);
    setErr("");
    // Only the fingerprint is sealed. The content itself stays on this device.
    const fingerprint = kind === 0 ? await sha256Hex(text) : await hashFile(file!);
    const s = await createSeal("capsule", "capsule-" + opens, `${KINDS[kind]}:${fingerprint}`, `Time capsule (${KINDS[kind].toLowerCase()}) · opens ${opens}`);
    setSealId(s.id);
  }
  return (
    <main className="screen" style={{ background: "var(--sky)", color: "#111" }}>
      <TopBar mode="capsule" eyebrow="Time Capsule" title="Class of 2026 reunion" light accent="var(--sky)" />
      <RealPlay game="capsule" />
      <div style={{ display: "flex", justifyContent: "center", height: buried ? 150 : 230, transition: "height 600ms", position: "relative" }}>
        <Img n="cover_capsule" size={220} alt="Capsule" style={{ borderRadius: 40, border: "3px solid #111", boxShadow: "6px 6px 0 #111", transform: buried ? "translateY(40px) rotate(18deg) scale(.5)" : "rotate(-4deg)", transition: "transform 700ms cubic-bezier(.5,-0.4,.4,1.4)" }} />
      </div>
      {!buried ? (
        <section style={{ margin: "6px 20px 0", padding: 16, borderRadius: 24, background: "#fff", border: "3px solid #111", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {KINDS.map((k, i) => <button key={k} aria-pressed={kind === i} onClick={() => { setKind(i); setErr(""); }} style={{ height: 56, borderRadius: 16, border: "2px solid #111", background: kind === i ? "var(--yellow)" : "#fff", color: "#111", fontWeight: 800, fontSize: 13 }}>{k}</button>)}
          </div>
          {kind === 0 ? (
            <><label htmlFor="note" style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>Write to the future</label>
              <textarea id="note" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Where I think we'll all be in 5 years…" style={{ borderRadius: 14, border: "2px solid #111", padding: "10px 12px", font: "500 15px var(--font-inter), sans-serif", resize: "none", background: "var(--paper)", color: "#111" }} /></>
          ) : (
            <><label htmlFor="file" style={{ fontSize: 12, fontWeight: 700, color: "#4a4436" }}>{kind === 1 ? "Pick a photo to seal" : "Pick or record a voice note"}</label>
              <input id="file" type="file" accept={kind === 1 ? "image/*" : "audio/*"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13, minHeight: 44 }} /></>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <label htmlFor="opens" style={{ fontWeight: 700 }}>Opens on</label>
            <input id="opens" type="date" value={opens} min="2026-11-15" onChange={(e) => setOpens(e.target.value)} style={{ height: 44, borderRadius: 10, border: "2px solid #111", padding: "0 10px", fontWeight: 800, background: "#111", color: "var(--sky)", colorScheme: "dark" }} />
          </div>
        </section>
      ) : (
        <section className="paper pop" style={{ margin: "6px 20px 0", padding: 18, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <span className="display" style={{ fontSize: 26 }}>Buried until {opens}</span>
          <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>Its fingerprint is sealed, proving it existed today. The content never left your phone.</span>
          <SealStatus seal={seal} />
        </section>
      )}
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ padding: "0 20px 28px", display: "flex", flexDirection: "column", gap: 8 }}>
        {err && <div role="alert" style={{ fontSize: 13, fontWeight: 800 }}>{err}</div>}
        <button className="btn btn-primary" style={{ background: "#111", color: "var(--sky)", boxShadow: "0 6px 0 var(--blue)" }} onClick={bury}>{buried ? "Bury another" : "Seal and bury"}</button>
      </div>
    </main>
  );
}
