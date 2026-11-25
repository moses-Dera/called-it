"use client";
import Link from "next/link";
import { BottomNav, Img, Lock } from "@/components/ui";

const STEPS = [
  { n: 1, title: "You call it", desc: "Pick your call before kickoff. Your phone turns it into a unique fingerprint (a one-way hash). Nobody, not even us, can work out your call from it.", bg: "var(--sky)" },
  { n: 2, title: "We seal it", desc: "The fingerprint reaches our server with the time it arrived, then it is batched with other seals and timestamped on Bitcoin. Like a notary stamp that lasts forever.", bg: "var(--amber)" },
  { n: 3, title: "You prove it", desc: "After full time your call is revealed. Anyone can check that it matches the fingerprint and that it was sealed before kickoff.", bg: "var(--lime)" },
];

const WHO = [
  { title: "Players", desc: "Play free with friends, climb the ranks, and win ZEC in contests.", href: "/contests", cta: "See contests" },
  { title: "Tipsters", desc: "Publish a record of your calls that nobody can fake. Losing tips can't be hidden or deleted.", href: "/profile", cta: "Start a public record" },
  { title: "Sponsors", desc: "Put up a ZEC prize pool on real matches. Fans play free and every winner can be checked.", href: "/sponsor", cta: "Sponsor a contest" },
];

export default function HowPage() {
  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 22, paddingBottom: 40 }}>
        <div>
          <Link href="/" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>← Home</Link>
          <h1 className="display" style={{ margin: "6px 0 0", fontSize: 36 }}>How your seal works</h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>
            Everyone has a friend who says &ldquo;I called it&rdquo; after the final whistle. Called It makes that provable. Nobody can change a call after kickoff, not the other players and not us.
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
            <li>Only the fingerprint is timestamped. Other players never see your call before the reveal.</li>
            <li>If you sign in, an encrypted copy of your call is kept with your account so you can reveal it from any device.</li>
            <li>The time your fingerprint reached the server decides whether it beat kickoff. Late seals never count.</li>
            <li>After the reveal, anyone can recompute the fingerprint and confirm it matches.</li>
            <li>Ranked points and contest results are scored by the server against the official result, never by your phone.</li>
          </ul>
        </div>

        <div style={{ background: "#111", borderRadius: 22, border: "2px solid var(--line)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Img n="seal" size={36} />
            <span className="display" style={{ fontSize: 18 }}>Timestamped on Bitcoin, paid in Zcash</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>
            Seal batches are timestamped on Bitcoin through OpenTimestamps, a free public service. Once a batch is in a Bitcoin block, nobody, including us, can change when it was sealed. Prizes are paid in ZEC to shielded addresses, so what you win stays private.
          </p>
          <details style={{ fontSize: 12, color: "var(--muted)" }}>
            <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--lime)" }}>Technical details</summary>
            <div style={{ paddingTop: 8, lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 6px" }}>Each seal is a SHA-256 hash of <code style={{ background: "rgba(255,255,255,.1)", padding: "2px 6px", borderRadius: 4 }}>calledit:v1|player|round|move|salt</code>.</p>
              <p style={{ margin: "0 0 6px" }}>Seals are batched into a Merkle tree, and the tree&apos;s root is submitted to the OpenTimestamps calendars, which commit it into a Bitcoin block.</p>
              <p style={{ margin: 0 }}>Each seal keeps a Merkle proof linking it to the root, and each root has a standard .ots proof file. Anyone can check it with the official <code style={{ background: "rgba(255,255,255,.1)", padding: "2px 6px", borderRadius: 4 }}>ots verify</code> tool, without trusting us.</p>
            </div>
          </details>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Who it&apos;s for</h2>
          {WHO.map((w) => (
            <Link key={w.title} href={w.href} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: "12px 14px", color: "var(--text)" }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <b style={{ fontSize: 15 }}>{w.title}</b>
                <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{w.desc}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--lime)", whiteSpace: "nowrap" }}>{w.cta} →</span>
            </Link>
          ))}
        </section>

        <Link href="/seal" className="btn btn-primary" style={{ textAlign: "center", minHeight: 56, fontSize: 17, boxShadow: "0 5px 0 var(--text)" }}>Seal your first call</Link>
      </div>
      <BottomNav active="/how" />
    </main>
  );
}
