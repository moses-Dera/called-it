import { createClient } from "@supabase/supabase-js";

const OTS_HEADER = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");

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
  let file = Buffer.from(data.proof_b64, "base64");
  // Proofs stored before the .ots file format are a bare timestamp for the root: add the standard
  // header (magic, version 1, sha256, the root) so `ots verify` accepts them.
  if (!file.subarray(0, OTS_HEADER.length).equals(OTS_HEADER)) {
    file = Buffer.concat([OTS_HEADER, Buffer.from([0x01, 0x08]), Buffer.from(root, "hex"), file]);
  }
  return new Response(file, {
    headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="calledit-${root.slice(0, 12)}.ots"`, "cache-control": "public, max-age=300" },
  });
}
