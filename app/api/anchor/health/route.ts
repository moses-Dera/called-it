import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer /i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Without a public key the caller can't be checked, so refuse rather than skip the check.
  if (!url || !publicKey) return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
  const asCaller = createClient(url, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr || isAdmin !== true) return NextResponse.json({ error: "admin access required" }, { status: 403 });
  if (!url || !key) return NextResponse.json({ ok: false, mode: "simulated", error: "SUPABASE_SERVICE_ROLE_KEY not set — running in simulated mode" }, { status: 200 });

  try {
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.from("ots_proofs").select("status").limit(500);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    const queued = data.filter((r) => r.status === "queued").length;
    const mined  = data.filter((r) => r.status === "mined").length;
    return NextResponse.json({ ok: true, mode: "bitcoin", queued, mined });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
