"use client";
import Link from "next/link";
import { useState } from "react";
import { BottomNav, ErrorBoundary, Img, Skeleton } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { PLAYERS, art } from "@/lib/data";
import { cloudReady, useCloud, useLeaderboard } from "@/lib/cloud";
import { totals, useStore } from "@/lib/store";

// Shown only when accounts are not configured (local demo builds).
const DEMO = [410, 355, 320, 290, 240, 150, 95];
const BADGES = ["ORACLE", "EARLY BIRD", "SNIPER", "BOLD CALLER", "ON A STREAK"];
const POD = [{ rank: 2, size: 64, h: 96, bg: "#9FD8FF", rot: -4 }, { rank: 1, size: 78, h: 128, bg: "var(--lime)", rot: 3 }, { rank: 3, size: 58, h: 74, bg: "var(--amber)", rot: 4 }];
type Row = { name: string; av: string; pts: number; me: boolean; rank: number };

export default function Ranks() {
  const [tab, setTab] = useState<"week" | "all">("week");
  const s = useStore();
  const signedIn = !!useCloud().session;
  const board = useLeaderboard(tab);

  const rows: Row[] | null = cloudReady
    ? board.rows && board.rows.map((r) => ({ name: r.me ? `${r.name} (you)` : r.name, av: art(`avatar_${r.avatar}`), pts: r.points, me: r.me, rank: r.rank }))
    : PLAYERS.map((p, i) => ({ name: i === 0 ? "You" : p.name, av: p.av, me: i === 0, pts: i === 0 ? totals(s).points : DEMO[i - 1], rank: 0 }))
        .sort((a, b) => b.pts - a.pts).map((r, i) => ({ ...r, rank: i + 1 }));
  const pod = rows ? [rows[1], rows[0], rows[2]] : [];
  const meRanked = rows?.some((r) => r.me);

  return (
    <main className="screen wide hub ranks">
      <div className="ranks-head" style={{ padding: "18px 20px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Ranks</h1>
          <span className="chip" style={{ background: "var(--amber)", transform: "rotate(2deg)", padding: "6px 10px" }}>{cloudReady ? "VERIFIED POINTS" : "DEMO PLAYERS"}</span>
        </div>
        <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
          {([["week", "This week"], ["all", "All time"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ height: 44, borderRadius: 12, border: `2px solid ${tab === k ? "#111" : "var(--line)"}`, background: tab === k ? "var(--lime)" : "var(--panel)", color: tab === k ? "#111" : "#c9d3de", fontWeight: 800, fontSize: 13 }}>{t}</button>
          ))}
        </div>
      </div>

      <div className="ranks-pod" style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, padding: "18px 20px 0" }}>
        {POD.map((d, i) => {
          const p = pod[i];
          return (
            <div key={d.rank} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: 108 }}>
              {p ? <img src={p.av} alt="" width={d.size} height={d.size} style={{ borderRadius: 20, border: "3px solid #111", boxShadow: `3px 3px 0 ${d.bg}`, transform: `rotate(${d.rot}deg)` }} />
                : <div className="display" style={{ width: d.size, height: d.size, borderRadius: 20, border: "3px dashed #5b6878", display: "flex", alignItems: "center", justifyContent: "center", color: "#5b6878", fontSize: 24 }}>?</div>}
              <b style={{ fontSize: 13, maxWidth: 108, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: p ? "var(--text)" : "var(--muted)" }}>{p ? p.name : "Open spot"}</b>
              <div style={{ width: "100%", height: d.h, borderRadius: "16px 16px 0 0", background: d.bg, border: "3px solid #111", borderBottom: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, color: "#111", opacity: p ? 1 : 0.45, transition: "height 300ms" }}>
                <span className="display" style={{ fontSize: 36 }}>{d.rank}</span><b style={{ fontSize: 13 }}>{p ? p.pts : "–"}</b>
              </div>
            </div>
          );
        })}
      </div>

      <div className="ranks-list" style={{ background: "var(--paper)", color: "#111", borderRadius: "26px 26px 0 0", padding: "12px 20px 0", display: "flex", flexDirection: "column", flex: 1 }}>
        {rows === null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 0" }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <Skeleton w={22} h={22} r={6} />
                <Skeleton w={38} h={38} r={12} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}><Skeleton w="60%" h={14} /><Skeleton w="30%" h={10} /></div>
                <Skeleton w={40} h={20} r={6} />
              </div>
            ))}
          </div>
        )}
        {rows && rows.length === 0 && (
          <div style={{ padding: "16px 0", fontSize: 14, fontWeight: 600, color: "#4a4436", lineHeight: 1.5 }}>
            No ranked points {tab === "week" ? "this week" : "yet"}. Seal a Classic Call before kickoff while signed in, and the server scores it at full time.
          </div>
        )}
        {rows?.slice(3).map((r, i) => (
          <div key={r.rank + r.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "2px dashed #d8cfb8", background: r.me ? "rgba(198,244,50,.35)" : "transparent" }}>
            <span className="display" style={{ width: 22, fontSize: 20 }}>{r.rank}</span>
            <img src={r.av} alt="" width={38} height={38} style={{ borderRadius: 12, border: "2px solid #111" }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div><div style={{ fontSize: 11, fontWeight: 800, color: "#4a4436" }}>{BADGES[i % BADGES.length]}</div></div>
            <span className="display" style={{ fontSize: 20 }}>{r.pts}</span>
          </div>
        ))}
        {cloudReady && board.hasMore && (
          <button onClick={board.loadMore} disabled={board.loading} style={{ margin: "10px 0", padding: "10px", borderRadius: 12, border: "2px solid #111", background: "var(--lime)", color: "#111", fontWeight: 800, fontSize: 13 }}>
            {board.loading ? "Loading…" : "Load more"}
          </button>
        )}
        {cloudReady && rows && !meRanked && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", fontSize: 13, fontWeight: 700, color: "#4a4436" }}>
            <span style={{ flex: 1 }}>{signedIn ? "You're not ranked yet. Bot games are practice; only server-checked calls count." : "Sign in to get on the leaderboard."}</span>
            {!signedIn && <SignInPill />}
          </div>
        )}
        <Link href="/vault" style={{ margin: "12px 0 16px", display: "flex", alignItems: "center", gap: 12, background: "#111", color: "var(--paper)", borderRadius: 18, padding: "12px 14px" }}>
          <Img n="seal" size={40} /><div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>Win contests to earn prizes</b><div style={{ fontSize: 12, color: "#c9d3de" }}>Points rank you. Contest prizes go to your Vault. Free to play, always.</div></div><span style={{ color: "var(--lime)", fontWeight: 800 }}>→</span>
        </Link>
      </div>
      <div className="navwrap" style={{ background: "var(--paper)" }}><BottomNav active="/ranks" /></div>
    </main>
  );
}
