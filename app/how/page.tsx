"use client";
import Link from "next/link";
import { BottomNav, Img, Lock } from "@/components/ui";

const STEPS = [
  { n: 1, title: "You call it", desc: "Pick the final score before kickoff. Your call is locked on your phone with a unique fingerprint (a hash). Nobody — not even us — can read it.", bg: "var(--sky)" },
  { n: 2, title: "We seal it", desc: "The fingerprint is sent to our server and stamped with a timestamp. It's batched and anchored — like a notary stamp you can verify forever.", bg: "var(--amber)" },
  { n: 3, title: "You prove it", desc: "After the match, you reveal your call. Anyone can check: the fingerprint matches, the timestamp is before kickoff, and nobody could have changed it.", bg: "var(--lime)" },
];

export default function HowPage() {
  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22, paddingBottom: 40 }}>
        <div>
          <Link href="/" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>← Home</Link>
          <h1 className="display" style={{ margin: "6px 0 0", fontSize: 36 }}>How your seal works</h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>
            Three steps. Zero trust required. Nobody can cheat — not the other players, not us.
          </p>
        </div>

        {STEPS.map((s) => (
          <div key={s.n} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <span className="display" style={{ width: 48, height: 48, borderRadius: 16, background: s.bg, color: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0, border: "2px solid #111" }}>{s.n}</span>
            <div style={{ flex: 1 }}>
              <div className="display" style={{ fontSize: 20, marginBottom: 4 }}>{s.title}</div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>{s.desc}</p>
            </div>
          </div>
        ))}

        <div style={{ background: "var(--paper)", color: "#111", borderRadius: 22, border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Lock size={28} />
            <span className="display" style={{ fontSize: 20 }}>What makes it fair?</span>
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 20px", fontSize: 14, fontWeight: 600, lineHeight: 1.6, color: "#4a4436" }}>
            <li>Your actual call never leaves your phone until you choose to reveal it.</li>
            <li>Only a fingerprint (a one-way hash) is sent to the server.</li>
            <li>The server timestamps it and batches it with other seals into a permanent record.</li>
            <li>After reveal, anyone can re-compute the fingerprint and confirm it matches.</li>
            <li>The timestamp proves you sealed before kickoff.</li>
          </ul>
        </div>

        <div style={{ background: "#111", borderRadius: 22, border: "2px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Img n="seal" size={36} />
            <span className="display" style={{ fontSize: 18 }}>Powered by Zcash</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>
            Seal batches are anchored on the Zcash blockchain — a permanent, public ledger nobody controls. This means even we can&apos;t tamper with the timestamps after the fact. Think of it like a notary stamp that lives forever on a public record.
          </p>
          <details style={{ fontSize: 12, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--lime)" }}>Technical details</summary>
            <div style={{ paddingTop: 8, lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 6px" }}>Each seal is a SHA-256 hash of <code style={{ background: "rgba(255,255,255,.1)", padding: "2px 6px", borderRadius: 4 }}>calledit:v1|player|round|move|salt</code>.</p>
              <p style={{ margin: "0 0 6px" }}>Seals are batched into a Merkle tree. The tree root is written into a Zcash shielded transaction memo.</p>
              <p style={{ margin: 0 }}>Each seal carries a Merkle proof linking it to the on-chain root. Verification is offline and instant.</p>
            </div>
          </details>
        </div>

        <Link href="/seal" className="btn btn-primary" style={{ textAlign: "center", minHeight: 56, fontSize: 17, boxShadow: "0 5px 0 var(--text)" }}>Seal your first call</Link>
      </div>
      <BottomNav active="/" />
    </main>
  );
}
