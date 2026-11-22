"use client";
import { useEffect, useState } from "react";
import { sb, useCloud } from "@/lib/cloud";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function NotificationBell() {
  const [supported, setSupported] = useState(false);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const uid = useCloud().session?.user.id;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_KEY) return;
    setSupported(true);
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (reg) => {
      const existing = await reg.pushManager.getSubscription();
      setSub(existing);
    }).catch(() => {});
  }, []);

  async function toggle() {
    if (!VAPID_KEY || busy) return;
    setBusy(true);
    try {
      if (sub) {
        await sub.unsubscribe();
        if (uid) await sb()?.from("push_subscriptions").delete().eq("user_id", uid).eq("endpoint", sub.endpoint);
        setSub(null);
      } else {
        const reg = await navigator.serviceWorker.ready;
        const newSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) });
        setSub(newSub);
        if (uid) {
          const json = newSub.toJSON();
          await sb()?.from("push_subscriptions").upsert({ user_id: uid, endpoint: json.endpoint, keys: json.keys }, { onConflict: "user_id,endpoint" });
        }
      }
    } catch { /* permission denied or error */ }
    setBusy(false);
  }

  if (!supported || !uid) return null;

  return (
    <button onClick={toggle} aria-label={sub ? "Notifications on" : "Turn on notifications"} title={sub ? "Notifications on — tap to turn off" : "Get notified before kickoff"} style={{ width: 44, height: 44, borderRadius: 14, border: `2px solid ${sub ? "var(--lime)" : "var(--line)"}`, background: sub ? "rgba(198,244,50,.15)" : "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={sub ? "var(--lime)" : "var(--muted)"} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    </button>
  );
}
