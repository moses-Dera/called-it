"use client";
import Link from "next/link";
import { openShare } from "./share-sheet";
import { useEffect, useState } from "react";
import { BottomNav, Img } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { contestGame, inkOn, phaseOf } from "@/lib/data";
import { showNotice } from "@/components/dialog";
import { art } from "@/lib/data";
import { autoRevealAtKickoff, joinContest, leaveContest, useCloud, useContestBoard, useAllContests, useContestEntryCount, useFixtures, useLiveContestBoard, useLiveFixtureCalls, useMyContestIds, useNetwork, useSponsorRecords, refreshContests } from "@/lib/cloud";
import { isShielded, useStore } from "@/lib/store";
import { hasWallet } from "@/lib/wallet-sync";
import { explorerTx } from "@/lib/explorer";
import { SponsorRecordLine, WinnerPayState } from "@/components/sponsor-record";
import { ContestPlay } from "@/components/contest-play";

const STRUCTURE_LABEL: Record<string, string> = { top3: "Top 3 share: 50 / 30 / 20", top5: "Top 5 share: 40 / 25 / 15 / 10 / 10", top10: "Top 10 share the pot", top20: "Top 20 share the pot", custom: "Prize split set by the sponsor", equal_split: "Top winners share equally", all_correct: "Split among all exact scores", random_draw: "One lucky winner takes all" };

export function ContestView({ id }: { id: string }) {
  const [now, setNow] = useState<number | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setRef(q.get("ref")); setNow(Date.now());
    // Old ?c= links redirect here with the query still attached; tidy the address bar.
    if (q.has("c")) { q.delete("c"); history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "")); }
  }, []);
  const contests = useAllContests(), fixtures = useFixtures();
  const session = useCloud().session;
  const signedIn = !!session;
  const c = contests.find((x) => x.id === id);
  const { rows: board, loadMore: boardMore, hasMore: boardHasMore, loading: boardLoading } = useContestBoard(c ? c.id : null);
  const entryCount = useContestEntryCount(c ? c.id : null);
  const records = useSponsorRecords();
  const myAddress = useStore().profile.address, network = useNetwork();
  const canJoin = !!c && !c.paused && !c.hidden && !(c.opens_at && now && Date.parse(c.opens_at) > now) && !(c.entry_deadline && now && Date.parse(c.entry_deadline) < now);
  const myIds = useMyContestIds();
  const joined = c ? myIds.includes(c.id) : false;
  const list = c ? fixtures.filter((f) => c.fixture_ids.includes(f.id)) : [];
  const [joining, setJoining] = useState(false);
  const [openCallsFid, setOpenCallsFid] = useState<string | null>(null);
  const hasKickedOff = !!c && c.game === "football" && now !== null && list.some((f) => Date.parse(f.kickoff) <= now);
  const liveBoard = useLiveContestBoard(c ? c.id : null, !!c && c.status === "open" && hasKickedOff);

  useEffect(() => {
    if (hasKickedOff && signedIn) autoRevealAtKickoff();
  }, [hasKickedOff, signedIn]);

  async function handleJoin() {
    if (!c || joining) return;
    setJoining(true);
    try {
      if (joined) { await leaveContest(c.id); } else { await joinContest(c.id, ref ?? undefined); }
      location.reload();
    } catch (e) { showNotice({ title: "Couldn't update your entry", body: e instanceof Error ? e.message : "Please try again." }); }
    setJoining(false);
  }

  function share() {
    if (!c) return;
    const uid = session?.user.id;
    const url = new URL(location.href);
    if (uid) url.searchParams.set("ref", uid);
    const text = `Join "${c.title}" on Called It — ${c.prize_zec > 0 ? c.prize_zec + " ZEC prize pool. " : ""}Free to play.`;
    openShare({ title: "Share this contest", text, url: url.toString() });
  }

  const accent = c?.sponsor_color || "var(--amber)";

  // A finished contest settles the moment someone looks at it, instead of waiting for the next scheduled run.
  const finished = !!c && c.status === "open" && now !== null && (c.game && c.game !== "football"
    ? !!c.ends_at && Date.parse(c.ends_at) <= now
    : c.fixture_ids.length > 0 && c.fixture_ids.every((fid) => fixtures.some((f) => f.id === fid && f.homeGoals != null)));
  useEffect(() => {
    if (!finished || !c) return;
    fetch(`/api/settle?c=${c.id}`, { method: "POST" }).then(() => refreshContests()).catch(() => {});
  }, [finished, c?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <main className="screen wide hub hub-pad">
      <Link href="/contests" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)", alignSelf: "flex-start" }}>← Contests</Link>
      {!c ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "24px 0" }}>
          <h1 className="display page-h1" style={{ margin: 0, fontSize: 34 }}>Contest</h1>
          <p style={{ color: "var(--muted)" }}>{contests.length ? "This contest was not found." : "Loading…"} <Link href="/contests" style={{ color: "var(--lime)", fontWeight: 800 }}>Browse contests</Link></p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 20, alignItems: "start", paddingBottom: 24 }}>
          <section style={{ background: accent, color: inkOn(c.sponsor_color) === "#111" || !c.sponsor_color ? "#111" : "var(--paper)", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", borderRadius: 26, padding: 20, paddingRight: c.sponsor_logo ? 104 : 20, display: "flex", flexDirection: "column", gap: 10, position: "relative", overflow: "hidden" }}>
            {c.sponsor_logo && <img src={c.sponsor_logo} alt={c.sponsor || ""} style={{ position: "absolute", right: 16, top: 16, height: 32, maxWidth: 80, objectFit: "contain", opacity: 0.85 }} />}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="eyebrow">{c.status === "open" ? "Open contest" : "Finished"}</span>
              {c.sponsor && <span style={{ fontSize: 12, fontWeight: 700 }}>by {c.sponsor}</span>}
            </div>
            <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{c.title}</h1>
            {c.description && <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{c.description}</p>}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="display" style={{ fontSize: 44 }}>{c.prize_zec}</span><b>ZEC prize pot</b>
              </div>
              
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.5 }}>
              {c.prize_structure === "custom" && c.custom_shares?.length === 1 ? "Winner takes all" : STRUCTURE_LABEL[c.prize_structure] || STRUCTURE_LABEL.top3}. Free to play. {c.game && c.game !== "football" ? `Join, then play ${contestGame(c.game).name} against other players.` : "Seal before each kickoff while signed in."}
            </div>
            {entryCount !== null && <div style={{ fontSize: 13, fontWeight: 800 }}>{entryCount} player{entryCount === 1 ? "" : "s"} entered</div>}
            {c.owner_id && c.prize_zec > 0 && <SponsorRecordLine record={records[c.owner_id]} sponsor={c.sponsor} />}
            {now && c.opens_at && Date.parse(c.opens_at) > now && <div role="timer" style={{ fontSize: 13, fontWeight: 800 }}>Opens {new Date(c.opens_at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Only you can see it until then.</div>}
            {c.paused && c.status === "open" && <div style={{ fontSize: 13, fontWeight: 800 }}>Joining is paused by the sponsor. Players already in keep playing.</div>}
            {c.hidden && <div style={{ fontSize: 13, fontWeight: 800 }}>Hidden by Called It. Only you can see this page.</div>}
            {c.entry_deadline && now && (
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
                Entry deadline: {new Date(c.entry_deadline).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {Date.parse(c.entry_deadline) < now && " (passed)"}
              </div>
            )}
            {c.status === "open" && signedIn && (joined || canJoin) && (
              <button onClick={handleJoin} disabled={joining} style={{ minHeight: 48, borderRadius: 14, border: "2px solid #111", background: joined ? "transparent" : "#111", color: joined ? "#111" : accent, fontWeight: 800, fontSize: 15 }}>
                {joining ? "…" : joined ? "Leave contest" : "Join contest"}
              </button>
            )}
            {joined && c.prize_zec > 0 && !isShielded(myAddress, network) && !hasWallet(network) && (
              <Link href="/profile" style={{ fontSize: 13, fontWeight: 800, textDecoration: "underline" }}>Add your Zcash wallet address in Profile so you can be paid if you win →</Link>
            )}
            {c.status === "open" && !signedIn && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700 }}>
                <span>Sign in to join.</span><SignInPill />
              </div>
            )}
            {c.winners && c.winners.length > 0 && (
              <div style={{ background: "#111", color: "var(--paper)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="eyebrow" style={{ color: "var(--lime)" }}>Winners</span>
                {c.winners.map((w) => <div key={w.rank} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>#{w.rank} {w.name}</span><b>{w.points} pts · {w.zec} ZEC{c.owner_id && w.zec > 0 ? <WinnerPayState status={w.status} payBy={c.pay_by} now={now} /> : null}{w.txid && /^[0-9a-f]{64}$/.test(w.txid) ? <> · <a href={explorerTx(w.txid, network)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>payment ↗</a></> : null}</b></div>)}
              </div>
            )}
            {c.sponsor_url && <a href={c.sponsor_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, textDecoration: "underline" }}>About {c.sponsor || "the sponsor"}</a>}
          </section>

          {c.game && c.game !== "football" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ContestPlay c={c} joined={joined} now={now} />
            <button onClick={share} style={{ minHeight: 42, borderRadius: 14, border: "2px solid var(--line)", background: "var(--panel)", color: "var(--text)", fontWeight: 800, fontSize: 14, marginTop: 4 }}>
              Share this contest
            </button>
          </section>
          ) : (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Fixtures</h2>
              {hasKickedOff && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Calls unlock at kickoff</span>}
            </div>
            {list.map((f) => {
              const open = now !== null && Date.parse(f.kickoff) > now;
              const isLive = now !== null && phaseOf(f, now) === "live";
              const callsOpen = openCallsFid === f.id;
              const chipText = f.homeGoals != null ? `FT ${f.homeGoals}–${f.awayGoals}` : isLive ? `LIVE ${f.liveHome ?? 0}–${f.liveAway ?? 0}` : open ? "SEAL" : "AWAITING RESULT";
              const chipBg = f.homeGoals != null ? "var(--lime)" : isLive ? "var(--red)" : open ? "var(--sky)" : "var(--amber)";
              const inner = (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4436" }}>{f.league ? `${f.league} · ` : ""}Kickoff {f.when}</div>
                  </div>
                  <span className="chip" style={{ background: chipBg, flexShrink: 0 }}>{chipText}</span>
                </>
              );
              const cardStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, background: "var(--paper)", color: "#111", borderRadius: 16, padding: "10px 14px", opacity: open || isLive || f.homeGoals != null ? 1 : 0.85 };
              return open ? (
                <Link key={f.id} href={`/seal?f=${f.id}`} style={cardStyle}>{inner}</Link>
              ) : (
                <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={cardStyle}>
                    {inner}
                    <button type="button" onClick={() => setOpenCallsFid(callsOpen ? null : f.id)} style={{ minHeight: 34, padding: "0 10px", borderRadius: 10, border: "2px solid #111", background: callsOpen ? "#111" : "#fff", color: callsOpen ? "var(--lime)" : "#111", fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
                      {callsOpen ? "Hide" : "Calls"}
                    </button>
                  </div>
                  {callsOpen && <FixtureCallsPanel fixtureId={f.id} contestId={c.id} />}
                </div>
              );
            })}
            <button onClick={share} style={{ minHeight: 42, borderRadius: 14, border: "2px solid var(--line)", background: "var(--panel)", color: "var(--text)", fontWeight: 800, fontSize: 14, marginTop: 4 }}>
              Share this contest
            </button>
          </section>
          )}

          <section style={{ background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 26, padding: "14px 20px", display: "flex", flexDirection: "column", gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "4px 0 6px" }}>
              <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Contest leaderboard</h2>
              {liveBoard && liveBoard.some((r) => r.live_points > 0) && (
                <span className="chip" style={{ background: "var(--red)", color: "#111", border: "2px solid #111" }}>LIVE STANDINGS</span>
              )}
            </div>
            {(() => {
              const showLive = !!liveBoard && liveBoard.length > 0 && c.status === "open";
              const shownRows = showLive ? liveBoard : board;
              if (shownRows === null) return <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436" }}>Loading…</div>;
              if (shownRows.length === 0) return <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436", lineHeight: 1.5 }}>{c.game && c.game !== "football" ? "No wins yet. Start a game above." : <>No points yet. Predictions unlock at kickoff and update live as goals arrive.</>}</div>;
              return shownRows.map((r) => {
                const livePts = "live_points" in r ? r.live_points : 0;
                return (
                  <div key={r.rank + r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "2px dashed #d8cfb8", background: r.me ? "rgba(198,244,50,.35)" : "transparent" }}>
                    <span className="display" style={{ width: 26, fontSize: 20 }}>{r.rank}</span>
                    <img src={art(`avatar_${r.avatar}`)} alt="" width={36} height={36} style={{ borderRadius: 12, border: "2px solid #111" }} />
                    <b style={{ flex: 1, fontSize: 14 }}>{r.name}{r.me ? " (you)" : ""}</b>
                    {livePts > 0 && <span className="chip" style={{ background: "var(--amber)", border: "1.5px solid #111", fontSize: 11 }}>+{livePts} live</span>}
                    <span className="display" style={{ fontSize: 20 }}>{r.points}</span>
                  </div>
                );
              });
            })()}
            {boardHasMore && (
              <button onClick={boardMore} disabled={boardLoading} style={{ margin: "8px 0", padding: "8px", borderRadius: 12, border: "2px solid #111", background: "var(--lime)", color: "#111", fontWeight: 800, fontSize: 13 }}>
                {boardLoading ? "Loading…" : "Load more"}
              </button>
            )}
            {!signedIn && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", fontSize: 13, fontWeight: 700, color: "#4a4436" }}><span style={{ flex: 1 }}>Sign in to enter.</span><SignInPill /></div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 16px" }}><Img n="seal" size={32} /><span style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>{c.game && c.game !== "football" ? "Every move is sealed before anyone reveals, so nobody can change it after seeing yours." : "Every call is sealed and stamped before kickoff — nobody can change their answer."}</span></div>
          </section>
        </div>
      )}
      <BottomNav active="/contests" />
    </main>
  );
}

function FixtureCallsPanel({ fixtureId, contestId }: { fixtureId: string; contestId: string }) {
  const calls = useLiveFixtureCalls(fixtureId, contestId);
  return (
    <div style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      {calls === null && <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading locked calls…</span>}
      {calls?.length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Players&apos; locked predictions appear here once their devices sync after kickoff.</span>}
      {calls?.map((x, i) => (
        <div key={x.name + i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text)" }}>
          <img src={art(`avatar_${x.avatar}`)} alt="" width={24} height={24} style={{ borderRadius: 7, border: "1.5px solid #111" }} />
          <span style={{ flex: 1, fontWeight: 700 }}>{x.name}{x.me ? " (you)" : ""}</span>
          {x.banker && <span className="chip" style={{ background: "var(--amber)", color: "#111", border: 0, fontSize: 10 }}>⚡ 2X</span>}
          {x.early && <span className="chip" style={{ background: "var(--sky)", color: "#111", border: 0, fontSize: 10 }}>EARLY</span>}
          <b className="display" style={{ fontSize: 16 }}>{x.home_goals}–{x.away_goals}</b>
          <span style={{ fontSize: 12, fontWeight: 800, color: x.live_points > 0 ? "var(--lime)" : "var(--muted)", minWidth: 44, textAlign: "right" }}>+{x.live_points}</span>
        </div>
      ))}
    </div>
  );
}
