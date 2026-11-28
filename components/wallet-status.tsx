"use client";
import { useWalletSync, hasWallet } from "@/lib/wallet-sync";
import { useNetwork } from "@/lib/cloud";
import { zecOf } from "@/lib/in-app-wallet";

export function WalletStatus() {
  const network = useNetwork();
  const has = hasWallet(network);
  const ws = useWalletSync(network, has);
  if (!has) return null;
  const dot = ws.status === "syncing" || ws.status === "opening" ? "var(--amber)" : ws.status === "error" ? "#e44" : "var(--lime)";
  const label = ws.status === "opening" ? "Opening wallet…"
    : ws.status === "syncing" ? "Syncing…"
    : ws.status === "error" ? "Wallet offline"
    : ws.balance ? `${zecOf(ws.balance.spendable)} ${network === "testnet" ? "TAZ" : "ZEC"}`
    : "Wallet ready";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  );
}
