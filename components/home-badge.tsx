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
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <SignInPill />
      <NotificationBell />
      <Link href="/vault" aria-label={`${t.points} points. Open your vault`} style={{ background: "var(--amber)", color: "#111", border: "2px solid #111", boxShadow: "3px 3px 0 var(--text)", borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 800, minHeight: 32, display: "flex", alignItems: "center" }}>{t.points} pts</Link>
      <Link href="/profile" aria-label="Your profile" style={{ display: "flex", minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
        <Img n={`avatar_${s.profile.avatar}`} size={42} alt="" style={{ borderRadius: 14, border: "2px solid var(--text)" }} />
      </Link>
    </div>
  );
}
