"use client";
import { useNetwork } from "@/lib/cloud";

/** Shown on every screen while the admin runs the app on testnet, so nobody mistakes test coins for ZEC. */
export function TestModeBanner() {
  if (useNetwork() !== "testnet") return null;
  return (
    <div role="status" className="test-banner">
      Test mode: prizes are testnet coins (TAZ), not real ZEC. Use a testnet wallet address.
    </div>
  );
}
