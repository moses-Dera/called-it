"use client";
import Link from "next/link";
import { openShare } from "./share-sheet";
import { useEffect, useState } from "react";
import { BottomNav } from "./ui";
import { PlayerSearch } from "./player-search";
import { playerCard, type PlayerCard } from "@/lib/cloud";
import { art } from "@/lib/data";

/** A player's public card at /@username. Never shows their wallet. */
export function PlayerView({ handle }: { handle: string }) {
  const [p, setP] = useState<PlayerCard | null | undefined>(undefined);
  useEffect(() => { playerCard(handle).then(setP).catch(() => setP(null)); }, [handle]);
  const share = () => {
    const url = `${location.origin}/@${handle}`;
    openShare({ title: `Share @${handle}`, text: `@${handle} on Called It`, url });
  };
  return (
    <main className="screen wide hub hub-pad">
      <div className="hub-inner" style={{ maxWidth: 580, paddingBottom: 24 }}>
        <Link href="/rooms" style={{ fontSize: 13, fontWeight: 800, color: "var(--lime)", alignSelf: "flex-start" }}>← Players</Link>
        {p === undefined && <div style={{ height: 220, borderRadius: 26, background: "var(--panel)" }} />}
        {p === null && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h1 className="display" style={{ margin: 0, fontSize: 30 }}>@{handle}</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>No player has this username.</p>
          </section>
        )}
        {p && (
          <section style={{ background: "var(--paper)", color: "#111", border: "3px solid #111", boxShadow: "5px 5px 0 var(--text)", borderRadius: 26, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img src={art(`avatar_${p.avatar}`)} alt="" width={72} height={72} style={{ borderRadius: 20, border: "3px solid #111", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <h1 className="display" style={{ margin: 0, fontSize: 28, overflowWrap: "anywhere" }}>{p.name}</h1>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#4a4436" }}>@{p.handle}</div>
              </div>
            </div>
            {p.bio && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{p.bio}</p>}
            {p.points != null && <div style={{ display: "grid", gridTemplateColumns: `repeat(${p.me ? 3 : 2}, minmax(0, 1fr))`, gap: 8 }}>
              {([[p.points, "points"], [p.contests_won, "contest wins"], ...(p.me ? [[Number(p.zec_received ?? 0), "ZEC received"]] : [])] as [number | null, string][]).map(([v, l]) => (
                <div key={String(l)} style={{ background: "#fff", border: "2px solid #111", borderRadius: 14, padding: 10 }}>
                  <div className="display" style={{ fontSize: 22 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 800 }}>{l}</div>
                </div>
              ))}
            </div>}
            {p.me && !p.stats_public && <span style={{ fontSize: 12, color: "#4a4436" }}>Your stats are private: other people see only your name and avatar. Change it in Profile.</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.tipster && <Link href={`/tipster/${p.handle}`} className="btn" style={{ width: "auto", minHeight: 44, padding: "0 16px", background: "#111", color: "var(--lime)", border: 0 }}>See their sealed calls</Link>}
              {p.me && <Link href="/profile" className="btn btn-paper" style={{ width: "auto", minHeight: 44, padding: "0 16px" }}>Edit profile</Link>}
              <button className="btn btn-paper" onClick={share} style={{ width: "auto", minHeight: 44, padding: "0 16px" }}>Share</button>
            </div>
            {p.joined && <span style={{ fontSize: 12, color: "#4a4436" }}>Playing since {new Date(p.joined).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>}
          </section>
        )}
        <PlayerSearch />
      </div>
      <BottomNav active="/rooms" />
    </main>
  );
}
