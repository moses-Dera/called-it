"use client";
import { argon2idAsync } from "@noble/hashes/argon2";

const ARGON2_PARAMS = { t: 3, m: 65536, p: 4, dkLen: 32 };
const SALT_BYTES = 16;
const IV_BYTES = 12;

function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}
function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase), salt, ARGON2_PARAMS);
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export type EncryptedPhrase = { ciphertext: string; iv: string; salt: string; kdf: "argon2id" };

/** Encrypt a recovery phrase with a user-chosen passphrase. All values are base64. */
export async function encryptPhrase(phrase: string, passphrase: string): Promise<EncryptedPhrase> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, new TextEncoder().encode(phrase));
  return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv), salt: toBase64(salt), kdf: "argon2id" };
}

/** Decrypt a recovery phrase with the passphrase. Throws on wrong passphrase. */
export async function decryptPhrase(enc: EncryptedPhrase, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(enc.salt));
  const ct = fromBase64(enc.ciphertext);
  const iv = fromBase64(enc.iv);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, key, ct.buffer as ArrayBuffer);
  return new TextDecoder().decode(pt);
}

/** Pick n random distinct indices from a 24-word phrase for the backup quiz. */
export function quizIndices(n = 3): number[] {
  const all = Array.from({ length: 24 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n).sort((a, b) => a - b);
}
