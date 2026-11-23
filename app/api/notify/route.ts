import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as webpush from "web-push";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 501 });
  const token = new URL(req.url).searchParams.get("token");
  if (token !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return NextResponse.json({ error: "VAPID keys not set" }, { status: 501 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });

  webpush.setVapidDetails("mailto:notifications@calledit.app", vapidPublic, vapidPrivate);
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const soon = new Date(Date.now() + 60 * 60_000).toISOString();
  const later = new Date(Date.now() + 90 * 60_000).toISOString();
  const { data: fixtures } = await sb.from("fixtures").select("id, home, away, kickoff").gte("kickoff", soon).lte("kickoff", later).is("home_goals", null);

  if (!fixtures?.length) return NextResponse.json({ ok: true, sent: 0, reason: "no upcoming fixtures" });

  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, keys");
  if (!subs?.length) return NextResponse.json({ ok: true, sent: 0, reason: "no subscriptions" });

  let sent = 0;
  const expired: string[] = [];

  for (const fixture of fixtures) {
    const payload = JSON.stringify({
      title: `${fixture.home} vs ${fixture.away}`,
      body: "Starts in ~1 hour — seal your call now!",
      tag: `kickoff-${fixture.id}`,
      url: `/seal?f=${fixture.id}`,
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
          payload,
          { TTL: 3600 }
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          expired.push(sub.endpoint);
        }
      }
    }
  }

  if (expired.length) {
    await sb.from("push_subscriptions").delete().in("endpoint", expired);
  }

  return NextResponse.json({ ok: true, sent, fixtures: fixtures.length, subs: subs.length, expired: expired.length });
}
