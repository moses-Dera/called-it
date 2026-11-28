"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { WalletClient } from "@zcashlabs/zcash.js";
import { addressOf, balanceOf, openWallet, walletExists, syncWallet, zecOf } from "./in-app-wallet";
import { detectPrizes } from "./wallet-prizes";
import { cloudRpc, type SponsorPrize } from "./cloud";
import type { Network } from "./zaddr";

type WalletState = {
  status: "idle" | "opening" | "syncing" | "ready" | "error";
  address: string | null;
  balance: { total: bigint; spendable: bigint } | null;
  accountId: string | null;
  height: number | null;
  error: string | null;
  lastSync: number | null;
};

const SYNC_INTERVAL = 90_000;
const initial: WalletState = { status: "idle", address: null, balance: null, accountId: null, height: null, error: null, lastSync: null };

let state: WalletState = initial;
let wallet: WalletClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let syncing = false;
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      if (!granted) console.info("[wallet] Persistent storage not granted — data may be evicted after inactivity.");
    }
  } catch {}
}

async function doSync(network: Network) {
  if (syncing) return;
  syncing = true;
  try {
    if (!wallet) {
      set({ status: "opening" });
      wallet = await openWallet(network);
    }
    const [acct] = await wallet.accounts.list();
    if (!acct) { set({ status: "ready", accountId: null }); syncing = false; return; }

    set({ status: "syncing", accountId: acct.id });
    const s = await syncWallet(wallet) as { scan?: { fullyScannedHeight?: number } };
    const h = s?.scan?.fullyScannedHeight ?? null;
    const addr = await addressOf(wallet, acct.id);
    const bal = await balanceOf(wallet, acct.id);
    set({ status: "ready", address: addr, balance: bal, height: h, error: null, lastSync: Date.now() });

    try {
      const prizes = await cloudRpc<SponsorPrize[]>("my_sponsor_prizes");
      if (prizes?.length) await detectPrizes(wallet, acct.id, prizes);
    } catch {}
  } catch (e) {
    set({ status: "error", error: (e as Error).message ?? String(e) });
  }
  syncing = false;
}

function startBackground(network: Network) {
  if (timer) return;
  doSync(network);
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    doSync(network);
  }, SYNC_INTERVAL);
}

function stopBackground() {
  if (timer) { clearInterval(timer); timer = null; }
}

/** True when this device has a wallet for this network. */
export function hasWallet(network: Network) { return walletExists(network); }

export function getWallet() { return wallet; }

export function useWalletSync(network: Network, enabled = true) {
  useEffect(() => {
    if (!enabled || !hasWallet(network)) return;
    requestPersistence();
    startBackground(network);
    const onVis = () => {
      if (document.visibilityState === "visible" && state.lastSync && Date.now() - state.lastSync > SYNC_INTERVAL) doSync(network);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); stopBackground(); };
  }, [network, enabled]);

  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => initial,
  );
}

export function triggerSync(network: Network) { doSync(network); }

export { zecOf };
