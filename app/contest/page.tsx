"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { art } from "@/lib/data";
import { joinContest, leaveContest, useCloud, useContestBoard, useContestEntryCount, useContests, useFixtures, useMyContestIds } from "@/lib/cloud";

const STRUCTURE_LABEL: Record<string, string> = { top3: "Top 3 share: 50 / 30 / 20", top10: "Top 10 share the pot", all_correct: "Split among all exact scores", random_draw: "One lucky winner takes all" };

export default function ContestPage() {
  const [id, setId] = useState<string | null>(null), [now, setNow] = useState<number | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => { const p = new URLSearchParams(location.search); setId(p.get("c")); setRef(p.get("ref")); setNow(Date.now()); }, []);
  const contests = useContests(), fixtures = useFixtures();
  const session = useCloud().session;
  const signedIn = !!session;
  const c = contests.find((x) => x.id === id);
  const board = useContestBoard(c ? c.id : null);
  const entryCount = useContestEntryCount(c ? c.id : null);
  const myIds = useMyContestIds();
  const joined = c ? myIds.includes(c.id) : false;
  const list = c ? fixtures.filter((f) => c.fixture_ids.includes(f.id)) : [];
  const [joining, setJoining] = useState(false);
  const [shareMsg, setShareMsg] = useState("");

  async function handleJoin() {
    if (!c || joining) return;
    setJoining(true);
    try {
      if (joined) { await leaveContest(c.id); } else { await joinContest(c.id, ref ?? undefined); }
      location.reload();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    setJoining(false);
  }

  function share() {
    if (!c) return;
    const uid = session?.user.id;
    const url = new URL(location.href);
    if (uid) url.searchParams.set("ref", uid);
    const text = `Join "${c.title}" on Called It — ${c.prize_zec > 0 ? c.prize_zec + " ZEC prize pool. " : ""}Free to play.`;
    if (navigator.share) { navigator.share({ title: c.title, text, url: url.toString() }).catch(() => {}); }
    else { navigator.clipboard?.writeText(url.toString()); setShareMsg("Link copied!"); setTimeout(() => setShareMsg(""), 2000); }
  }

  const accent = c?.sponsor_color || "var(--amber)";

  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      {!c ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "40px 0" }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Contest</h1>
          <p style={{ color: "var(--muted)" }}>{contests.length ? "This contest was not found." : "Loading…"} <Link href="/contests" style={{ color: "var(--lime)", fontWeight: 800 }}>Browse contests</Link></p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, alignItems: "start", paddingBottom: 24 }}>
          <section style={{ background: accent, color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", borderRadius: 26, padding: 20, display: "flex", flexDirection: "column", gap: 10, position: "relative", overflow: "hidden" }}>
            {c.sponsor_logo && <img src={c.sponsor_logo} alt={c.sponsor || ""} style={{ position: "absolute", right: 16, top: 16, height: 32, opacity: 0.8 }} />}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="eyebrow">{c.status === "open" ? "Open contest" : "Finished"}</span>
              {c.sponsor && <span style={{ fontSize: 12, fontWeight: 700 }}>by {c.sponsor}</span>}
            </div>
            <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{c.title}</h1>
            {c.description && <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{c.description}</p>}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="display" style={{ fontSize: 44 }}>{c.prize_zec}</span><b>ZEC prize pot</b>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>
              {STRUCTURE_LABEL[c.prize_structure] || STRUCTURE_LABEL.top3}. Free to play. Seal before each kickoff while signed in.
            </div>
            {entryCount !== null && <div style={{ fontSize: 13, fontWeight: 800 }}>{entryCount} player{entryCount === 1 ? "" : "s"} entered</div>}
            {c.entry_deadline && now && (
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                Entry deadline: {new Date(c.entry_deadline).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {Date.parse(c.entry_deadline) < now && " (passed)"}
              </div>
            )}
            {c.status === "open" && signedIn && (
              <button onClick={handleJoin} disabled={joining} style={{ minHeight: 48, borderRadius: 14, border: "2px solid #111", background: joined ? "transparent" : "#111", color: joined ? "#111" : accent, fontWeight: 800, fontSize: 15 }}>
                {joining ? "…" : joined ? "Leave contest" : "Join contest"}
              </button>
            )}
            {c.status === "open" && !signedIn && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700 }}>
                <span>Sign in to join.</span><SignInPill />
              </div>
            )}
            {c.winners && c.winners.length > 0 && (
              <div style={{ background: "#111", color: "var(--paper)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="eyebrow" style={{ color: "var(--lime)" }}>Winners</span>
                {c.winners.map((w) => <div key={w.rank} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>#{w.rank} {w.name}</span><b>{w.points} pts · {w.zec} ZEC</b></div>)}
              </div>
            )}
            {c.sponsor_url && <a href={c.sponsor_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, textDecoration: "underline" }}>About {c.sponsor || "the sponsor"}</a>}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Fixtures</h2>
            {list.map((f) => {
              const open = now !== null && Date.parse(f.kickoff) > now;
              return (
                <Link key={f.id} href={open ? `/seal?f=${f.id}` : "#"} aria-disabled={!open} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--paper)", color: "#111", borderRadius: 16, padding: "10px 14px", opacity: open ? 1 : 0.75 }}>
                  <div style={{ flex: 1 }}>
                    <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>Kickoff {f.when}</div>
                  </div>
                  <span className="chip" style={{ background: f.homeGoals != null ? "var(--lime)" : open ? "var(--sky)" : "var(--amber)" }}>{f.homeGoals != null ? `FT ${f.homeGoals}–${f.awayGoals}` : open ? "SEAL" : "AWAITING RESULT"}</span>
                </Link>
              );
            })}
            <button onClick={share} style={{ minHeight: 42, borderRadius: 14, border: "2px solid var(--line)", background: "var(--panel)", color: "var(--text)", fontWeight: 800, fontSize: 14, marginTop: 4 }}>
              {shareMsg || "Share this contest"}
            </button>
          </section>

          <section style={{ background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 26, padding: "14px 20px", display: "flex", flexDirection: "column", gridColumn: "1 / -1" }}>
            <h2 className="display" style={{ margin: "4px 0 6px", fontSize: 22 }}>Contest leaderboard</h2>
            {board === null && <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436" }}>Loading…</div>}
            {board?.length === 0 && <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436", lineHeight: 1.5 }}>No ranked points yet. They arrive as each fixture's result is entered.</div>}
            {board?.map((r) => (
              <div key={r.rank + r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "2px dashed #d8cfb8", background: r.me ? "rgba(198,244,50,.35)" : "transparent" }}>
                <span className="display" style={{ width: 26, fontSize: 20 }}>{r.rank}</span>
                <img src={art(`avatar_${r.avatar}`)} alt="" width={36} height={36} style={{ borderRadius: 12, border: "2px solid #111" }} />
                <b style={{ flex: 1, fontSize: 14 }}>{r.name}{r.me ? " (you)" : ""}</b>
                <span className="display" style={{ fontSize: 20 }}>{r.points}</span>
              </div>
            ))}
            {!signedIn && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", fontSize: 13, fontWeight: 700, color: "#4a4436" }}><span style={{ flex: 1 }}>Sign in to enter.</span><SignInPill /></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 16px" }}><Img n="seal" size={32} /><span style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>Every call is sealed and stamped before kickoff — nobody can change their answer.</span></div>
          </section>
        </div>
      )}
      <BottomNav active="/" />
    </main>
  );
}
