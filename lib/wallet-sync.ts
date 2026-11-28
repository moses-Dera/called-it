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
  missingAccount: boolean;
};

const SYNC_INTERVAL = 90_000;
const RETRY_DELAYS = [15_000, 30_000, 60_000];
const initial: WalletState = { status: "idle", address: null, balance: null, accountId: null, height: null, error: null, lastSync: null, missingAccount: false };

let state: WalletState = initial;
let wallet: WalletClient | null = null;
let walletNet: Network | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failCount = 0;
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
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  syncing = true;
  try {
    if (wallet && walletNet !== network) {
      wallet = null;
      walletNet = null;
      set({ address: null, balance: null, accountId: null, height: null, error: null, missingAccount: false });
    }
    if (!wallet) {
      set({ status: "opening", error: null, missingAccount: false });
      wallet = await openWallet(network);
      walletNet = network;
    }
    const [acct] = await wallet.accounts.list();
    if (!acct) {
      set({ status: "ready", accountId: null, address: null, balance: null, height: null, error: null, missingAccount: true });
      return;
    }

    // Read cached OPFS address & balance immediately so the UI renders even before the relay answers.
    const addr = state.address ?? await addressOf(wallet, acct.id);
    const bal = await balanceOf(wallet, acct.id);
    set({ status: "syncing", accountId: acct.id, address: addr, balance: bal, error: null, missingAccount: false });

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      set({ status: "error", error: "Offline" });
      return;
    }

    const s = await syncWallet(wallet, undefined, 2) as { scan?: { fullyScannedHeight?: number } };
    const h = s?.scan?.fullyScannedHeight ?? null;
    const freshAddr = await addressOf(wallet, acct.id);
    const freshBal = await balanceOf(wallet, acct.id);
    failCount = 0;
    set({ status: "ready", address: freshAddr, balance: freshBal, height: h, error: null, lastSync: Date.now(), missingAccount: false });

    try {
      const prizes = await cloudRpc<SponsorPrize[]>("my_sponsor_prizes");
      if (prizes?.length) await detectPrizes(wallet, acct.id, prizes);
    } catch {}
  } catch (e) {
    failCount += 1;
    set({ status: "error", error: (e as Error).message ?? String(e) });
    if (failCount <= RETRY_DELAYS.length && (typeof navigator === "undefined" || navigator.onLine)) {
      retryTimer = setTimeout(() => { retryTimer = null; doSync(network); }, RETRY_DELAYS[failCount - 1]);
    }
  } finally {
    syncing = false;
  }
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
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
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
    const onOnline = () => { failCount = 0; doSync(network); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      stopBackground();
    };
  }, [network, enabled]);

  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => initial,
  );
}

export function triggerSync(network: Network) { failCount = 0; doSync(network); }

export { zecOf };
