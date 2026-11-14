import { sha256Hex } from "./merkle";
// Anchors one Merkle root on Zcash. If ANCHOR_URL is set, it calls the anchor service
// (services/anchor, zingo-cli on testnet). If that is unset or fails, it returns a clearly labelled simulation.
export type Anchor = { txid: string; height: number; mode: "testnet" | "simulated" };
export async function anchorRoot(root: string): Promise<Anchor> {
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
  } catch (e) { console.error("anchor service unreachable", e); }
  const txid = await sha256Hex("sim-tx|" + root);
  // NU7 activated at block 3,543,405 on 6 Nov 2026 with 25s blocks; estimate a plausible height.
  const height = 3543405 + Math.floor((Date.now() - Date.UTC(2026, 10, 6, 2, 34)) / 25000);
  return { txid, height, mode: "simulated" };
}
