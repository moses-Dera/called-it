"use client";
import Link from "next/link";
import { useState } from "react";
import { Chips } from "./chips";
import { OTHER_LEAGUE } from "@/lib/leagues";
import { ErrorBoundary, Img, TeamBadge } from "./ui";
import { refreshFixtures, useContests, useFixtures, useFixturesState, useFixtureSealCounts, useMyContestIds, useNow } from "@/lib/cloud";
import { contestGame, phaseOf, type Fixture } from "@/lib/data";

/* ── Fixture grid: only upcoming (not kicked off yet) ── */
export function HomeFixtures() {
  return <ErrorBoundary><HomeFixturesInner /></ErrorBoundary>;
}

const GREEN = "linear-gradient(135deg, #1e7a47 0%, #145a34 100%)";

function Featured({ f, kind, sealed }: { f: Fixture; kind: "live" | "next" | "result"; sealed: number }) {
  const href = kind === "next" ? `/seal?f=${f.id}` : "/play/arena";
  const score = f.homeGoals != null ? `${f.homeGoals}–${f.awayGoals}` : kind === "live" && f.liveHome != null ? `${f.liveHome}–${f.liveAway}` : "vs";
  const chip = kind === "live" ? "LIVE" : kind === "next" ? `Next up · ${f.when}` : "FULL TIME";
  const chipBg = kind === "live" ? "var(--red)" : kind === "next" ? "var(--lime)" : "var(--amber)";
  const cta = kind === "next" ? ["Seal your prediction", "Seal →"] : kind === "live" ? ["Quick calls are open", "Enter →"] : ["See how it played out", "→"];
  return (
    <Link href={href} className="featured" style={{ display: "flex", flexDirection: "column", gap: 12, color: "#fff", borderRadius: 22, background: GREEN, border: "3px solid #111", boxShadow: "4px 4px 0 var(--lime)", padding: "16px 18px" }}>
      <span className="chip" style={{ background: chipBg, color: "#111", border: 0, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6 }}>
        {kind === "live" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "sealPulse 1s infinite" }} />}
        {chip}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <TeamBadge name={f.home} size={52} side="home" />
          <b style={{ fontSize: 14, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.home}</b>
        </div>
        <span className="display" style={{ fontSize: score !== "vs" ? 44 : 30 }}>{score}</span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <TeamBadge name={f.away} size={52} side="away" />
          <b style={{ fontSize: 14, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.away}</b>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 14px", fontSize: 14, fontWeight: 700 }}>
        <span>{cta[0]}{sealed > 0 ? ` · ${sealed} sealed` : ""}</span>
        <span style={{ color: "var(--lime)" }}>{cta[1]}</span>
      </div>
    </Link>
  );
}

function HomeFixturesInner() {
  const fixtures = useFixtures();
  const state = useFixturesState();
  const now = useNow();
  const sealCounts = useFixtureSealCounts();
  const [league, setLeague] = useState<string>("all"), [showAll, setShowAll] = useState(false);

  if (state === "error" || state === "offline") {
    return (
      <section className="home-fixtures" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", background: "var(--panel)", border: `2px solid ${state === "offline" ? "var(--amber)" : "var(--line)"}`, borderRadius: 22, padding: 18 }}>
        <div className="display" style={{ fontSize: 20 }}>{state === "offline" ? "Offline, retrying…" : "Couldn\u2019t load fixtures"}</div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{state === "offline" ? "Waiting for your connection to come back." : "Check your connection and try again."}</div>
        <button className="btn" style={{ width: "auto", padding: "0 18px" }} onClick={() => refreshFixtures()}>Try again</button>
      </section>
    );
  }
  if (state === "loading" || now == null) {
    return (
      <section className="home-fixtures" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ height: 210, borderRadius: 22, background: GREEN, border: "3px solid #111", opacity: 0.6 }} />
        {[0, 1, 2].map((i) => <div key={i} style={{ height: 64, borderRadius: 16, background: "var(--paper)", opacity: 0.15 }} />)}
      </section>
    );
  }

  const byKickoff = (a: Fixture, b: Fixture) => Date.parse(a.kickoff) - Date.parse(b.kickoff);
  const live = fixtures.filter((f) => phaseOf(f, now) === "live").sort(byKickoff)[0];
  const open = fixtures.filter((f) => phaseOf(f, now) === "upcoming").sort(byKickoff);
  const recent = fixtures.filter((f) => phaseOf(f, now) === "final").sort((a, b) => byKickoff(b, a))[0];
  const featured = live ?? open[0] ?? recent;
  const kind = live ? "live" : open[0] ? "next" : "result";
  const leagues = [...new Set(open.map((f) => f.league || OTHER_LEAGUE))]
    .sort((a, b) => (a === OTHER_LEAGUE ? 1 : 0) - (b === OTHER_LEAGUE ? 1 : 0) || open.filter((f) => (f.league || OTHER_LEAGUE) === b).length - open.filter((f) => (f.league || OTHER_LEAGUE) === a).length);
  const shown = league && leagues.includes(league) ? league : "all";
  const inLeague = shown === "all" ? open : open.filter((f) => (f.league || OTHER_LEAGUE) === shown);
  const list = inLeague.filter((f) => f !== featured).slice(0, showAll ? 60 : 3);

  return (
    <section className="home-fixtures" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {featured && <Featured f={featured} kind={kind} sealed={sealCounts[featured.id] ?? 0} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Next matches</h2>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{inLeague.length} open</span>
      </div>
      {showAll && leagues.length > 1 && (
        <div className="chip-scroll">
          <div style={{ width: "max-content" }}><Chips label="League" value={shown} onChange={(v) => { setLeague(v); setShowAll(false); }} options={[["all", "All leagues"], ...leagues.map((l) => [l, l] as const)]} /></div>
        </div>
      )}
      {open.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No fixtures open right now. New ones appear here.</div>}
      <div className="fixture-grid">{list.map((f) => (
        <Link key={f.id} href={`/seal?f=${f.id}`} style={{ display: "flex", alignItems: "stretch", color: "#111", background: "var(--paper)", borderRadius: 16, overflow: "hidden", minHeight: 64 }}>
          <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderRight: "2px dashed #c9bfa6", minWidth: 0 }}>
            <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
            <div style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>{shown === "all" && f.league ? `${f.league} · ` : ""}Kickoff {f.when}{sealCounts[f.id] > 0 ? ` · ${sealCounts[f.id]} sealed` : ""}</div>
          </div>
          <div style={{ width: 78, background: "var(--lime)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 12, fontWeight: 800 }}><Img n="seal" size={30} />SEAL</div>
        </Link>
      ))}</div>
      {!showAll && open.length > 4 && (
        <button className="btn btn-quiet" onClick={() => setShowAll(true)} style={{ minHeight: 42 }}>See all {open.length} matches by league</button>
      )}
    </section>
  );
}

/* ── Feed: play with friends, contests, discovery ── */
export function HomeFeed() {
  return <ErrorBoundary><HomeFeedInner /></ErrorBoundary>;
}

function HomeFeedInner() {
  const contests = useContests().filter((c) => c.status === "open");
  const myIds = useMyContestIds();

  return (
    <div className="home-feed" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Contests</h2>
          <Link href="/contests" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)" }}>View all</Link>
        </div>
        {contests.length === 0 && (
          <Link href="/contests" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--amber)", color: "#111", border: "3px solid #111", borderRadius: 16, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
            <Img n="cover_closest" size={40} style={{ borderRadius: 12, border: "2px solid #111" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="display" style={{ fontSize: 17 }}>Win ZEC prizes</div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Free to play. Predict scores, climb the leaderboard, claim real prizes.</div>
            </div>
            <span style={{ fontWeight: 800, fontSize: 18 }}>→</span>
          </Link>
        )}
        {contests.slice(0, 2).map((c) => {
          const joined = myIds.includes(c.id);
          return (
            <Link key={c.id} href={`/contest/${c.id}`} style={{ display: "flex", alignItems: "center", gap: 12, background: c.sponsor_color || "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "4px 4px 0 var(--text)", borderRadius: 16, padding: "14px 16px", paddingRight: c.sponsor_logo ? 88 : 16, position: "relative", overflow: "hidden" }}>
              {c.sponsor_logo && <img src={c.sponsor_logo} alt="" style={{ position: "absolute", right: 10, top: 10, height: 20, maxWidth: 68, objectFit: "contain", opacity: 0.55 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19 }}>{c.title}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {c.game && c.game !== "football" ? contestGame(c.game).name : `${c.fixture_ids.length} match${c.fixture_ids.length === 1 ? "" : "es"}`}{c.sponsor ? ` · by ${c.sponsor}` : ""}{joined ? " · joined" : ""}
                </div>
              </div>
              {c.prize_zec > 0 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span className="display" style={{ fontSize: 24 }}>{c.prize_zec}</span>
                  <span style={{ fontSize: 11, fontWeight: 800 }}>ZEC</span>
                </div>
              )}
            </Link>
          );
        })}
      </section>

    </div>
  );
}
