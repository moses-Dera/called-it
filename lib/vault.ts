"use client";
// Moves follow the account, not the phone. Each sealed move is handed to the server's reveal escrow
// (app/api/escrow), which encrypts it with a key only the server holds and returns it only to its owner.
// On a new device, moves sealed elsewhere are fetched back automatically, so they can be revealed there.
// Nothing for the player to set up or remember.
import { accessToken } from "./cloud";
import { getState, restoreSecrets } from "./store";

const doneName = (uid: string) => `calledit:escrowed:${uid}`;
let busy = false;

async function call(body: unknown) {
  const token = await accessToken();
  if (!token) return null;
  const r = await fetch("/api/escrow", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return r.ok ? r.json() : null;
}

/** Store this device's sealed moves in escrow, and bring in moves sealed on other devices. */
export async function syncVault(uid: string) {
  if (busy) return;
  busy = true;
  try {
    let done: string[] = [];
    try { done = JSON.parse(localStorage.getItem(doneName(uid)) ?? "[]"); } catch {}
    const seals = getState().seals;
    const todo = seals.filter((s) => s.move && !done.includes(s.id)).slice(0, 200);
    if (todo.length) {
      const r = await call({ put: todo.map((s) => ({ seal_id: s.id, move: s.move, salt: s.salt, player: s.player ?? getState().player })) });
      if (r?.stored !== undefined) {
        done = [...done, ...todo.map((s) => s.id)].slice(-1000);
        try { localStorage.setItem(doneName(uid), JSON.stringify(done)); } catch {}
      }
    }
    const missing = seals.filter((s) => !s.move).map((s) => s.id);
    if (missing.length) {
      const r = await call({ get: missing.slice(0, 200) });
      if (r?.moves?.length) restoreSecrets(r.moves);
    }
  } catch { /* try again next time */ }
  finally { busy = false; }
}
