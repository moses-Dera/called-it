#!/usr/bin/env node
// Called It anchor service: writes Merkle roots into shielded Zcash testnet memos.
// Built on zcash.js with a public light-wallet server: no full node, no Rust build.
// It keeps a wallet on disk, so it runs on a normal machine or VPS, not on Vercel.
// The web app reaches it through ANCHOR_URL and ANCHOR_TOKEN.
//
// Anchoring takes minutes (sync, proof, broadcast, mining), so requests never wait for it:
//   POST /anchor         { "root": "<64 hex>" }  -> 202 { status: "queued" } or the root's current state
//   GET  /anchor/<root>  -> { status: "queued" | "sent" | "mined" | "failed", txid?, height?, error? }
//   GET  /health         -> { ok, address, spendable, height, queued }
// All need Authorization: Bearer <ANCHOR_TOKEN>. Root states are kept in <data dir>/anchors.json.
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA, SERVER, addressOf, describe, openWallet, unlock, zec } from "./wallet.mjs";

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
const TOKEN = env.ANCHOR_TOKEN ?? "";
const ZATS = BigInt(env.ANCHOR_ZATS ?? "10000"); // sent to the wallet's own address, so only the fee is spent
const WAIT_MS = Number(env.ANCHOR_WAIT_MS ?? 90_000); // how long to wait for the first confirmation
const PER_TX = 7; // "CI1|" + 7 roots of 65 chars fits in one 512-byte memo
if (TOKEN.length < 16) { console.error("Set ANCHOR_TOKEN to a random secret of at least 16 characters."); process.exit(1); }

const wallet = await openWallet();
const { account, signer, binding } = await unlock(wallet).catch(async (e) => { await wallet.close(); console.error(describe(e)); process.exit(1); });
const ADDRESS = env.ANCHOR_ADDRESS || (await addressOf(wallet, account.id));

// A previous run may have left a signed transaction that was never broadcast. Send it now.
for (const op of (await wallet.operations.list({ accountId: account.id })).items) {
  if (op.phase !== "ready") continue;
  try { await resumeAndBroadcast(op.operationId); console.log("broadcast a transaction left from an earlier run:", op.steps.at(-1)?.txid); }
  catch (e) { console.warn("could not broadcast leftover operation", op.operationId, describe(e)); }
}

/** Scan while waiting so the payment can be observed, as the SDK docs require. */
async function waitForConfirmation(pending) {
  const stop = new AbortController();
  const watching = (async () => { for await (const status of wallet.watchSync({ signal: stop.signal })) void status; throw new Error("sync watcher ended"); })();
  const waiting = pending.wait({ confirmations: 1, timeoutMs: WAIT_MS, signal: stop.signal });
  try { return await Promise.race([watching, waiting]); }
  finally { stop.abort(); await Promise.allSettled([watching, waiting]); }
}

/** Broadcast a transaction that was already built and signed but not sent (tip kept moving). */
async function resumeAndBroadcast(operationId) {
  for (let attempt = 1; ; attempt++) {
    try {
      const pending = await wallet.operations.resume({ operationId });
      await wallet.sync();
      await pending.broadcast();
      return pending;
    } catch (e) {
      if (e?.code !== "SYNC_REQUIRED" || attempt >= 3) throw e;
      console.warn(`broadcast attempt ${attempt} for ${operationId}: ${describe(e)}; retrying`);
    }
  }
}

async function anchorBatch(roots, onSent) {
  const synced = await wallet.sync();
  if (!synced.targetReached) throw new Error("wallet sync did not reach the chain tip");
  const tip = synced.target?.height ?? 0;
  let pending;
  try {
    pending = await wallet.send({
      accountId: account.id, to: ADDRESS, amount: ZATS,
      memo: { text: "CI1|" + roots.join("|") }, idempotencyKey: randomUUID(),
    });
  } catch (e) {
    // Built and signed, but the chain moved on before submission: send the same bytes again.
    if (e?.code === "SYNC_REQUIRED" && e.operationId) pending = await resumeAndBroadcast(e.operationId);
    else throw e;
  }
  const sent = (await pending.snapshot()).steps.at(-1)?.txid;
  if (sent) await onSent(String(sent), tip);
  try {
    const done = await waitForConfirmation(pending);
    const tx = done.transactions.at(-1);
    return { txid: String(tx.txid), height: tx.height, confirmed: true };
  } catch (e) {
    // Broadcast but not mined within WAIT_MS: report it honestly instead of failing.
    if (!sent) throw e;
    console.warn("not confirmed yet:", describe(e));
    return { txid: String(sent), height: tip, confirmed: false };
  }
}

// Root -> state, saved to disk so a restart neither loses nor re-sends anything.
const STATE_FILE = join(DATA, "anchors.json");
const roots = new Map(Object.entries(JSON.parse(await readFile(STATE_FILE, "utf8").catch(() => "{}"))));
const save = () => writeFile(STATE_FILE, JSON.stringify(Object.fromEntries(roots))).catch((e) => console.error("could not save anchor state", e));
const set = (list, patch) => { for (const r of list) roots.set(r, { ...roots.get(r), ...patch, at: Date.now() }); return save(); };

// One wallet, one send at a time. Roots that arrive meanwhile share the next transaction.
const queue = [...roots].filter(([, s]) => s.status === "queued").map(([r]) => r);
let running = false;
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const batch = queue.splice(0, PER_TX);
    try {
      const out = await anchorBatch(batch, (txid, height) => set(batch, { status: "sent", txid, height, error: undefined }));
      await set(batch, { status: out.confirmed ? "mined" : "sent", txid: out.txid, height: out.height, error: undefined });
      console.log(new Date().toISOString(), `anchored ${batch.length} root(s) in tx ${out.txid} @ ${out.height}${out.confirmed ? "" : " (not mined yet)"}`);
    } catch (e) {
      console.error(new Date().toISOString(), "anchor failed:", describe(e));
      // Not sent: put the roots back so the next run tries again (in a fresh transaction).
      if (batch.every((r) => !roots.get(r)?.txid)) { await set(batch, { status: "queued", error: describe(e) }); queue.push(...batch); await new Promise((r) => setTimeout(r, 30_000)); }
      else await set(batch, { status: "failed", error: describe(e) });
    }
  }
  running = false;
}
function enqueue(root) {
  const known = roots.get(root);
  if (known && known.status !== "failed") return known;
  roots.set(root, { status: "queued", at: Date.now() });
  save();
  queue.push(root);
  drain();
  return roots.get(root);
}

const authed = (req) => {
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, "")), want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};
const reply = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

const server = createServer(async (req, res) => {
  try {
    if (!authed(req)) return reply(res, 401, { error: "unauthorized" });
    if (req.method === "GET" && req.url === "/health") {
      const b = await wallet.getBalance({ accountId: account.id });
      return reply(res, 200, { ok: true, address: ADDRESS, spendable: b.amounts ? zec(b.amounts.ironwood.spendable) : null, height: b.scan.tipHeight, queued: queue.length });
    }
    const lookup = /^\/anchor\/([0-9a-f]{64})$/.exec(req.url ?? "");
    if (req.method === "GET" && lookup) {
      const s = roots.get(lookup[1]);
      return s ? reply(res, 200, s) : reply(res, 404, { error: "unknown root" });
    }
    if (req.method !== "POST" || req.url !== "/anchor") return reply(res, 404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return reply(res, 413, { error: "too large" }); }
    const root = JSON.parse(raw || "{}").root;
    if (typeof root !== "string" || !/^[0-9a-f]{64}$/.test(root)) return reply(res, 400, { error: "root must be 64 hex characters" });
    const state = enqueue(root);
    reply(res, state.status === "queued" ? 202 : 200, state);
  } catch (e) {
    reply(res, 502, { error: describe(e) });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`anchor service on http://127.0.0.1:${PORT} · ${SERVER} · paying from ${ADDRESS.slice(0, 16)}…`));
if (queue.length) { console.log(`resuming ${queue.length} queued root(s)`); drain(); }

async function shutdown() {
  server.close();
  await binding.dispose().catch(() => {});
  await wallet.close().catch(() => {});
  await signer.dispose().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
