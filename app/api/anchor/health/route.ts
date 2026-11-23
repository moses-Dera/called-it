import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer /i, "");
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
