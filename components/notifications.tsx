"use client";
import { useCallback, useEffect, useState } from "react";
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

/** Push notifications for this device: whether they can work here, whether they are on, and the switch. */
export function usePush() {
  const [supported, setSupported] = useState(false);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const uid = useCloud().session?.user.id;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_KEY) return;
    setSupported(true);
    setDenied(Notification.permission === "denied");
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (reg) => {
      setSub(await reg.pushManager.getSubscription());
    }).catch(() => {});
  }, []);

  const enable = useCallback(async () => {
    if (!VAPID_KEY || busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const next = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_KEY) });
      setSub(next);
      if (uid) {
        const json = next.toJSON();
        await sb()?.from("push_subscriptions").upsert({ user_id: uid, endpoint: json.endpoint, keys: json.keys }, { onConflict: "user_id,endpoint" });
      }
    } catch { setDenied(Notification.permission === "denied"); }
    setBusy(false);
  }, [busy, uid]);

  const disable = useCallback(async () => {
    if (!sub || busy) return;
    setBusy(true);
    try {
      await sub.unsubscribe();
      if (uid) await sb()?.from("push_subscriptions").delete().eq("user_id", uid).eq("endpoint", sub.endpoint);
      setSub(null);
    } catch { /* leave it on */ }
    setBusy(false);
  }, [busy, sub, uid]);

  return { supported, on: !!sub, busy, denied, enable, disable };
}

export function NotificationBell() {
  const push = usePush();
  const uid = useCloud().session?.user.id;
  if (!push.supported || !uid) return null;
  return (
    <button onClick={push.on ? push.disable : push.enable} aria-label={push.on ? "Notifications on" : "Turn on notifications"} title={push.on ? "Notifications on — tap to turn off" : "Get notified before kickoff"} style={{ width: 44, height: 44, borderRadius: 14, border: `2px solid ${push.on ? "var(--lime)" : "var(--line)"}`, background: push.on ? "rgba(198,244,50,.15)" : "var(--panel)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={push.on ? "var(--lime)" : "var(--muted)"} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    </button>
  );
}
