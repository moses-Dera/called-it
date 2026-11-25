"use client";
import Link from "next/link";
import { useState } from "react";
import { BottomNav, TopBar } from "@/components/ui";
import { cloudReady, cloudRpc, signInWithGoogle, useCloud, useSponsorDashboard } from "@/lib/cloud";
import { SponsorDashboardView } from "@/components/sponsor-dashboard";

const GETS = [
  ["Your brand on the contest", "Your name, logo, colour and website on the contest page, the contest list and Home."],
  ["Fair by design", "Every entry is sealed before kickoff and timestamped on Bitcoin. You can check every winner yourself."],
  ["Prizes paid privately", "Winners are paid in shielded ZEC with a memo naming your contest."],
  ["Free for players", "Nobody pays to enter, so your contest reaches every football fan on Called It."],
  ["Run it yourself", "Once you're a sponsor, you create your contests, choose when they go public, pause them and watch entries live from your own dashboard."],
] as const;
const STEPS = [
  "Send the form below. Tell us your budget and which matches you want.",
  "We set up your sponsor account. You sign in with Google and get your own dashboard.",
  "You create your contest, pick the matches and prize split, and choose when it goes public.",
  "You fund the prize by scanning a payment QR in your dashboard. It is recorded against your contest only.",
  "Results settle automatically at full time, and winners are paid in shielded ZEC.",
];

export default function SponsorPage() {
  const signedIn = !!useCloud().session;
  const { data: dash, reload } = useSponsorDashboard();
  if (signedIn && dash) {
    return (
      <main className="screen wide hub">
        <div style={{ padding: "18px 20px 28px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <SponsorDashboardView data={dash} reload={reload} />
        </div>
        <BottomNav active="/sponsor" />
      </main>
    );
  }
  return <SponsorPitch signedIn={signedIn} />;
}

function SponsorPitch({ signedIn }: { signedIn: boolean }) {
  const [brand, setBrand] = useState(""), [contact, setContact] = useState(""), [budget, setBudget] = useState("");
  const [matches, setMatches] = useState(""), [message, setMessage] = useState("");
  const [state, setState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (brand.trim().length < 2) return setState({ error: "Add your brand or name." });
    if (contact.trim().length < 3) return setState({ error: "Add an email or Telegram handle so we can reply." });
    const zec = budget.trim() ? Number(budget) : null;
    if (zec !== null && !(zec > 0)) return setState({ error: "The budget should be a number of ZEC, like 2.5." });
    setState({ busy: true });
    try {
      await cloudRpc("submit_sponsor_request", { p_brand: brand, p_contact: contact, p_budget: zec, p_matches: matches, p_message: message });
      setState({ sent: true });
    } catch (err) { setState({ error: err instanceof Error ? err.message : "Could not send. Please try again." }); }
  }

  const field = { height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 16, fontWeight: 600, width: "100%", boxSizing: "border-box" } as const;
  return (
    <main className="screen wide hub">
      <TopBar eyebrow="For brands and communities" title="Sponsor a contest" />
      <div style={{ padding: "4px 20px 28px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#c9d3de" }}>Put up a ZEC prize pool on real football matches. Fans play free, and every result can be checked.</p>
        {!signedIn && cloudReady && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 14, padding: "10px 12px" }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Already a sponsor? Sign in to open your dashboard.</span>
            <button className="btn btn-quiet" onClick={signInWithGoogle} style={{ width: "auto", minHeight: 40, padding: "0 14px" }}>Sign in with Google</button>
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 10 }}>
          {GETS.map(([t, d]) => (
            <div key={t} style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 15 }}>{t}</b>
              <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{d}</span>
            </div>
          ))}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>How it works</h2>
          <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.5 }}>
            {STEPS.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </section>

        {state.sent ? (
          <section role="status" className="paper" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            <b className="display" style={{ fontSize: 22 }}>Request sent</b>
            <span style={{ fontSize: 14, color: "#4a4436" }}>Thanks, {brand.trim()}. We&apos;ll reach you at {contact.trim()} to set up your contest.</span>
            <Link href="/contests" className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }}>See current contests</Link>
          </section>
        ) : (
          <form onSubmit={submit} className="paper" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} noValidate>
            <h2 className="display" style={{ margin: 0, fontSize: 22, color: "#111" }}>Request a contest</h2>
            <label htmlFor="sp-brand" style={{ fontSize: 12, fontWeight: 800 }}>Brand or community name</label>
            <input id="sp-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} autoComplete="organization" style={field} />
            <label htmlFor="sp-contact" style={{ fontSize: 12, fontWeight: 800 }}>Email or Telegram handle</label>
            <input id="sp-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} autoComplete="email" style={field} />
            <label htmlFor="sp-budget" style={{ fontSize: 12, fontWeight: 800 }}>Prize budget in ZEC (optional)</label>
            <input id="sp-budget" value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="2.5" style={field} />
            <label htmlFor="sp-matches" style={{ fontSize: 12, fontWeight: 800 }}>Which matches or dates (optional)</label>
            <input id="sp-matches" value={matches} onChange={(e) => setMatches(e.target.value)} maxLength={300} placeholder="Champions League matchday, December" style={field} />
            <label htmlFor="sp-msg" style={{ fontSize: 12, fontWeight: 800 }}>Anything else (optional)</label>
            <textarea id="sp-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3} style={{ ...field, height: "auto", padding: "10px 12px", resize: "vertical" }} />
            {state.error && <div role="alert" style={{ fontSize: 13, fontWeight: 800, color: "#9a2d1d" }}>{state.error}</div>}
            <button type="submit" className="btn" disabled={state.busy || !cloudReady} style={{ background: "#111", color: "var(--lime)", border: 0 }}>{state.busy ? "Sending…" : "Send request"}</button>
          </form>
        )}
      </div>
      <BottomNav active="/sponsor" />
    </main>
  );
}
