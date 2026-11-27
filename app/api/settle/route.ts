import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { settleContests } from "@/lib/settle";

// Settle one contest the moment someone views it after it has finished, instead of waiting for the next
// scheduled run. Safe to call by anyone: closing only happens once the database agrees the contest is over.
const recent = new Map<string, number>();

export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("c") ?? "";
  if (!/^[a-z0-9-]{3,64}$/.test(id)) return NextResponse.json({ error: "bad contest id" }, { status: 400 });
  const last = recent.get(id) ?? 0;
  if (Date.now() - last < 30_000) return NextResponse.json({ ok: true, throttled: true });
  recent.set(id, Date.now());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 501 });
  const log = await settleContests(createClient(url, key, { auth: { persistSession: false } }), id);
  return NextResponse.json({ ok: true, log });
}
