"use client";
import { useState } from "react";
import { BottomNav, TopBar } from "@/components/ui";
import { cloudReady, cloudRpc, signInWithGoogle, useCloud, useSponsorDashboard } from "@/lib/cloud";
import { SponsorDashboardView } from "@/components/sponsor-dashboard";

const GETS = [
  ["Your brand on the contest", "Your name, logo, colour and website on the contest page, the contest list and Home."],
  ["Fair by design", "Every entry is sealed before kickoff and timestamped on Bitcoin. You can check every winner yourself."],
  ["You pay winners directly", "Prizes go from your wallet straight to each winner in shielded ZEC. Called It never holds your money."],
  ["Free for players", "Nobody pays to enter, so your contest reaches every football fan on Called It."],
] as const;
const STEPS = [
  "Sign in with Google and type your brand or community name.",
  "Create a contest: choose football (pick matches by league) or a game like Rock Paper Scissors or Bluff Vault, then set the prize. New sponsors start with up to 0.5 ZEC in prizes; the limit grows as you pay.",
  "Watch entries live. Results settle automatically at full time and the winners are ranked.",
  "Pay each winner within 72 hours with the one-tap wallet link in your dashboard. Each winner confirms it arrived, and your public record shows you paid.",
];

export default function SponsorPage() {
  const signedIn = !!useCloud().session;
  const { data: dash, reload } = useSponsorDashboard();
  if (signedIn && dash) {
    return (
      <main className="screen wide hub hub-pad">
        <div className="hub-inner" style={{ paddingBottom: 24 }}>
          <SponsorDashboardView data={dash} reload={reload} />
        </div>
        <BottomNav active="/sponsor" />
      </main>
    );
  }
  return <SponsorPitch signedIn={signedIn} checking={signedIn && dash === undefined} onStarted={reload} />;
}

function SponsorPitch({ signedIn, checking, onStarted }: { signedIn: boolean; checking: boolean; onStarted: () => void }) {
  const [brand, setBrand] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (brand.trim().length < 2) return setErr("Type your brand or community name.");
    setBusy(true); setErr("");
    try { await cloudRpc("become_sponsor", { p_name: brand }); onStarted(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not start. Please try again."); setBusy(false); }
  }

  return (
    <main className="screen wide hub">
      <div className="hub-inner">
        <TopBar eyebrow="For brands and communities" title="Sponsor a contest" />
        <div className="sponsor-body" style={{ padding: "4px 18px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#c9d3de" }}>Put up a ZEC prize for football predictions or a multiplayer game night. Fans play free, and every result can be checked. You set it up yourself in a few minutes.</p>

        <section className="paper" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, color: "#111" }}>
          {!signedIn ? (
            <>
              <b className="display" style={{ fontSize: 22 }}>Start sponsoring</b>
              <span style={{ fontSize: 14, lineHeight: 1.5 }}>Sign in with Google to open your sponsor dashboard. No forms, no waiting.</span>
              <button className="btn" disabled={!cloudReady} onClick={signInWithGoogle} style={{ background: "#111", color: "var(--lime)", border: 0 }}>Sign in with Google</button>
            </>
          ) : checking ? (
            <span style={{ fontSize: 14 }}>Opening your dashboard…</span>
          ) : (
            <form onSubmit={start} noValidate style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <b className="display" style={{ fontSize: 22 }}>Start sponsoring</b>
              <label htmlFor="sp-brand" style={{ fontSize: 12, fontWeight: 800 }}>Your brand or community name</label>
              <input id="sp-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} autoComplete="organization" placeholder="Naija Ballers FC"
                style={{ height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 16, fontWeight: 600 }} />
              <span style={{ fontSize: 12, color: "#4a4436" }}>Shown on your contests. You can change it later.</span>
              {err && <div role="alert" style={{ fontSize: 13, fontWeight: 800, color: "#9a2d1d" }}>{err}</div>}
              <button type="submit" className="btn" disabled={busy} style={{ background: "#111", color: "var(--lime)", border: 0 }}>{busy ? "Opening…" : "Start sponsoring"}</button>
            </form>
          )}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 10 }}>
          {GETS.map(([t, d]) => (
            <div key={t} style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 15 }}>{t}</b>
              <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{d}</span>
            </div>
          ))}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>How it works</h2>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
            {STEPS.map((s, i) => (
              <li key={s} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="display" aria-hidden="true" style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, background: "var(--lime)", color: "#111", border: "2px solid #111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 14, lineHeight: 1.5, paddingTop: 5 }}>{s}</span>
              </li>
            ))}
          </ol>
        </section>
        </div>
      </div>
      <BottomNav active="/sponsor" />
    </main>
  );
}
