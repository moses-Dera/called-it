// Shared wallet setup for the anchor service and its CLI.
// Uses zcash.js: a light client against a public testnet server, so no full node and no Rust build.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createWalletClient } from "@zcashlabs/zcash.js";

const env = process.env;
export const SERVER = env.ZCASH_SERVER ?? "https://testnet.zec.rocks:443";
export const DATA = env.ANCHOR_DATA_DIR ?? join(homedir(), ".called-it", "anchor-wallet");
const SEED_FILE = join(DATA, "mnemonic.txt");
// Receive on Ironwood only: the SDK's default policy spends and keeps change in Ironwood.
export const IRONWOOD = { format: "unified", transparent: "omit", sapling: "omit", ironwood: "require" };

export async function openWallet() {
  await mkdir(DATA, { recursive: true, mode: 0o700 });
  return createWalletClient(SERVER, { network: "testnet", storage: { kind: "node-filesystem", path: join(DATA, "db") } });
}

/** The 24-word phrase: ANCHOR_MNEMONIC if set, otherwise the file written by `init`. Testnet only. */
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

/** Reopen the stored account and attach its signer so it can send. Caller disposes the returned handles. */
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
