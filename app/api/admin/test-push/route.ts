import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendTestPush } from "@/lib/push";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!url || !anon || !serviceKey || !token) {
    return NextResponse.json({ error: "Server configuration or auth missing" }, { status: 401 });
  }
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: status } = await userClient.rpc("admin_status");
  if (!status?.is_admin) return NextResponse.json({ error: "admins only" }, { status: 403 });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "unknown user" }, { status: 401 });

  try {
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
    const res = await sendTestPush(sb, user.id);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to send push" }, { status: 400 });
  }
}
