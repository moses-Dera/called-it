import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendKickoffReminders } from "@/lib/push";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 501 });
  const token = new URL(req.url).searchParams.get("token");
  if (token !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 501 });

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
  const res = await sendKickoffReminders(sb);
  if (res.reason === "VAPID keys not set") return NextResponse.json({ error: res.reason }, { status: 501 });
  return NextResponse.json({ ok: true, ...res });
}
