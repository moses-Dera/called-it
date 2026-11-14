"use client";
import { useSyncExternalStore } from "react";
import { sha256Hex, verifyProof } from "./merkle";

export type Seal = {
  id: string; game: string; round: string; label: string; move: string; salt: string;
  commitment: string; sealedAt: number; status: "sealed" | "onchain";
  root?: string; proof?: string[]; txid?: string; height?: number; mode?: "testnet" | "simulated";
  revealed?: boolean;
};
export type Reward = { id: string; label: string; points: number; zec: number; at: number };
export type Profile = { name: string; avatar: number; address: string };
type State = { player: string; seals: Seal[]; ledger: Reward[]; withdrawn: number; profile: Profile };

const KEY = "calledit:v1";
const EMPTY: State = { player: "you", seals: [], ledger: [], withdrawn: 0, profile: { name: "", avatar: 1, address: "" } };
let cache: State | null = null;
const listeners = new Set<() => void>();

function read(): State {
  if (typeof window === "undefined") return EMPTY;
  if (!cache) {
    try { cache = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { cache = { ...EMPTY }; }
    if (cache!.player === "you") { cache!.player = "p_" + randomHex(6); persist(); }
  }
  return cache!;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} }
function write(next: State) { cache = next; persist(); listeners.forEach((l) => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore(): State { return useSyncExternalStore(subscribe, read, () => EMPTY); }

export function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The commitment binds player + round + move + salt, so a hash can't be copied by another player. */
export const commit = (player: string, round: string, move: string, salt: string) =>
  sha256Hex(`calledit:v1|${player}|${round}|${move}|${salt}`);

let timer: ReturnType<typeof setTimeout> | null = null;
/** Hash on this device, store locally, then anchor the batch. Only the hash leaves the device. */
export async function createSeal(game: string, round: string, move: string, label: string): Promise<Seal> {
  const s = read();
  const salt = randomHex(16);
  const commitment = await commit(s.player, round, move, salt);
  const seal: Seal = { id: randomHex(6), game, round, label, move, salt, commitment, sealedAt: Date.now(), status: "sealed" };
  write({ ...s, seals: [seal, ...s.seals].slice(0, 200) });
  if (timer) clearTimeout(timer);
  timer = setTimeout(anchorPending, 5000); // batch window; a real Zcash block takes about 25s
  return seal;
}
export async function anchorPending() {
  const pending = read().seals.filter((x) => x.status === "sealed");
  if (!pending.length) return;
  try {
    const r = await fetch("/api/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commitments: pending.map((p) => p.commitment) }) });
    if (!r.ok) return;
    const j = await r.json();
    const s = read();
    write({ ...s, seals: s.seals.map((x) => {
      const i = pending.findIndex((p) => p.id === x.id);
      return i < 0 ? x : { ...x, status: "onchain", root: j.root, proof: j.proofs[i], txid: j.txid, height: j.height, mode: j.mode };
    }) });
  } catch {}
}
/** Re-hash the move and salt, then walk the Merkle proof up to the anchored root. */
export async function verifySeal(seal: Seal): Promise<{ hashOk: boolean; anchored: boolean }> {
  const hashOk = (await commit(read().player, seal.round, seal.move, seal.salt)) === seal.commitment;
  const anchored = !!(seal.root && seal.proof && (await verifyProof(seal.commitment, seal.proof, seal.root)));
  return { hashOk, anchored };
}
export function markRevealed(id: string) { const s = read(); write({ ...s, seals: s.seals.map((x) => (x.id === id ? { ...x, revealed: true } : x)) }); }
export function addReward(label: string, points: number) {
  if (points <= 0) return;
  const s = read();
  write({ ...s, ledger: [{ id: randomHex(4), label, points, zec: points / 100000, at: Date.now() }, ...s.ledger].slice(0, 200) });
}
export function saveProfile(patch: Partial<Profile>) { const s = read(); write({ ...s, profile: { ...s.profile, ...patch } }); }
export const isShielded = (a: string) => /^(u|utest|zs|ztestsapling)1[a-z0-9]{20,}$/i.test(a.trim());
export function withdrawAll() { const s = read(); write({ ...s, withdrawn: s.ledger.reduce((a, r) => a + r.zec, 0) }); }
export const totals = (s: State) => {
  const points = s.ledger.reduce((a, r) => a + r.points, 0);
  const earned = s.ledger.reduce((a, r) => a + r.zec, 0);
  return { points, earned, available: Math.max(0, earned - s.withdrawn) };
};
export const short = (h?: string) => (h ? h.slice(0, 6) + "…" + h.slice(-4) : "");
