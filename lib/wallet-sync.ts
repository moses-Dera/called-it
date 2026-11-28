"use client";
import { useEffect, useSyncExternalStore } from "react";
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

// Sync at most every 5 minutes in the background on Vault; WASM catch-up is single-threaded and CPU-heavy.
const SYNC_INTERVAL = 300_000;
const MOUNT_DELAY_MS = 1_200;
const RETRY_DELAYS = [15_000, 30_000, 60_000];
const initial: WalletState = { status: "idle", address: null, balance: null, accountId: null, height: null, error: null, lastSync: null, missingAccount: false };

let state: WalletState = initial;
let wallet: WalletClient | null = null;
let walletNet: Network | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failCount = 0;
let syncing = false;
let autoSyncHolders = 0;
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

async function ensureLocal(network: Network) {
  if (wallet && walletNet !== network) {
    wallet = null;
    walletNet = null;
    set({ address: null, balance: null, accountId: null, height: null, error: null, lastSync: null, missingAccount: false });
  }
  if (!wallet) {
    set({ status: state.address ? state.status : "opening", error: null, missingAccount: false });
    wallet = await openWallet(network);
    walletNet = network;
  }
  const [acct] = await wallet.accounts.list();
  if (!acct) {
    set({ status: "ready", accountId: null, address: null, balance: null, height: null, error: null, missingAccount: true });
    return null;
  }
  const addr = state.address ?? await addressOf(wallet, acct.id);
  const bal = await balanceOf(wallet, acct.id);
  set({
    status: state.status === "opening" || state.status === "idle" ? "ready" : state.status,
    accountId: acct.id,
    address: addr,
    balance: bal,
    missingAccount: false,
  });
  return acct;
}

/** Read address & balance from local OPFS storage with zero network/WASM block scanning. */
async function loadCached(network: Network) {
  if (syncing) return;
  try { await ensureLocal(network); }
  catch (e) { set({ status: "error", error: (e as Error).message ?? String(e) }); }
}

async function doSync(network: Network) {
  if (syncing) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  syncing = true;
  try {
    const acct = await ensureLocal(network);
    if (!acct || !wallet) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      set({ status: "error", error: "Offline" });
      return;
    }

    set({ status: "syncing", error: null });
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
  autoSyncHolders += 1;
  if (timer || startTimer) return;
  const fresh = !!state.lastSync && Date.now() - state.lastSync < SYNC_INTERVAL;
  if (fresh) {
    loadCached(network);
  } else {
    loadCached(network);
    startTimer = setTimeout(() => { startTimer = null; doSync(network); }, MOUNT_DELAY_MS);
  }
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    doSync(network);
  }, SYNC_INTERVAL);
}

function stopBackground() {
  autoSyncHolders = Math.max(0, autoSyncHolders - 1);
  if (autoSyncHolders > 0) return;
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  if (timer) { clearInterval(timer); timer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

/** True when this device has a wallet for this network. */
export function hasWallet(network: Network) { return walletExists(network); }

export function getWallet() { return wallet; }

/** Subscribe to wallet state. Pass autoSync=false on non-wallet screens so WASM sync only runs on Vault or on demand. */
export function useWalletSync(network: Network, enabled = true, autoSync = true) {
  useEffect(() => {
    if (!enabled || !hasWallet(network)) return;
    if (!autoSync) {
      loadCached(network);
      return;
    }
    requestPersistence();
    startBackground(network);
    const onVis = () => {
      if (document.visibilityState === "visible" && (!state.lastSync || Date.now() - state.lastSync > SYNC_INTERVAL)) doSync(network);
    };
    const onOnline = () => { failCount = 0; doSync(network); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      stopBackground();
    };
  }, [network, enabled, autoSync]);

  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => initial,
  );
}

export function triggerSync(network: Network) {
  if (startTimer) { clearTimeout(startTimer); startTimer = null; }
  failCount = 0;
  return doSync(network);
}

export { zecOf };
