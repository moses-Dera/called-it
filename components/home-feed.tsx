"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Img } from "./ui";
import { useContests, useFixtures } from "@/lib/cloud";

/** Home's right column: fixtures still open for sealing, then open contests. */
export function HomeFeed() {
  const fixtures = useFixtures();
  const contests = useContests().filter((c) => c.status === "open");
  // "Open" depends on the clock, so decide it after mount (the server renders the full list).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); }, []);
  const open = fixtures.filter((f) => now === null || Date.parse(f.kickoff) > now).slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Seal before kickoff</h2>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{open.length} open</span>
        </div>
        {open.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No fixtures open right now. New ones appear here.</div>}
        {open.map((f) => (
          <Link key={f.id} href={`/seal?f=${f.id}`} style={{ display: "flex", alignItems: "stretch", color: "#111", background: "var(--paper)", borderRadius: 16, overflow: "hidden", minHeight: 64 }}>
            <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, borderRight: "2px dashed #c9bfa6", minWidth: 0 }}>
              <div className="display" style={{ fontSize: 17 }}>{f.home} vs {f.away}</div>
              <div style={{ fontSize: 12, color: "#4a4436", fontWeight: 600 }}>Kickoff {f.when}</div>
            </div>
            <div style={{ width: 78, background: "var(--lime)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 12, fontWeight: 800 }}><Img n="seal" size={30} />SEAL</div>
          </Link>
        ))}
      </section>

      <Link href="/rooms" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--lilac)", color: "#111", border: "3px solid #111", boxShadow: "4px 4px 0 var(--text)", borderRadius: 18, padding: "12px 14px" }}>
        <Img n="cover_arcade" size={44} style={{ borderRadius: 12, border: "2px solid #111" }} />
        <div style={{ flex: 1 }}><div className="display" style={{ fontSize: 18 }}>Play with friends</div><div style={{ fontSize: 12, fontWeight: 700 }}>Pick your opponents. Every move sealed, opened together.</div></div>
        <span style={{ fontWeight: 800 }}>→</span>
      </Link>

      {contests.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 className="display" style={{ margin: 0, fontSize: 22 }}>Contests</h2>
          {contests.slice(0, 3).map((c) => (
            <Link key={c.id} href={`/contest?c=${c.id}`} style={{ display: "flex", alignItems: "center", gap: 12, background: "#111", color: "var(--paper)", border: "2px solid var(--line)", borderRadius: 16, padding: "12px 14px" }}>
              <Img n="cover_closest" size={40} style={{ borderRadius: 12, border: "2px solid #111" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 17 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "#c9d3de", fontWeight: 600 }}>
                  {c.fixture_ids.length} fixture{c.fixture_ids.length === 1 ? "" : "s"}{c.sponsor ? ` · sponsored by ${c.sponsor}` : ""}
                </div>
              </div>
              {c.prize_zec > 0 && <span className="chip" style={{ background: "var(--amber)" }}>{c.prize_zec} ZEC</span>}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
