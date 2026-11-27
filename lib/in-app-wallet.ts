"use client";
// The in-app Called It wallet: a shielded Zcash wallet that runs entirely in the player's browser.
// Keys and wallet data stay on the device (browser private storage); Called It's servers never see them.
// The browser reaches the Zcash network through ChainSafe's gRPC-web relays, since browsers can't speak
// plain gRPC to lightwalletd.
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { WalletClient, WalletEndpointOptions } from "@zcashlabs/zcash.js";
import type { Network } from "./zaddr";

const RELAY: Record<Network, string> = {
  testnet: "https://zcash-testnet.chainsafe.dev",
  mainnet: "https://zcash-mainnet.chainsafe.dev",
};

async function params(network: Network) {
  const { blockHash, encodeNetworkParameters } = await import("@zcashlabs/zcash.js");
  return network === "testnet"
    ? { identity: "zcash-testnet", genesisHash: blockHash("05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38"),
        ...encodeNetworkParameters({ encoding: "test", Overwinter: 207500, Sapling: 280000, Blossom: 584000, Heartwood: 903800, Canopy: 1028500,
          Nu5: 1842420, Nu6: 2976000, Nu6_1: 3536500, Nu6_2: 4052000, Nu6_3: 4134000, Nu7: 4465026 }) }
    : { identity: "zcash", genesisHash: blockHash("00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08"),
        ...encodeNetworkParameters({ encoding: "main", Overwinter: 347500, Sapling: 419200, Blossom: 653600, Heartwood: 903000, Canopy: 1046400,
          Nu5: 1687104, Nu6: 2726400, Nu6_1: 3379200, Nu6_2: 3523200, Nu6_3: 3540000, Nu7: 3543405 }) };
}

const POLICY = {
  spendPools: ["ironwood"], transparent: "disallow", changePool: "ironwood", feeRule: "zip317-standard",
  confirmations: { trusted: 1, untrusted: 3, allowZeroConfirmationShielding: false },
  expiry: { kind: "offset", blocks: 80 }, lockExpiryBlocks: 20, shieldingThreshold: BigInt(10000),
  freshness: { mode: "catch-up", maxLagBlocks: 1, timeoutMs: 90_000 },
} as const;
const IRONWOOD = { format: "unified", transparent: "omit", sapling: "omit", ironwood: "require" } as const;

/** Engine version folder under /zcash/ (see scripts/copy-zcash-assets.mjs). */
const ENGINE = "ea08c661";

const PHRASE_KEY = (n: Network) => `calledit:wallet-phrase:${n}`;

export const newPhrase = () => generateMnemonic(wordlist, 256);
export const isPhrase = (p: string) => validateMnemonic(p.trim().toLowerCase().replace(/\s+/g, " "), wordlist);

/** Open (or create the storage for) this device's wallet on a network. */
export async function openWallet(network: Network): Promise<WalletClient> {
  // The engine (WebAssembly + workers) is served from this site's /zcash/ folder; it is verified by hash on load.
  (globalThis as { __CALLEDIT_ZCASH_ASSETS__?: string }).__CALLEDIT_ZCASH_ASSETS__ = `${location.origin}/zcash/${ENGINE}/`;
  const { createWalletClient } = await import("@zcashlabs/zcash.js");
  return createWalletClient(RELAY[network], {
    network: await params(network),
    storage: { kind: "browser-opfs", name: `calledit-${network}` },
    transactionPolicy: POLICY,
  } as unknown as WalletEndpointOptions);
}

export const savedPhrase = (network: Network) => { try { return localStorage.getItem(PHRASE_KEY(network)); } catch { return null; } };

/** Create the wallet's account from a new or restored phrase. Syncs to the tip first, so a new wallet starts there. */
export async function createAccount(wallet: WalletClient, network: Network, phrase: string) {
  const clean = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!isPhrase(clean)) throw new Error("That recovery phrase isn't valid.");
  const [existing] = await wallet.accounts.list();
  if (existing) return existing;
  await wallet.sync();
  const mnemonic = new TextEncoder().encode(clean);
  try {
    const created = await wallet.accounts.create({ mnemonic, name: `called-it-${network}` });
    await created.signer.dispose();
    try { localStorage.setItem(PHRASE_KEY(network), clean); } catch { /* the player keeps their own copy */ }
    return created.account;
  } finally { mnemonic.fill(0); }
}

export async function addressOf(wallet: WalletClient, accountId: string) {
  return (await wallet.addresses.current({ accountId, request: IRONWOOD } as never))
    ?? (await wallet.addresses.next({ accountId, request: IRONWOOD } as never)).address;
}

/** Sync to the chain tip, retrying when the connection drops (progress is kept between tries). */
export async function syncWallet(wallet: WalletClient, onStatus?: (s: unknown) => void, tries = 20) {
  for (let i = 1; ; i++) {
    try {
      const s = await wallet.sync();
      onStatus?.(s);
      return s;
    } catch (e) {
      const retry = (e as { retryable?: boolean }).retryable;
      if (!retry || i >= tries) throw e;
      onStatus?.({ retrying: i });
      await new Promise((r) => setTimeout(r, Math.min(2000 * i, 15000)));
    }
  }
}

/** Spendable and total balance in zatoshis. */
export async function balanceOf(wallet: WalletClient, accountId: string) {
  const b = await wallet.getBalance({ accountId } as never) as { amounts?: { total: bigint; ironwood: { spendable: bigint } } };
  return b.amounts ? { total: b.amounts.total, spendable: b.amounts.ironwood.spendable } : null;
}

export const zecOf = (zats: bigint) => (Number(zats) / 1e8).toFixed(8).replace(/\.?0+$/, "") || "0";
