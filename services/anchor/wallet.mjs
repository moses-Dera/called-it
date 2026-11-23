// Shared wallet setup for the payout CLI.
// Uses zcash.js: a light client against a public lightwalletd server, no full node and no Rust build.
//
// Network is controlled by ZCASH_NETWORK env var:
//   ZCASH_NETWORK=testnet (default) — TAZ, connects to testnet.zec.rocks
//   ZCASH_NETWORK=mainnet          — real ZEC, connects to mainnet.zec.rocks
//
// Wallets are stored in SEPARATE directories so testnet and mainnet can never mix.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { blockHash, createWalletClient, encodeNetworkParameters } from "@zcashlabs/zcash.js";

const env = process.env;
export const NETWORK = (env.ZCASH_NETWORK ?? "testnet") === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Default lightwalletd servers (override with ZCASH_SERVER).
const DEFAULT_SERVER = IS_MAINNET ? "https://mainnet.zec.rocks:443" : "https://testnet.zec.rocks:443";
export const SERVER = env.ZCASH_SERVER ?? DEFAULT_SERVER;

// Wallets live in SEPARATE dirs so testnet keys can never accidentally pay mainnet addresses.
const DEFAULT_DATA_DIR = join(homedir(), ".called-it", IS_MAINNET ? "mainnet-wallet" : "testnet-wallet");
export const DATA = env.ANCHOR_DATA_DIR ?? DEFAULT_DATA_DIR;
const SEED_FILE = join(DATA, "mnemonic.txt");

// Network parameters.
// Testnet: NU7 (Ironwood) activated at block 4,465,026.
const TESTNET_PARAMS = {
  identity: "zcash-testnet",
  genesisHash: blockHash("05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38"),
  ...encodeNetworkParameters({
    encoding: "test", Overwinter: 207500, Sapling: 280000, Blossom: 584000, Heartwood: 903800, Canopy: 1028500,
    Nu5: 1842420, Nu6: 2976000, Nu6_1: 3536500, Nu6_2: 4052000, Nu6_3: 4134000, Nu7: 4465026,
  }),
};
// Mainnet: NU7 (Ironwood) activated at block 3,543,405 (November 2026).
const MAINNET_PARAMS = {
  identity: "zcash",
  genesisHash: blockHash("00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08"),
  ...encodeNetworkParameters({
    encoding: "main", Overwinter: 347500, Sapling: 419200, Blossom: 653600, Heartwood: 903000, Canopy: 1046400,
    Nu5: 1687104, Nu6: 2726400, Nu6_1: 3379200, Nu6_2: 3523200, Nu6_3: 3540000, Nu7: 3543405,
  }),
};

export const NETWORK_PARAMS = IS_MAINNET ? MAINNET_PARAMS : TESTNET_PARAMS;

const POLICY = {
  spendPools: ["ironwood"], transparent: "disallow", changePool: "ironwood", feeRule: "zip317-standard",
  confirmations: { trusted: 1, untrusted: 3, allowZeroConfirmationShielding: false },
  expiry: { kind: "offset", blocks: 80 }, lockExpiryBlocks: 20, shieldingThreshold: 10000n,
  freshness: { mode: "catch-up", maxLagBlocks: 1, timeoutMs: 90_000 },
};
export const IRONWOOD = { format: "unified", transparent: "omit", sapling: "omit", ironwood: "require" };

export async function openWallet() {
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  return createWalletClient(SERVER, { network: NETWORK_PARAMS, storage: { kind: "node-filesystem", path: join(DATA, "db") }, transactionPolicy: POLICY });
}

/** The 24-word phrase: ANCHOR_MNEMONIC if set, otherwise the file written by `init`. */
export async function readMnemonic() {
  const phrase = env.ANCHOR_MNEMONIC?.trim() || (await readFile(SEED_FILE, "utf8").catch(() => "")).trim();
  if (!phrase) throw new Error(`No wallet phrase. Run "npm run init-wallet" first (looked in ANCHOR_MNEMONIC and ${SEED_FILE}).`);
  return phrase;
}
export async function saveMnemonic(phrase) {
  await writeFile(SEED_FILE, phrase + "\n", { mode: 0o600, flag: "wx" });
  await chmod(SEED_FILE, 0o600);
  return SEED_FILE;
}

export async function unlock(wallet) {
  const [account] = await wallet.accounts.list();
  if (!account) throw new Error(`The wallet in ${DATA} has no account. Run "npm run init-wallet" first.`);
  const mnemonic = new TextEncoder().encode(await readMnemonic());
  try {
    const signer = await wallet.accounts.restoreSigner({ accountId: account.id, mnemonic });
    const binding = await wallet.accounts.attachSigner({ accountId: account.id, signer });
    if (binding.state !== "ready") throw new Error("The wallet account needs signer recovery.");
    return { account, signer, binding };
  } finally {
    mnemonic.fill(0);
  }
}

export async function addressOf(wallet, accountId) {
  return (await wallet.addresses.current({ accountId, request: IRONWOOD })) ?? (await wallet.addresses.next({ accountId, request: IRONWOOD })).address;
}

export const zec = (zats) => (Number(zats) / 1e8).toFixed(8);
export const describe = (e) => (e?.code ? `${e.code}${e.stage ? " (" + e.stage + ")" : ""}: ${e.message}` : String(e?.message ?? e));
