import { sha256Hex } from "./merkle";
// Anchors one Merkle root on Zcash.
// - ANCHOR_URL set: calls the anchor service (services/anchor, zcash.js on testnet). If it is down,
//   returns null so the seals stay pending and the browser retries later. They are never faked.
// - ANCHOR_URL unset (local demo): returns a clearly labelled simulation.
export type Anchor = { txid: string; height: number; mode: "testnet" | "simulated" };
export async function anchorRoot(root: string): Promise<Anchor | null> {
  const url = process.env.ANCHOR_URL;
  if (url) try {
    const r = await fetch(`${url.replace(/\/$/, "")}/anchor`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ANCHOR_TOKEN ?? ""}` },
      body: JSON.stringify({ root }),
      signal: AbortSignal.timeout(120_000), // a send syncs the wallet and builds a proof first
    });
    if (r.ok) { const j = await r.json(); return { txid: j.txid, height: j.height ?? 0, mode: "testnet" }; }
    console.error("anchor service replied", r.status);
    return null;
  } catch (e) { console.error("anchor service unreachable", e); return null; }
  const txid = await sha256Hex("sim-tx|" + root);
  // NU7 activated at block 3,543,405 on 6 Nov 2026 with 25s blocks; estimate a plausible height.
  const height = 3543405 + Math.floor((Date.now() - Date.UTC(2026, 10, 6, 2, 34)) / 25000);
  return { txid, height, mode: "simulated" };
}
