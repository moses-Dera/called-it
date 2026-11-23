"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ErrorBoundary, Img, SkeletonCard } from "./ui";
import { useContests, useFixtures, useFixtureSealCounts, useMyContestIds } from "@/lib/cloud";

export function HomeFeed() {
  return <ErrorBoundary><HomeFeedInner /></ErrorBoundary>;
}

function HomeFeedInner() {
  const fixtures = useFixtures();
  const contests = useContests().filter((c) => c.status === "open");
  const sealCounts = useFixtureSealCounts();
  const myIds = useMyContestIds();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);

  const open = fixtures.filter((f) => now === null || Date.parse(f.kickoff) > now)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const rest = open.slice(0, 6);
  const loading = now === null;

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Seal before kickoff</h2>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{open.length} open</span>
        </div>
        {rest.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No fixtures open right now. New ones appear here.</div>}
        <div className="fixture-grid">{rest.map((f) => (
          <Link key={f.id} href={`/seal?f=${f.id}`} style={{ display: "flex", alignItems: "stretch", color: "#111", background: "var(--paper)", borderRadius: 16, overflow: "hidden", minHeight: 64 }}>
            <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderRight: "2px dashed #c9bfa6", minWidth: 0 }}>
              <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
              <div style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>Kickoff {f.when}{sealCounts[f.id] > 0 ? ` · ${sealCounts[f.id]} sealed` : ""}</div>
            </div>
            <div style={{ width: 78, background: "var(--lime)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 12, fontWeight: 800 }}><Img n="seal" size={30} />SEAL</div>
          </Link>
        ))}</div>
      </section>

      <Link href="/rooms" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--lilac)", color: "#111", border: "3px solid #111", boxShadow: "4px 4px 0 var(--text)", borderRadius: 18, padding: "12px 14px" }}>
        <Img n="cover_arcade" size={44} style={{ borderRadius: 12, border: "2px solid #111" }} />
        <div style={{ flex: 1 }}><div className="display" style={{ fontSize: 18 }}>Play with friends</div><div style={{ fontSize: 12, fontWeight: 700 }}>Pick your opponents. Every move sealed, opened together.</div></div>
        <span style={{ fontWeight: 800 }}>→</span>
      </Link>

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
        {contests.slice(0, 3).map((c) => {
          const joined = myIds.includes(c.id);
          return (
            <Link key={c.id} href={`/contest?c=${c.id}`} style={{ display: "flex", alignItems: "center", gap: 12, background: c.sponsor_color || "var(--amber)", color: "#111", border: "3px solid #111", boxShadow: "4px 4px 0 var(--text)", borderRadius: 16, padding: "14px 16px", position: "relative", overflow: "hidden" }}>
              {c.sponsor_logo && <img src={c.sponsor_logo} alt="" style={{ position: "absolute", right: 10, top: 10, height: 20, opacity: 0.5 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 19 }}>{c.title}</div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {c.fixture_ids.length} fixture{c.fixture_ids.length === 1 ? "" : "s"}{c.sponsor ? ` · by ${c.sponsor}` : ""}{joined ? " · joined" : ""}
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Link href="/how" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: "14px 14px" }}>
          <Img n="seal" size={32} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>How your seal works</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>Three steps. Zero trust required.</div>
        </Link>
        <Link href="/syndicates" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: "14px 14px" }}>
          <Img n="cover_arcade" size={32} style={{ borderRadius: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>Syndicates</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>Team up. Compete as a group.</div>
        </Link>
      </div>
    </div>
  );
}

