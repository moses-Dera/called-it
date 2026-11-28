import type { SupabaseClient } from "@supabase/supabase-js";
import * as webpush from "web-push";

function initVapid() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:notifications@calledit.app", pub, priv);
  return true;
}

/**
 * Send push notifications for matches starting in 60–90 minutes.
 * Uses fixtures.notified_at so each match alerts subscribers once even when called every 15 minutes.
 */
export async function sendKickoffReminders(sb: SupabaseClient) {
  if (!initVapid()) return { sent: 0, reason: "VAPID keys not set" };

  const soon = new Date(Date.now() + 60 * 60_000).toISOString();
  const later = new Date(Date.now() + 90 * 60_000).toISOString();
  const { data: fixtures } = await sb
    .from("fixtures")
    .select("id, home, away, kickoff, notified_at")
    .gte("kickoff", soon)
    .lte("kickoff", later)
    .is("home_goals", null)
    .is("notified_at", null);

  if (!fixtures?.length) return { sent: 0, reason: "no upcoming fixtures" };

  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, keys");
  if (!subs?.length) return { sent: 0, reason: "no subscriptions" };

  let sent = 0;
  const expired: string[] = [];

  for (const fixture of fixtures) {
    // Claim the fixture atomically before fanning out pushes so concurrent /api/live calls never double-notify.
    const { data: claimed } = await sb
      .from("fixtures")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", fixture.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const payload = JSON.stringify({
      title: `${fixture.home} vs ${fixture.away}`,
      body: "Starts in ~1 hour — seal your call now!",
      tag: `kickoff-${fixture.id}`,
      url: `/seal?f=${fixture.id}`,
    });
    for (let i = 0; i < subs.length; i += 40) {
      const batch = subs.slice(i, i + 40);
      await Promise.allSettled(
        batch.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
              payload,
              { TTL: 3600 },
            );
            sent++;
          } catch (err: unknown) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 410 || status === 404) expired.push(sub.endpoint);
          }
        }),
      );
    }
  }

  if (expired.length) await sb.from("push_subscriptions").delete().in("endpoint", expired);
  return { sent, fixtures: fixtures.length, subs: subs.length, expired: expired.length };
}

/** Send a single test notification to a user's registered devices. */
export async function sendTestPush(sb: SupabaseClient, userId: string) {
  if (!initVapid()) throw new Error("VAPID keys not set on server");
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, keys").eq("user_id", userId);
  if (!subs?.length) throw new Error("No push subscription for your account — tap the Bell icon on Home first.");

  let sent = 0;
  const expired: string[] = [];
  const payload = JSON.stringify({
    title: "Called It notifications work!",
    body: "You will be notified ~1 hour before matches kick off.",
    tag: `test-${Date.now()}`,
    url: "/",
  });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        payload,
        { TTL: 300 },
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) expired.push(sub.endpoint);
    }
  }
  if (expired.length) await sb.from("push_subscriptions").delete().in("endpoint", expired);
  return { sent, subs: subs.length };
}
