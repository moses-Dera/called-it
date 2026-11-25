// Anchors Merkle roots on Bitcoin via the free public OpenTimestamps calendars.
// No wallet, no server, no fees — the calendars batch thousands of hashes and pay the Bitcoin tx fee.
//
// Two-step process (Bitcoin blocks take ~10 min; calendars commit every few hours):
//   stampRoot(root)  → submits the root to the calendars, stores a standard .ots proof file, returns "queued"
//   checkRoot(root)  → asks each calendar for its Bitcoin attestation; once found, merges it into the proof
//                      and returns "mined" with the block height
// The stored proof verifies with the reference client: `ots verify -d <root> proof.ots`.
//
// Simulated mode (SUPABASE_SERVICE_ROLE_KEY unset): instantly returns "mined" with a fake txid, clearly labelled.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type AnchorState = {
  status: "queued" | "mined" | "failed";
  txid?: string;
  height?: number;
  error?: string;
  mode: "bitcoin" | "simulated";
};

const CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://alice.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];
const TIMEOUT_MS = 12_000;

// ---------- OpenTimestamps binary format ----------
const FILE_HEADER = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");
const OP_SHA256 = 0x08;
const PENDING = "83dfe30d2ef90c8e";
const BITCOIN = "0588960d73d71901";

function varuint(b: Buffer, pos: number): [number, number] {
  let value = 0, shift = 0;
  for (;;) {
    if (pos >= b.length) throw new Error("truncated varuint");
    const byte = b[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, pos];
    shift += 7;
  }
}
function varbytes(b: Buffer, pos: number): [Buffer, number] {
  const [len, p] = varuint(b, pos);
  if (p + len > b.length) throw new Error("truncated bytes");
  return [b.subarray(p, p + len), p + len];
}

/** An attestation leaf in a serialized timestamp, with its byte range so it can be replaced. */
type Leaf = { tag: string; payload: Buffer; msg: Buffer; start: number; end: number };

function step(b: Buffer, pos: number, tag: number, msg: Buffer, out: Leaf[]): number {
  if (tag === 0x00) {
    const start = pos - 1;
    if (pos + 8 > b.length) throw new Error("truncated attestation");
    const t = b.subarray(pos, pos + 8).toString("hex");
    const [payload, end] = varbytes(b, pos + 8);
    out.push({ tag: t, payload, msg, start, end });
    return end;
  }
  let next: Buffer;
  if (tag === 0xf0 || tag === 0xf1) {
    const [arg, p] = varbytes(b, pos);
    next = tag === 0xf0 ? Buffer.concat([msg, arg]) : Buffer.concat([arg, msg]);
    pos = p;
  } else if (tag === OP_SHA256) next = createHash("sha256").update(msg).digest();
  else if (tag === 0x02) next = createHash("sha1").update(msg).digest();
  else if (tag === 0x03) next = createHash("ripemd160").update(msg).digest();
  else throw new Error(`unsupported op 0x${tag.toString(16)}`);
  return walk(b, pos, next, out);
}

/** Walk a serialized timestamp starting at `pos` for message `msg`; collects every attestation. */
function walk(b: Buffer, pos: number, msg: Buffer, out: Leaf[]): number {
  for (;;) {
    if (pos >= b.length) throw new Error("truncated timestamp");
    const tag = b[pos++];
    if (tag !== 0xff) return step(b, pos, tag, msg, out);
    pos = step(b, pos + 1, b[pos], msg, out); // fork: one branch, then keep reading siblings
  }
}

/** Offset of the timestamp inside a .ots file (after header, version and the sha256 digest). */
function timestampOffset(file: Buffer): number {
  if (!file.subarray(0, FILE_HEADER.length).equals(FILE_HEADER)) return -1;
  const [, p] = varuint(file, FILE_HEADER.length);
  if (file[p] !== OP_SHA256) throw new Error("unexpected file hash op");
  return p + 1 + 32;
}

function leavesOf(file: Buffer, root: Buffer): { leaves: Leaf[]; offset: number } {
  let offset = timestampOffset(file);
  // Proofs stored before the .ots file format were the bare calendar response.
  if (offset < 0) offset = 0;
  const leaves: Leaf[] = [];
  walk(file, offset, root, leaves);
  return { leaves, offset };
}

const heightOf = (leaf: Leaf) => varuint(leaf.payload, 0)[0];
const calendarOf = (leaf: Leaf) => varbytes(leaf.payload, 0)[0].toString("utf8").replace(/\/+$/, "");

// ---------- Calendar calls ----------
async function post(calendar: string, digest: Buffer): Promise<Buffer | null> {
  try {
    const r = await fetch(`${calendar}/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Accept: "application/vnd.opentimestamps.v1" },
      body: new Uint8Array(digest),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const body = Buffer.from(await r.arrayBuffer());
    walk(body, 0, digest, []); // reject anything that isn't a well-formed timestamp
    return body;
  } catch { return null; }
}

async function upgrade(calendar: string, commitment: Buffer): Promise<Buffer | null> {
  try {
    const r = await fetch(`${calendar}/timestamp/${commitment.toString("hex")}`, {
      headers: { Accept: "application/vnd.opentimestamps.v1" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return null; // 404 until the calendar has committed to Bitcoin
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Stamp the root on the calendars and persist the proof. Returns "queued", or null if none answered. */
export async function stampRoot(root: string): Promise<AnchorState | null> {
  const client = db();
  if (!client) return { status: "mined", txid: "sim-" + root.slice(0, 16), height: 870000 + Math.floor(Date.now() / 600_000), mode: "simulated" };

  const { data: existing } = await client.from("ots_proofs").select("status,height").eq("root", root).maybeSingle();
  if (existing?.status === "mined") return { status: "mined", height: existing.height ?? undefined, mode: "bitcoin" };
  if (existing?.status === "queued") return { status: "queued", mode: "bitcoin" };

  const digest = Buffer.from(root, "hex");
  const answers = (await Promise.all(CALENDARS.map((c) => post(c, digest)))).filter((x): x is Buffer => !!x);
  if (!answers.length) return null;

  // One branch per calendar: every branch but the last is prefixed with the 0xff fork marker.
  const timestamp = Buffer.concat(answers.flatMap((a, i) => (i < answers.length - 1 ? [Buffer.from([0xff]), a] : [a])));
  const file = Buffer.concat([FILE_HEADER, Buffer.from([0x01, OP_SHA256]), digest, timestamp]);
  const { error } = await client.from("ots_proofs").upsert({ root, proof_b64: file.toString("base64"), status: "queued" });
  if (error) return null;
  return { status: "queued", mode: "bitcoin" };
}

/** Check whether a stamped root has been committed to a Bitcoin block yet. */
export async function checkRoot(root: string): Promise<AnchorState | null> {
  const client = db();
  if (!client) return null;

  const { data } = await client.from("ots_proofs").select("status,height,proof_b64").eq("root", root).maybeSingle();
  if (!data) return { status: "failed", error: "unknown root", mode: "bitcoin" };
  if (data.status === "mined") return { status: "mined", height: data.height ?? undefined, mode: "bitcoin" };

  let file = Buffer.from(data.proof_b64, "base64");
  let parsed: ReturnType<typeof leavesOf>;
  try { parsed = leavesOf(file, Buffer.from(root, "hex")); }
  catch (e) { return { status: "failed", error: `unreadable proof: ${e instanceof Error ? e.message : e}`, mode: "bitcoin" }; }

  const done = parsed.leaves.find((l) => l.tag === BITCOIN);
  if (done) return { status: "mined", height: heightOf(done), mode: "bitcoin" };

  // Ask only calendars we chose; never follow a URL read out of stored data.
  const pending = parsed.leaves.filter((l) => l.tag === PENDING && CALENDARS.includes(calendarOf(l)));
  for (const leaf of pending) {
    const reply = await upgrade(calendarOf(leaf), leaf.msg);
    if (!reply) continue;
    const found: Leaf[] = [];
    try { walk(reply, 0, leaf.msg, found); } catch { continue; }
    const btc = found.find((l) => l.tag === BITCOIN);
    if (!btc) continue;

    const height = heightOf(btc);
    // Swap the pending attestation for the calendar's path to the Bitcoin block header.
    file = Buffer.concat([file.subarray(0, leaf.start), reply, file.subarray(leaf.end)]);
    await client.from("ots_proofs").update({ status: "mined", height, proof_b64: file.toString("base64"), upgraded_at: new Date().toISOString() }).eq("root", root);
    return { status: "mined", height, mode: "bitcoin" };
  }

  return { status: "queued", mode: "bitcoin" };
}
