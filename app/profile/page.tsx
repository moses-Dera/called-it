"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Img, TopBar } from "@/components/ui";
import { cloudReady, myTipsterProfile, saveTipsterProfile, signInWithGoogle, signOut, useCloud, usePlayerStats } from "@/lib/cloud";
import { isShielded, saveProfile, short, totals, useStore } from "@/lib/store";

export default function Profile() {
  const s = useStore();
  const t = totals(s);
  const cloud = useCloud();
  const user = cloud.session?.user;
  const stats = usePlayerStats();
  const streak = stats?.streak ?? 0;
  const [name, setName] = useState<string | null>(null), [addr, setAddr] = useState<string | null>(null), [msg, setMsg] = useState("");
  const nameV = name ?? s.profile.name, addrV = addr ?? s.profile.address;

  function save() {
    if (addrV.trim() && !isShielded(addrV)) return setMsg("That isn't a complete mainnet shielded address. Copy it again from your wallet: it starts with u1 or zs1.");
    saveProfile({ name: nameV.trim().slice(0, 24), address: addrV.trim() });
    setMsg("Saved.");
  }
  return (
    <main className="screen wide hub">
      <TopBar eyebrow="Profile" title={s.profile.name || "Your profile"} />
      <div className="profile-body" style={{ padding: "8px 20px 28px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
        <section style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Img n={`avatar_${s.profile.avatar}`} size={84} alt="Your avatar" style={{ borderRadius: 26, border: "3px solid var(--lime)" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, flex: 1 }}>
            {([["Ranked", t.ranked], ["Practice", t.points - t.ranked], ["Seals", s.seals.length], ["Streak", streak]] as const).map(([k, v]) => (
              <div key={k} style={{ background: k === "Streak" && streak >= 3 ? "rgba(255,107,53,.2)" : "var(--panel)", border: `2px solid ${k === "Streak" && streak >= 3 ? "#FF6B35" : "var(--line)"}`, borderRadius: 14, padding: "8px 6px", textAlign: "center" }}><div className="display" style={{ fontSize: 22 }}>{v}{k === "Streak" && streak >= 3 ? "🔥" : ""}</div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{k}</div></div>
            ))}
          </div>
        </section>

        {streak >= 3 && (
          <div style={{ background: "rgba(255,107,53,.12)", border: "2px solid #FF6B35", borderRadius: 14, padding: "8px 14px", fontSize: 13, fontWeight: 700, color: "#FF6B35" }}>
            Streak bonus active: {streak >= 14 ? "3x" : streak >= 7 ? "2x" : "1.5x"} multiplier on all scored points!
            {streak < 7 ? ` Reach 7 days for 2x.` : streak < 14 ? ` Reach 14 days for 3x.` : ""}
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: -6 }}>Ranked points are Classic Calls the server scored against the official result; only these count on Ranks. Practice points come from games against bots. Contest winners earn prizes. Your sealed moves follow your account to any device where you sign in.</div>

        <PlayerBadges />

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
          <label htmlFor="addr" style={{ fontSize: 12, fontWeight: 800, marginTop: 4 }}>Withdrawal wallet (Zcash address)</label>
          <input id="addr" value={addrV} onChange={(e) => setAddr(e.target.value)} placeholder="Paste your Zcash address" autoComplete="off" spellCheck={false} className="mono" style={{ height: 48, borderRadius: 14, border: "2px solid #111", background: "#fff", color: "#111", padding: "0 12px", fontSize: 13 }} />
          <div style={{ fontSize: 12, color: "#4a4436", lineHeight: 1.5 }}>Saved once, then every withdrawal goes here in one tap.{s.profile.address ? ` Current: ${short(s.profile.address)}` : ""}</div>
          <button className="btn" style={{ background: "#111", color: "var(--lime)", border: 0 }} onClick={save}>Save profile</button>
          {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700 }}>{msg}</div>}
        </section>

        {user && <TipsterSettings />}

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

const BADGE_DEFS: { key: string; label: string; desc: string; check: (s: Record<string, number>) => boolean; bg: string }[] = [
  { key: "first_seal", label: "First Seal", desc: "Sealed your first call", check: (s) => (s.total_seals ?? 0) >= 1, bg: "var(--sky)" },
  { key: "called_it", label: "Called It!", desc: "Got an exact score", check: (s) => (s.called_it ?? 0) >= 1, bg: "var(--lime)" },
  { key: "sniper", label: "Sniper", desc: "5 exact scores", check: (s) => (s.exact_scores ?? 0) >= 5, bg: "var(--amber)" },
  { key: "early_bird", label: "Early Bird", desc: "Sealed 24h+ before kickoff", check: (s) => (s.early_birds ?? 0) >= 1, bg: "#FFD84D" },
  { key: "ten_seals", label: "Regular", desc: "10 seals", check: (s) => (s.total_seals ?? 0) >= 10, bg: "var(--lilac)" },
  { key: "fifty_seals", label: "Veteran", desc: "50 seals", check: (s) => (s.total_seals ?? 0) >= 50, bg: "var(--pink)" },
  { key: "century", label: "Century", desc: "100+ ranked points", check: (s) => (s.total_ranked ?? 0) >= 100, bg: "#5AB8FF" },
  { key: "oracle", label: "Oracle", desc: "10 exact scores", check: (s) => (s.exact_scores ?? 0) >= 10, bg: "var(--red)" },
  { key: "streak_3", label: "On Fire", desc: "3-day streak (1.5x)", check: (s) => (s.streak ?? 0) >= 3, bg: "#FF6B35" },
  { key: "streak_7", label: "Iron Will", desc: "7-day streak (2x)", check: (s) => (s.streak ?? 0) >= 7, bg: "#E63946" },
  { key: "streak_14", label: "Unstoppable", desc: "14-day streak (3x)", check: (s) => (s.streak ?? 0) >= 14, bg: "#9B2335" },
  { key: "streak_30", label: "Month King", desc: "30-day streak", check: (s) => (s.streak ?? 0) >= 30, bg: "#FFD700" },
  { key: "hundred_seals", label: "Legend", desc: "100 seals", check: (s) => (s.total_seals ?? 0) >= 100, bg: "#C6F432" },
];

function TipsterSettings() {
  const [loaded, setLoaded] = useState(false);
  const [handle, setHandle] = useState(""), [bio, setBio] = useState(""), [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    myTipsterProfile().then((p) => {
      if (p) { setHandle(p.handle ?? ""); setBio(p.bio ?? ""); setIsPublic(p.public_record); }
      setLoaded(true);
    });
  }, []);

  async function save(nextPublic: boolean) {
    const h = handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(h)) return setMsg({ ok: false, text: "Pick a handle of 3 to 20 letters, numbers or underscores." });
    setBusy(true); setMsg(null);
    try {
      await saveTipsterProfile(h, bio.trim(), nextPublic);
      setHandle(h); setIsPublic(nextPublic);
      setMsg({ ok: true, text: nextPublic ? "Your record is public." : "Your record is private. It keeps its history, and your Classic Calls still cannot be deleted." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not save." }); }
    setBusy(false);
  }

  if (!loaded) return null;
  return (
    <section style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="display" style={{ fontSize: 18 }}>Public tipster record</span>
      <div style={{ fontSize: 13, color: "#c9d3de", lineHeight: 1.5 }}>Show your Classic Call record on a public page. Every call counts, one per match, settled by the server at full time. Your past and future calls are shown after full time, and calls on a public record can never be deleted.</div>
      <label htmlFor="handle" style={{ fontSize: 12, fontWeight: 800 }}>Handle</label>
      <input id="handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="yourname" maxLength={20} autoComplete="off" spellCheck={false} style={{ height: 48, borderRadius: 14, border: "2px solid var(--line)", background: "var(--ink)", color: "var(--text)", padding: "0 12px", fontSize: 16, fontWeight: 600 }} />
      <label htmlFor="bio" style={{ fontSize: 12, fontWeight: 800 }}>Short bio</label>
      <input id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Leagues you cover" maxLength={140} style={{ height: 48, borderRadius: 14, border: "2px solid var(--line)", background: "var(--ink)", color: "var(--text)", padding: "0 12px", fontSize: 15 }} />
      {isPublic ? (
        <>
          <Link href={`/tipster?h=${handle}`} className="btn" style={{ background: "var(--lime)", color: "#111" }}>View my public record</Link>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <button className="btn btn-quiet" disabled={busy} onClick={() => save(true)}>Save changes</button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => save(false)}>Make private</button>
          </div>
        </>
      ) : (
        <button className="btn" disabled={busy} style={{ background: "var(--lime)", color: "#111" }} onClick={() => save(true)}>Make my record public</button>
      )}
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 700, color: msg.ok ? "var(--lime)" : "var(--red)" }}>{msg.text}</div>}
    </section>
  );
}

function PlayerBadges() {
  const stats = usePlayerStats();
  if (!stats) return null;
  const earned = BADGE_DEFS.filter((b) => b.check(stats));
  if (earned.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="eyebrow" style={{ color: "var(--muted)" }}>Badges ({earned.length}/{BADGE_DEFS.length})</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
        {BADGE_DEFS.map((b) => {
          const on = earned.includes(b);
          return (
            <div key={b.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 6px", borderRadius: 14, background: on ? b.bg : "var(--panel)", border: `2px solid ${on ? "#111" : "var(--line)"}`, opacity: on ? 1 : 0.4, textAlign: "center" }}>
              <span style={{ fontSize: 20 }}>{on ? "★" : "☆"}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: on ? "#111" : "var(--muted)" }}>{b.label}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: on ? "#4a4436" : "var(--muted)" }}>{b.desc}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
