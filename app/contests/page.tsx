"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img } from "@/components/ui";
import { useContests, useMyContestIds, useFixtures, useSponsorRecords } from "@/lib/cloud";
import { SponsorRecordLine } from "@/components/sponsor-record";
import { SPLIT_LABEL, contestGame, inkOn } from "@/lib/data";

export default function ContestsPage() {
  const contests = useContests(), fixtures = useFixtures(), myIds = useMyContestIds(), records = useSponsorRecords();
  const [tab, setTab] = useState<"open" | "past">("open");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);

  const open = contests.filter((c) => c.status === "open");
  const past = contests.filter((c) => c.status === "closed");
  const list = tab === "open" ? open : past;

  return (
    <main className="screen wide hub hub-pad">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 className="display page-h1" style={{ margin: 0, fontSize: 34 }}>Contests</h1>
          <span className="chip" style={{ background: "var(--amber)", transform: "rotate(2deg)" }}>FREE TO PLAY</span>
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--muted)", lineHeight: 1.5 }}>
          Join a contest. Your sealed calls count toward its leaderboard. Win prizes.
        </p>
      </div>

      <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {([["open", `Open (${open.length})`], ["past", `Past (${past.length})`]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ height: 44, borderRadius: 12, border: `2px solid ${tab === k ? "#111" : "var(--line)"}`, background: tab === k ? "var(--lime)" : "var(--panel)", color: tab === k ? "#111" : "#c9d3de", fontWeight: 800, fontSize: 13 }}>{t}</button>
        ))}
      </div>

      {list.length === 0 ? (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 14, fontWeight: 600, color: "var(--muted)", background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 20 }}>
          {tab === "open" ? "No open contests right now. New ones appear here as sponsors launch them." : "No finished contests yet."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 14 }}>
          {list.map((c) => {
            const joined = myIds.includes(c.id);
            const fxs = fixtures.filter((f) => c.fixture_ids.includes(f.id));
            const nextKickoff = fxs.filter((f) => now === null || Date.parse(f.kickoff) > now!).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
            return (
              <Link key={c.id} href={`/contest/${c.id}`} style={{ display: "flex", flexDirection: "column", gap: 10, background: c.sponsor_color || "#111", color: inkOn(c.sponsor_color), border: "2px solid var(--line)", borderRadius: 22, padding: 16, paddingRight: c.sponsor_logo ? 100 : 16, position: "relative", overflow: "hidden" }}>
                {c.sponsor_logo && <img src={c.sponsor_logo} alt="" style={{ position: "absolute", right: 12, top: 12, height: 28, maxWidth: 80, objectFit: "contain", opacity: 0.75 }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {joined && <span className="chip" style={{ background: "var(--lime)", color: "#111", border: 0 }}>JOINED</span>}
                  <span className="chip" style={{ background: c.status === "open" ? "var(--sky)" : "var(--amber)", color: "#111", border: 0 }}>{c.status === "open" ? "OPEN" : "FINISHED"}</span>
                </div>
                <div className="display" style={{ fontSize: 22 }}>{c.title}</div>
                {c.description && <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, lineHeight: 1.4 }}>{c.description}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, fontWeight: 700 }}>
                  {c.prize_zec > 0 && <span style={{ background: "var(--amber)", color: "#111", borderRadius: 10, padding: "4px 10px", fontWeight: 800 }}>{c.prize_zec} ZEC</span>}
                  <span>{c.game && c.game !== "football" ? contestGame(c.game).name : `${c.fixture_ids.length} fixture${c.fixture_ids.length === 1 ? "" : "s"}`}</span>
                  {c.sponsor && <span>by {c.sponsor}</span>}
                  <span className="chip" style={{ background: "rgba(127,127,127,.2)", color: "inherit", border: 0 }}>{SPLIT_LABEL[c.prize_structure] ?? "Top 3 share"}</span>
                  {c.owner_id && c.prize_zec > 0 && <SponsorRecordLine record={records[c.owner_id]} sponsor={c.sponsor} short />}
                </div>
                {nextKickoff && c.status === "open" && <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.65 }}>Next kickoff: {nextKickoff.when}</div>}
                {c.winners && c.winners.length > 0 && (
                  <div style={{ background: "rgba(0,0,0,.3)", borderRadius: 14, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "var(--lime)" }}>WINNERS</span>
                    {c.winners.slice(0, 3).map((w) => <div key={w.rank} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}><span>#{w.rank} {w.name}</span><span>{w.zec} ZEC</span></div>)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <Link href="/sponsor" style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 20, padding: "14px 16px", color: "var(--text)", marginBottom: 16 }}>
        <Img n="cover_closest" size={48} style={{ borderRadius: 14, border: "2px solid #111", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <b className="display" style={{ fontSize: 18 }}>Run your own contest</b>
          <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>Put up a ZEC prize for your fans or community. Set it up yourself in a few minutes.</span>
        </span>
        <span className="btn" style={{ width: "auto", minHeight: 40, padding: "0 16px", background: "var(--lime)", color: "#111", flexShrink: 0 }}>Start</span>
      </Link>
      <BottomNav active="/contests" />
    </main>
  );
}
