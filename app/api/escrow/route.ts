import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Reveal escrow: a signed-in player's sealed moves, kept so they can be revealed from any of their devices
// with nothing to remember. The server encrypts each move with SEAL_ESCROW_KEY (AES-GCM, held only in the
// server environment) and stores the ciphertext in the player's own rows; it decrypts only for the owner.
// Other players can never read them. Moves cannot be changed either way: their hashes are already sealed.
//   POST { put: [{ seal_id, move, salt, player }] }   store
//   POST { get: [seal_id, ...] }                      read back (owner only)
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

async function key() {
  const raw = process.env.SEAL_ESCROW_KEY;
  if (!raw || unb64(raw).length !== 32) return null;
  return crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function POST(req: Request) {
  const k = await key();
  if (!k) return NextResponse.json({ error: "SEAL_ESCROW_KEY is not set (32 random bytes, base64)." }, { status: 501 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!url || !anon || !token) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: who } = await sb.auth.getUser(token);
  const uid = who.user?.id;
  if (!uid) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const body = await req.json().catch(() => null) as { put?: { seal_id: string; move: string; salt: string; player: string }[]; get?: string[] } | null;
  // The seal id is bound into the encryption, so a stored blob cannot be swapped onto another seal.
  if (Array.isArray(body?.put)) {
    const items = body.put.slice(0, 200).filter((x) => typeof x?.seal_id === "string" && x.seal_id.length <= 64 && typeof x.move === "string" && x.move.length <= 2000 && typeof x.salt === "string" && typeof x.player === "string");
    const rows = await Promise.all(items.map(async (x) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${uid}|${x.seal_id}`) }, k, enc.encode(JSON.stringify({ move: x.move, salt: x.salt, player: x.player })));
      return { user_id: uid, seal_id: x.seal_id, iv: b64(iv), data: b64(data) };
    }));
    if (rows.length) {
      const { error } = await sb.from("seal_vault").upsert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ stored: rows.length });
  }
  if (Array.isArray(body?.get)) {
    const ids = body.get.filter((x) => typeof x === "string").slice(0, 200);
    const { data, error } = await sb.from("seal_vault").select("seal_id, iv, data").eq("user_id", uid).in("seal_id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const out = (await Promise.all((data ?? []).map(async (r) => {
      try {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(r.iv), additionalData: enc.encode(`${uid}|${r.seal_id}`) }, k, unb64(r.data));
        return { id: r.seal_id, ...JSON.parse(dec.decode(plain)) };
      } catch { return null; }
    }))).filter(Boolean);
    return NextResponse.json({ moves: out });
  }
  return NextResponse.json({ error: "send put or get" }, { status: 400 });
}
