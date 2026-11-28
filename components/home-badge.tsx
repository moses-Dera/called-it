"use client";
import Link from "next/link";
import { totals, useStore } from "@/lib/store";
import { Img } from "./ui";
import { SignInPill } from "./account";
import { NotificationBell } from "./notifications";
export function HomeBadge() {
  const s = useStore();
  const t = totals(s);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
      <SignInPill />
      <NotificationBell />
      <Link href="/vault" aria-label={`${t.points} points. Open your vault`} style={{ background: "var(--amber)", color: "#111", border: "2px solid #111", boxShadow: "3px 3px 0 var(--text)", borderRadius: 999, padding: "5px 10px", fontSize: 13, fontWeight: 800, minHeight: 34, display: "flex", alignItems: "center", whiteSpace: "nowrap", flexShrink: 0 }}>{t.points} pts</Link>
      <Link href="/profile" aria-label="Your profile" style={{ display: "flex", minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Img n={`avatar_${s.profile.avatar}`} size={40} alt="" style={{ borderRadius: 12, border: "2px solid var(--text)" }} />
      </Link>
    </div>
  );
}
