"use client";
import { useSyncExternalStore } from "react";
import { sha256Hex, verifyProof } from "./merkle";

export type Seal = {
  id: string; game: string; round: string; label: string; move: string; salt: string;
  commitment: string; sealedAt: number; status: "sealed" | "onchain";
  root?: string; proof?: string[]; txid?: string; height?: number; mode?: "testnet" | "simulated";
  revealed?: boolean;
  remote?: boolean; // synced from another device: the move and salt stay there unless the encrypted backup brings them in
  player?: string; // the per-device player id the commitment was made with
};
export type Reward = { id: string; label: string; points: number; zec: number; at: number; verified?: boolean };
export type Profile = { name: string; avatar: number; address: string };
export type State = { player: string; seals: Seal[]; ledger: Reward[]; withdrawn: number; profile: Profile };

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
export const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export const getState = () => read();
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
  const seal: Seal = { id: randomHex(6), game, round, label, move, salt, commitment, sealedAt: Date.now(), status: "sealed", player: s.player };
  write({ ...s, seals: [seal, ...s.seals].slice(0, 200) });
  if (timer) clearTimeout(timer);
  timer = setTimeout(anchorPending, 5000); // batch window; a real Zcash block takes about 25s
  return seal;
}
let anchoring = false;
/** Anchor every seal made on this device that is not on-chain yet. Safe to call often (every minute):
 * 1. seals with no batch yet are handed to the anchor service, which answers at once ("queued");
 * 2. seals whose batch is queued are checked until their transaction id comes back.
 * If the service is down the seals simply stay pending and the next call retries. */
export async function anchorPending() {
  if (anchoring) return;
  anchoring = true;
  try {
    const mine = read().seals.filter((x) => x.status === "sealed" && !x.remote);
    const fresh = mine.filter((x) => !x.root);
    if (fresh.length) {
      const r = await fetch("/api/anchor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commitments: fresh.map((p) => p.commitment) }) });
      if (r.ok) {
        const j = await r.json();
        const s = read();
        write({ ...s, seals: s.seals.map((x) => {
          const i = fresh.findIndex((p) => p.id === x.id);
          return i < 0 ? x : { ...x, root: j.root, proof: j.proofs[i], mode: j.mode, ...(j.txid ? { status: "onchain", txid: j.txid, height: j.height } : {}) };
        }) });
      }
    }
    const waiting = [...new Set(read().seals.filter((x) => x.status === "sealed" && !x.remote && x.root).map((x) => x.root!))];
    for (const root of waiting) {
      const r = await fetch(`/api/anchor?root=${root}`);
      if (!r.ok) continue;
      const j = await r.json();
      if (!j.txid && j.status !== "failed") continue;
      const s = read();
      write({ ...s, seals: s.seals.map((x) => x.root !== root || x.status !== "sealed" ? x
        : j.txid ? { ...x, status: "onchain", txid: j.txid, height: j.height, mode: j.mode }
        : { ...x, root: undefined, proof: undefined }) }); // failed: start again in a new batch
    }
  } catch {}
  finally { anchoring = false; }
}
/** Re-hash the move and salt, then walk the Merkle proof up to the anchored root. */
export async function verifySeal(seal: Seal): Promise<{ hashOk: boolean; anchored: boolean }> {
  const hashOk = (await commit(seal.player ?? read().player, seal.round, seal.move, seal.salt)) === seal.commitment;
  const anchored = seal.status === "onchain" && !!(seal.root && seal.proof && (await verifyProof(seal.commitment, seal.proof, seal.root)));
  return { hashOk, anchored };
}
/** Moves and salts recovered from the encrypted backup (sealed on another device). */
export function restoreSecrets(list: { id: string; move: string; salt: string; player: string }[]) {
  const s = read(), by = new Map(list.map((x) => [x.id, x]));
  write({ ...s, seals: s.seals.map((x) => { const v = by.get(x.id); return v && !x.move ? { ...x, move: v.move, salt: v.salt, player: v.player } : x; }) });
}
export function markRevealed(id: string) { const s = read(); write({ ...s, seals: s.seals.map((x) => (x.id === id ? { ...x, revealed: true } : x)) }); }
/** Practice points by default. Verified rewards come back from the server's claim with their own id. */
export function addReward(label: string, points: number, opts: { id?: string; verified?: boolean } = {}) {
  if (points <= 0) return;
  const s = read();
  if (opts.id && s.ledger.some((r) => r.id === opts.id)) return;
  write({ ...s, ledger: [{ id: opts.id ?? randomHex(4), label, points, zec: points / 100000, at: Date.now(), verified: opts.verified }, ...s.ledger].slice(0, 200) });
}
export function saveProfile(patch: Partial<Profile>) { const s = read(); write({ ...s, profile: { ...s.profile, ...patch } }); }
/** Fold a signed-in account's cloud copy into this device. Local data always wins for seals made here. */
export function mergeCloud(remote: { profile?: Partial<Profile>; withdrawn?: number; seals: Seal[]; ledger: Reward[] }) {
  const s = read();
  const p = remote.profile ?? {};
  const have = new Set(s.seals.map((x) => x.id)), got = new Set(s.ledger.map((x) => x.id));
  write({
    ...s,
    profile: { name: s.profile.name || p.name || "", address: s.profile.address || p.address || "", avatar: s.profile.avatar !== 1 ? s.profile.avatar : p.avatar || 1 },
    withdrawn: Math.max(s.withdrawn, remote.withdrawn ?? 0),
    seals: [...s.seals, ...remote.seals.filter((x) => !have.has(x.id))].sort((a, b) => b.sealedAt - a.sealedAt).slice(0, 200),
    ledger: [...s.ledger, ...remote.ledger.filter((x) => !got.has(x.id))].sort((a, b) => b.at - a.at).slice(0, 200),
  });
}
export const isShielded = (a: string) => /^(u|utest|zs|ztestsapling)1[a-z0-9]{20,}$/i.test(a.trim());
export function withdrawAll() { const s = read(); write({ ...s, withdrawn: s.ledger.reduce((a, r) => a + (r.verified ? r.zec : 0), 0) }); }
export const totals = (s: State) => {
  const points = s.ledger.reduce((a, r) => a + r.points, 0);
  const ranked = s.ledger.reduce((a, r) => a + (r.verified ? r.points : 0), 0);
  // Only verified rewards can carry ZEC (contest prizes); points themselves are score only.
  const earned = s.ledger.reduce((a, r) => a + (r.verified ? r.zec : 0), 0);
  return { points, ranked, earned, available: Math.max(0, earned - s.withdrawn) };
};
export const short = (h?: string) => (h ? h.slice(0, 6) + "…" + h.slice(-4) : "");
