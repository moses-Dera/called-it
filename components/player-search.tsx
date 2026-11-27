"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { searchPlayers, type PlayerHit } from "@/lib/cloud";
import { art } from "@/lib/data";

/** Find players by @username or name, like searching people on X. */
export function PlayerSearch() {
  const [q, setQ] = useState(""), [hits, setHits] = useState<PlayerHit[] | null>(null);
  useEffect(() => {
    const t = q.trim();
    if (t.replace(/^@/, "").length < 2) { setHits(null); return; }
    let on = true;
    const timer = setTimeout(() => searchPlayers(t).then((r) => on && setHits(r)).catch(() => on && setHits([])), 250);
    return () => { on = false; clearTimeout(timer); };
  }, [q]);
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find players by @username or name" aria-label="Find players" autoComplete="off" spellCheck={false}
        style={{ height: 46, borderRadius: 14, border: "2px solid var(--line)", background: "var(--panel)", color: "var(--text)", padding: "0 14px", fontSize: 15 }} />
      {hits && (
        <div role="listbox" aria-label="Players found" style={{ display: "flex", flexDirection: "column", background: "var(--paper)", color: "#111", borderRadius: 14, overflow: "hidden", border: "2px solid #111" }}>
          {hits.length === 0 && <div style={{ padding: 12, fontSize: 13 }}>No players found.</div>}
          {hits.map((h) => (
            <Link key={h.handle} href={`/@${h.handle}`} role="option" aria-selected={false} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #e5dcc6", color: "#111" }}>
              <img src={art(`avatar_${h.avatar}`)} alt="" width={32} height={32} style={{ borderRadius: 10, border: "2px solid #111" }} />
              <span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontSize: 14 }}>{h.name}</b><span style={{ fontSize: 12, color: "#4a4436" }}>@{h.handle}</span></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
