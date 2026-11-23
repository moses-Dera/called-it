// Anchors Merkle roots on Bitcoin via the free public OpenTimestamps calendars.
// No wallet, no server, no fees — the calendars batch thousands of hashes and pay the Bitcoin tx fee.
//
// Two-step process (Bitcoin blocks take ~10 min; calendars batch every few minutes):
//   stampRoot(root)  → submits hash to 3 calendars, stores the binary .ots proof in Supabase, returns "queued"
//   checkRoot(root)  → tries to upgrade the stored proof; returns "mined" + block height once confirmed
//
// Simulated mode (SUPABASE_SERVICE_ROLE_KEY unset): instantly returns "mined" with a fake txid, clearly labelled.

import { createClient } from "@supabase/supabase-js";

export type AnchorState = {
  status: "queued" | "mined" | "failed";
  txid?: string;      // Bitcoin txid (block hash) once mined — set to block hash for OTS
  height?: number;    // Bitcoin block height once mined
  error?: string;
  mode: "bitcoin" | "simulated";
};

// Three public OTS calendar servers — stamp to all, upgrade from any that responds.
const CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://a.eternitywall.com",
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/** POST the 32-byte digest to a calendar. Returns raw .ots bytes or null on failure. */
async function stampAtCalendar(calendar: string, digestBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${calendar}/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Accept": "application/octet-stream" },
      body: digestBytes.buffer as ArrayBuffer,
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
}

/** GET /timestamp/<hex-commitment> from a calendar to try to upgrade a pending proof.
 *  Returns upgraded bytes if the calendar now has a Bitcoin attestation, null otherwise. */
async function upgradeAtCalendar(calendar: string, commitment: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${calendar}/timestamp/${commitment}`, {
      headers: { "Accept": "application/octet-stream" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    // A completed OTS proof contains the Bitcoin attestation magic bytes 0x0588960d73d71901
    // After the initial header. We scan for it as a quick heuristic.
    const BITCOIN_MAGIC = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
    const hasBitcoin = bytes.some((_, i) =>
      i + 8 <= bytes.length && BITCOIN_MAGIC.every((b, j) => bytes[i + j] === b)
    );
    return hasBitcoin ? bytes : null;
  } catch { return null; }
}

/** Extract Bitcoin block height from a completed OTS proof.
 *  The 8 bytes after the Bitcoin attestation magic are a little-endian block height. */
function extractHeight(proof: Uint8Array): number | undefined {
  const MAGIC = [0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01];
  for (let i = 0; i + 16 <= proof.length; i++) {
    if (MAGIC.every((b, j) => proof[i + j] === b)) {
      // Next 8 bytes: little-endian block height (only lower 4 bytes matter in practice)
      let h = 0;
      for (let j = 0; j < 4; j++) h |= proof[i + 8 + j] << (8 * j);
      return h >>> 0;
    }
  }
  return undefined;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Stamp the root on all OTS calendars and persist the proof. Returns "queued" immediately. */
export async function stampRoot(root: string): Promise<AnchorState | null> {
  const client = db();
  if (!client) {
    // Simulated mode: no DB, return an instant fake result.
    return { status: "mined", txid: "sim-" + root.slice(0, 16), height: 870000 + Math.floor(Date.now() / 600_000), mode: "simulated" };
  }

  // Already stamped? Return current state.
  const { data: existing } = await client.from("ots_proofs").select("status,height,proof_b64").eq("root", root).maybeSingle();
  if (existing) {
    if (existing.status === "mined") return { status: "mined", height: existing.height ?? undefined, mode: "bitcoin" };
    if (existing.status === "queued") return { status: "queued", mode: "bitcoin" };
  }

  const digestBytes = hexToBytes(root);
  // Try all calendars in parallel; keep the first successful proof bytes.
  const results = await Promise.all(CALENDARS.map((c) => stampAtCalendar(c, digestBytes)));
  const proof = results.find(Boolean);
  if (!proof) return null; // All calendars unreachable — tell browser to retry.

  const proof_b64 = Buffer.from(proof).toString("base64");
  await client.from("ots_proofs").upsert({ root, proof_b64, status: "queued" });
  return { status: "queued", mode: "bitcoin" };
}

/** Check if a previously stamped root has been mined into Bitcoin. */
export async function checkRoot(root: string): Promise<AnchorState | null> {
  const client = db();
  if (!client) return null;

  const { data } = await client.from("ots_proofs").select("status,height,proof_b64").eq("root", root).maybeSingle();
  if (!data) return { status: "failed", error: "unknown root", mode: "bitcoin" };
  if (data.status === "mined") return { status: "mined", height: data.height ?? undefined, mode: "bitcoin" };

  // Try upgrading against each calendar.
  const commitment = root; // For OTS the commitment we query with is the original digest hex.
  for (const calendar of CALENDARS) {
    const upgraded = await upgradeAtCalendar(calendar, commitment);
    if (!upgraded) continue;
    const height = extractHeight(upgraded);
    if (height) {
      const proof_b64 = Buffer.from(upgraded).toString("base64");
      await client.from("ots_proofs").update({ status: "mined", height, proof_b64, upgraded_at: new Date().toISOString() }).eq("root", root);
      return { status: "mined", height, mode: "bitcoin" };
    }
  }

  return { status: "queued", mode: "bitcoin" };
}
