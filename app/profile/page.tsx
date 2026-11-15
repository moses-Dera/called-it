"use client";
import { useState } from "react";
import { Img, TopBar } from "@/components/ui";
import { cloudReady, signInWithGoogle, signOut, useCloud } from "@/lib/cloud";
import { isShielded, saveProfile, short, totals, useStore } from "@/lib/store";

export default function Profile() {
  const s = useStore();
  const t = totals(s);
  const cloud = useCloud();
  const user = cloud.session?.user;
  const [name, setName] = useState<string | null>(null), [addr, setAddr] = useState<string | null>(null), [msg, setMsg] = useState("");
  const nameV = name ?? s.profile.name, addrV = addr ?? s.profile.address;

  function save() {
    if (addrV.trim() && !isShielded(addrV)) return setMsg("That doesn't look like a shielded address. It should start with u1 (or utest1 on testnet).");
    saveProfile({ name: nameV.trim().slice(0, 24), address: addrV.trim() });
    setMsg("Saved.");
  }
  return (
    <main className="screen wide hub">
      <TopBar eyebrow="Profile" title={s.profile.name || "Your profile"} />
      <div className="profile-body" style={{ padding: "8px 20px 28px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
        <section style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Img n={`avatar_${s.profile.avatar}`} size={84} alt="Your avatar" style={{ borderRadius: 26, border: "3px solid var(--lime)" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, flex: 1 }}>
            {[["Ranked", t.ranked], ["Practice", t.points - t.ranked], ["Seals", s.seals.length]].map(([k, v]) => (
              <div key={k} style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 14, padding: "8px 6px", textAlign: "center" }}><div className="display" style={{ fontSize: 22 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{k}</div></div>
            ))}
          </div>
        </section>

        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: -6 }}>Ranked points are Classic Calls the server scored against the official result; only these count on Ranks. Practice points come from games against bots. ZEC prizes come from contests. Your sealed moves follow your account to any device where you sign in.</div>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="eyebrow" style={{ color: "var(--muted)" }}>Pick your avatar</span>
          <div className="avatars" style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 6 }}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
              <button key={n} aria-label={`Avatar ${n}`} aria-pressed={s.profile.avatar === n} onClick={() => saveProfile({ avatar: n })} style={{ padding: 0, background: "transparent", border: 0, minHeight: 44 }}>
                <Img n={`avatar_${n}`} size={40} style={{ width: "100%", height: "auto", aspectRatio: "1", borderRadius: 12, border: `3px solid ${s.profile.avatar === n ? "var(--lime)" : "transparent"}` }} />
              </button>
            ))}
          </div>
        </section>

        <section className="paper p-form" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="name" style={{ fontSize: 12, fontWeight: 800 }}>Display name</label>
          <input id="name" value={nameV} onChange={(e) => setName(e.target.value)} placeholder="What friends see" maxLength={24} autoComplete="nickname" style={{ height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 16, fontWeight: 600 }} />
          <label htmlFor="addr" style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>Withdrawal wallet (shielded Zcash address)</label>
          <input id="addr" value={addrV} onChange={(e) => setAddr(e.target.value)} placeholder="utest1… (testnet address from Zodl or Zingo)" autoComplete="off" spellCheck={false} className="mono" style={{ height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 13 }} />
          <div style={{ fontSize: 12, color: "#4a4436", lineHeight: 1.5 }}>Saved once, then every withdrawal goes here in one tap.{s.profile.address ? ` Current: ${short(s.profile.address)}` : ""}</div>
          <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} onClick={save}>Save profile</button>
          {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700 }}>{msg}</div>}
        </section>

        <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="display" style={{ fontSize: 18 }}>Account</span>
          {user ? (
            <>
              <div style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>Signed in as <b style={{ color: "var(--text)" }}>{user.email}</b>. Your profile, points and seal proofs are backed up, and your sealed moves follow you to any device where you sign in. Other players can never see them before the reveal.</div>
              <div role="status" style={{ fontSize: 12, fontWeight: 700, color: cloud.status === "error" ? "var(--red)" : "var(--lime)" }}>{cloud.status === "error" ? "Sync problem: " + cloud.error : cloud.status === "syncing" ? "Syncing…" : "Backed up"}</div>
              <button className="btn btn-quiet" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>You&apos;re playing as a guest. Your seals, points and profile are stored on this device only.</div>
              <button className="btn btn-paper" disabled={!cloudReady} style={{ opacity: cloudReady ? 1 : 0.6 }} onClick={signInWithGoogle}>{cloudReady ? "Sign in with Google" : "Sign in with Google (not connected yet)"}</button>
              {cloud.status === "error" && <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>{cloud.error}</div>}
            </>
          )}
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>player id {s.player}</div>
        </section>
      </div>
    </main>
  );
}
