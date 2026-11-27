import type { Network } from "./zaddr";

/** Which wallet apps to recommend, by network. Zashi is mainnet-only; Zingo and Zkool also do testnet. */
export function walletAdvice(network: Network) {
  return network === "testnet"
    ? {
        name: "Zingo or Zkool",
        apps: [{ name: "Zingo", url: "https://zingolabs.org/" }, { name: "Zkool", url: "https://hhanh00.github.io/zkool2/" }],
        setup: "Switch the wallet to Testnet in its settings, then copy its testnet address (utest1…).",
        faucet: { name: "fauzec.com", url: "https://fauzec.com/" },
      }
    : {
        name: "Zashi",
        apps: [{ name: "Zashi", url: "https://electriccoin.co/zashi/" }],
        setup: "Open Zashi and copy your address (u1…).",
        faucet: null,
      };
}
