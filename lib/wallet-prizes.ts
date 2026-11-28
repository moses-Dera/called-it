"use client";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { confirmPrize, type SponsorPrize } from "./cloud";

type Memo = { kind: "text"; text: string } | { kind: "empty" | "unknown" } | { kind: "binary"; bytes: Uint8Array };
type TxOutput = { value: bigint | null; memo: Memo; receivingAccountIds: readonly string[] };
type WalletTx = { txid: { toString(): string }; outputs: readonly TxOutput[] };
type HistoryEntry = { txid: { toString(): string }; balanceDelta: bigint; totalReceived: bigint };

const MEMO_RE = /Called It · (.+?) · #(\d+) prize/;

/** After a sync, check received transactions for prize memos and auto-confirm. */
export async function detectPrizes(wallet: WalletClient, accountId: string, myPrizes: SponsorPrize[]) {
  const pending = myPrizes.filter((p) => p.status === "sent" || p.status === "pending");
  if (!pending.length) return [];

  const history = await wallet.getHistory({ accountId } as never) as unknown as { items: readonly HistoryEntry[] };
  const confirmed: { contestId: string; rank: number; txid: string }[] = [];

  for (const entry of history.items) {
    if (entry.totalReceived <= BigInt(0)) continue;
    const tx = await wallet.getTransaction({ txid: entry.txid } as never) as WalletTx | null;
    if (!tx) continue;

    for (const out of tx.outputs) {
      if (out.memo.kind !== "text") continue;
      const m = MEMO_RE.exec(out.memo.text);
      if (!m) continue;
      const rank = parseInt(m[2], 10);
      const prize = pending.find((p) => p.rank === rank && out.memo.kind === "text" && out.memo.text.includes(p.title));
      if (!prize) continue;
      const txid = String(tx.txid);
      try {
        await confirmPrize(prize.contest_id, rank, true);
        confirmed.push({ contestId: prize.contest_id, rank, txid });
      } catch {}
    }
  }
  return confirmed;
}

const IRONWOOD = { format: "unified", transparent: "omit", sapling: "omit", ironwood: "require" } as const;

/** Get a fresh diversified address for receiving a specific prize. */
export async function freshPrizeAddress(wallet: WalletClient, accountId: string): Promise<string> {
  const rec = await wallet.addresses.next({ accountId, request: IRONWOOD } as never);
  return rec.address;
}
