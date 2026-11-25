import { createClient } from "@supabase/supabase-js";

// The OpenTimestamps proof for a Merkle root, as a .ots file anyone can check with `ots verify`.
export async function GET(req: Request) {
  const root = new URL(req.url).searchParams.get("root") ?? "";
  if (!/^[0-9a-f]{64}$/.test(root)) return Response.json({ error: "root must be 64 hex characters" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "proofs are not available in simulated mode" }, { status: 501 });
  const { data, error } = await createClient(url, key, { auth: { persistSession: false } })
    .from("ots_proofs").select("proof_b64").eq("root", root).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 502 });
  if (!data) return Response.json({ error: "no proof for this root" }, { status: 404 });
  return new Response(Buffer.from(data.proof_b64, "base64"), {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="calledit-${root.slice(0, 12)}.ots"`, "cache-control": "public, max-age=300" },
  });
}
