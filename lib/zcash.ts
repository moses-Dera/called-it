import { sha256Hex } from "./merkle";
// Anchors Merkle roots on Zcash. Anchoring takes minutes, so it is two calls: hand the root over, then
// ask about it later.
// - ANCHOR_URL set: the anchor service (services/anchor, zcash.js on testnet). If it is down these
//   return null, so the seals stay pending and the browser retries. They are never faked.
// - ANCHOR_URL unset (local demo): a clearly labelled simulation, "mined" at once.
export type AnchorState = { status: "queued" | "sent" | "mined" | "failed"; txid?: string; height?: number; error?: string; mode: "testnet" | "simulated" };

const base = () => process.env.ANCHOR_URL?.replace(/\/$/, "");
const auth = () => ({ authorization: `Bearer ${process.env.ANCHOR_TOKEN ?? ""}` });

async function call(path: string, init: RequestInit = {}): Promise<AnchorState | null> {
  try {
    const r = await fetch(`${base()}${path}`, { ...init, headers: { "content-type": "application/json", ...auth() }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) return null;
    if (!r.ok) { console.error("anchor service replied", r.status); return null; }
    const j = await r.json();
    return { status: j.status, txid: j.txid, height: j.height, error: j.error, mode: "testnet" };
  } catch (e) { console.error("anchor service unreachable", e); return null; }
}

export async function anchorRoot(root: string): Promise<AnchorState | null> {
  if (base()) return call("/anchor", { method: "POST", body: JSON.stringify({ root }) });
  const txid = await sha256Hex("sim-tx|" + root);
  // NU7 activated at block 3,543,405 on 6 Nov 2026 with 25s blocks; estimate a plausible height.
  const height = 3543405 + Math.floor((Date.now() - Date.UTC(2026, 10, 6, 2, 34)) / 25000);
  return { status: "mined", txid, height, mode: "simulated" };
}

export async function anchorStatus(root: string): Promise<AnchorState | null> {
  return base() ? call(`/anchor/${root}`) : null;
}
