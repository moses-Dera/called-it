import type { Network } from "./zaddr";

/** A public block explorer page for a Zcash transaction: proof that a payment happened and when. */
export const explorerTx = (txid: string, network: Network) => `https://blockexplorer.one/zcash/${network === "testnet" ? "testnet" : "mainnet"}/tx/${txid}`;
