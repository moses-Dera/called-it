"use client";
import { useWalletSync, hasWallet, triggerSync } from "@/lib/wallet-sync";
import { useNetwork } from "@/lib/cloud";
import { zecOf } from "@/lib/in-app-wallet";

export function WalletStatus() {
  const network = useNetwork();
  const has = hasWallet(network);
  const ws = useWalletSync(network, has);
  if (!has) return null;
  const unit = network === "testnet" ? "TAZ" : "ZEC";
  const bal = ws.balance ? `${zecOf(ws.balance.spendable)} ${unit}` : null;
  const dot = ws.status === "syncing" || ws.status === "opening" || ws.missingAccount || ws.status === "error" ? "var(--amber)" : "var(--lime)";
  const label = ws.missingAccount ? "Wallet not on device"
    : ws.status === "opening" ? "Opening wallet…"
    : ws.status === "syncing" ? (bal ? `${bal} · Syncing` : "Syncing…")
    : ws.status === "error" ? (bal ? `${bal} · Tap to sync` : "Offline · Tap to sync")
    : bal ?? "Wallet ready";

  if (ws.status === "error" || ws.missingAccount) {
    return (
      <button type="button" onClick={() => triggerSync(network)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, background: "transparent", border: 0, color: "inherit", padding: 0, cursor: "pointer" }} title={ws.error ?? "Retry wallet sync"}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
        <span style={{ textDecoration: "underline" }}>{label}</span>
      </button>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <span>{label}</span>
    </div>
  );
}
