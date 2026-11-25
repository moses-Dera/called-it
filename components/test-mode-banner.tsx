"use client";
import { useNetwork } from "@/lib/cloud";

/** Shown on every screen while the admin runs the app on testnet, so nobody mistakes test coins for ZEC. */
export function TestModeBanner() {
  if (useNetwork() !== "testnet") return null;
  return (
    <div role="status" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, background: "var(--amber)", color: "#111", borderBottom: "2px solid #111", padding: "calc(4px + env(safe-area-inset-top)) 12px 4px", fontSize: 12, fontWeight: 800, textAlign: "center" }}>
      Test mode: prizes are testnet coins (TAZ), not real ZEC. Use a testnet wallet address.
    </div>
  );
}
