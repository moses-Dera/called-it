"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cloudReady, cloudRpc, signInWithGoogle, useCloud } from "@/lib/cloud";
import { useStore } from "@/lib/store";

const G = () => (
  <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** True when sign-in is available but the player is still a guest. */
export function useGuest() {
  const c = useCloud();
  return cloudReady && c.status !== "off" && !c.session;
}

/** Compact "Sign in" pill for the home header (phones and desktop). */
export function SignInPill() {
  if (!useGuest()) return null;
  return (
    <button onClick={signInWithGoogle} style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", borderRadius: 999, border: "2px solid #111", background: "var(--paper)", color: "#111", fontSize: 13, fontWeight: 800, boxShadow: "3px 3px 0 var(--text)" }}>
      <G />Sign in
    </button>
  );
}

/** Account box at the bottom of the desktop sidebar. */
export function SidebarAccount() {
  const c = useCloud();
  const name = useStore().profile.name;
  if (!cloudReady) return null;
  const user = c.session?.user;
  if (user) {
    return (
      <>
      <AdminLink uid={user.id} />
      <Link href="/profile" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, background: "var(--panel)", border: "2px solid var(--line)" }}>
        <span style={{ fontSize: 13, color: "var(--text)" }}>{name || user.user_metadata?.full_name || "Signed in"}</span>
        <span style={{ fontSize: 11, color: c.status === "error" || c.status === "offline" ? "var(--amber)" : c.status === "syncing" ? "var(--amber)" : "var(--lime)", fontWeight: 700 }}>{c.status === "error" || c.status === "offline" ? "Syncing…" : c.status === "syncing" ? "Syncing…" : "Backed up"}</span>
      </Link>
      </>
    );
  }
  return (
    <div style={{ background: "var(--panel)", border: "2px solid var(--line)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 12, color: "#c9d3de", lineHeight: 1.45 }}>Playing as a guest. Sign in to keep your points and seals on every device.</span>
      <button onClick={signInWithGoogle} className="btn btn-paper" style={{ minHeight: 40, fontSize: 13, borderRadius: 12 }}><G />Sign in with Google</button>
    </div>
  );
}

/** Nudge shown once a guest has something worth saving. */
export function BackupNudge({ what = "points and proofs" }: { what?: string }) {
  const guest = useGuest();
  const s = useStore();
  if (!guest || (s.seals.length === 0 && s.ledger.length === 0)) return null;
  return (
    <div role="note" style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel)", border: "2px dashed var(--lime)", borderRadius: 18, padding: "10px 12px" }}>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: "#c9d3de" }}><b style={{ color: "var(--text)" }}>Your {what} live only on this device.</b> Sign in to back them up.</div>
      <button onClick={signInWithGoogle} className="btn btn-paper" style={{ minHeight: 40, fontSize: 13, borderRadius: 12, flexShrink: 0 }}><G />Sign in</button>
    </div>
  );
}

/** Sidebar link to /admin, shown only to the admin. */
function AdminLink({ uid }: { uid: string }) {
  const [admin, setAdmin] = useState<{ uid: string; on: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    cloudRpc<{ is_admin: boolean }>("admin_status").then((s) => live && setAdmin({ uid, on: s.is_admin })).catch(() => {});
    return () => { live = false; };
  }, [uid]);
  if (!admin?.on || admin.uid !== uid) return null;
  return <Link href="/admin" style={{ background: "var(--amber)", color: "#111", border: "2px solid #111", justifyContent: "center", fontWeight: 800 }}>Admin</Link>;
}
