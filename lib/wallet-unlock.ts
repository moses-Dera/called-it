"use client";
import { getWalletBackup } from "./cloud";
import { savedPhrase } from "./in-app-wallet";
import { decryptPhrase } from "./wallet-crypto";
import type { Network } from "./zaddr";
import { askText } from "@/components/dialog";

/**
 * Unlock the user's 24-word recovery phrase in memory for a single operation.
 * Returns null if the user cancels the passphrase prompt.
 */
export async function unlockWalletPhrase(network: Network, actionLabel: string): Promise<string | null> {
  const plain = savedPhrase(network);
  if (plain) return plain;

  const backup = await getWalletBackup();
  if (!backup) throw new Error("No wallet backup found on your account. Set up your wallet in Vault first.");
  if (backup.network && backup.network !== network) {
    throw new Error(`Your saved wallet is on ${backup.network}, while the app is on ${network}.`);
  }

  const pass = await askText({
    title: "Unlock your wallet",
    body: `Enter your wallet passphrase to ${actionLabel}.`,
    placeholder: "Wallet passphrase",
    confirmLabel: "Unlock",
    type: "password",
  });
  if (pass === null) return null;
  if (!pass) throw new Error("Enter your wallet passphrase.");

  try {
    return await decryptPhrase(
      { ciphertext: backup.ciphertext, iv: backup.iv, salt: backup.salt, kdf: "argon2id" },
      pass,
    );
  } catch {
    throw new Error("Wrong wallet passphrase.");
  }
}
