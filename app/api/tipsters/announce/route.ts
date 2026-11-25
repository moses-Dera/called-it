import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as webpush from "web-push";

// A public tipster just sealed a tip: tell their followers, without revealing the pick.
// Only the tip that counts (the first seal on a match, before kickoff) is announced, once.
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!url || !serviceKey) return NextResponse.json({ error: "not configured" }, { status: 501 });
  if (!token) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: who } = await sb.auth.getUser(token);
  const uid = who.user?.id;
  if (!uid) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { seal_id?: unknown } | null;
  const sealId = typeof body?.seal_id === "string" ? body.seal_id : "";
  const { data: seal } = await sb.from("seals").select("id, round, game, received_at").eq("user_id", uid).eq("id", sealId).maybeSingle();
  if (!seal || !["classic", "tip"].includes(seal.game)) return NextResponse.json({ sent: 0, reason: "no such tip" });

  const [{ data: profile }, { data: fixture }, { data: first }] = await Promise.all([
    sb.from("profiles").select("handle, name, public_record").eq("id", uid).maybeSingle(),
    sb.from("fixtures").select("id, home, away, kickoff").eq("id", seal.round).maybeSingle(),
    sb.from("seals").select("id").eq("user_id", uid).eq("round", seal.round).in("game", ["classic", "tip"]).order("received_at").limit(1).maybeSingle(),
  ]);
  if (!profile?.public_record || !profile.handle) return NextResponse.json({ sent: 0, reason: "record is private" });
  if (!fixture || Date.parse(seal.received_at) >= Date.parse(fixture.kickoff)) return NextResponse.json({ sent: 0, reason: "after kickoff" });
  if (first?.id !== seal.id) return NextResponse.json({ sent: 0, reason: "only the first tip on a match counts" });

  // Claim the announcement first, so a retry never notifies twice.
  const { error: dup } = await sb.from("tip_announcements").insert({ user_id: uid, fixture_id: fixture.id, seal_id: seal.id });
  if (dup) return NextResponse.json({ sent: 0, reason: "already announced" });

  if (!vapidPublic || !vapidPrivate) return NextResponse.json({ sent: 0, reason: "push not configured" });
  const { data: followers } = await sb.from("follows").select("follower").eq("tipster", uid);
  if (!followers?.length) return NextResponse.json({ sent: 0 });
  const { data: subs } = await sb.from("push_subscriptions").select("endpoint, keys").in("user_id", followers.map((f) => f.follower));

  webpush.setVapidDetails("mailto:notifications@calledit.app", vapidPublic, vapidPrivate);
  const payload = JSON.stringify({
    title: `@${profile.handle} sealed a tip`,
    body: `${fixture.home} vs ${fixture.away}. Revealed after full time.`,
    tag: `tip-${profile.handle}-${fixture.id}`,
    url: `/tipster?h=${profile.handle}`,
  });
  let sent = 0;
  const expired: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, payload, { TTL: 6 * 3600 }); sent++; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) expired.push(s.endpoint); }
  }));
  if (expired.length) await sb.from("push_subscriptions").delete().in("endpoint", expired);
  return NextResponse.json({ sent });
}
