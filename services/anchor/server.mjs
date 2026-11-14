#!/usr/bin/env node
// Called It anchor service: writes Merkle roots into shielded Zcash testnet memos.
// Built on zcash.js with a public light-wallet server: no full node, no Rust build.
// It keeps a wallet on disk, so it runs on a normal machine or VPS, not on Vercel.
// The web app reaches it through ANCHOR_URL and ANCHOR_TOKEN.
//
//   POST /anchor  { "root": "<64 hex>" }   Authorization: Bearer <ANCHOR_TOKEN>
//   ->            { "txid": "...", "height": 1234567, "confirmed": true }
//   GET  /health  -> { ok, address, spendable, height }
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { SERVER, addressOf, describe, openWallet, unlock, zec } from "./wallet.mjs";

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

async function anchorBatch(roots) {
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

// One wallet, one send at a time. Roots that arrive meanwhile share the next transaction.
const queue = [];
let running = false;
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const batch = queue.splice(0, PER_TX);
    try {
      const out = await anchorBatch(batch.map((j) => j.root));
      console.log(new Date().toISOString(), `anchored ${batch.length} root(s) in tx ${out.txid} @ ${out.height}${out.confirmed ? "" : " (unconfirmed)"}`);
      batch.forEach((j) => j.resolve(out));
    } catch (e) {
      console.error(new Date().toISOString(), "anchor failed:", describe(e));
      batch.forEach((j) => j.reject(e));
    }
  }
  running = false;
}
const anchor = (root) => new Promise((resolve, reject) => { queue.push({ root, resolve, reject }); drain(); });

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
    if (req.method !== "POST" || req.url !== "/anchor") return reply(res, 404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return reply(res, 413, { error: "too large" }); }
    const root = JSON.parse(raw || "{}").root;
    if (typeof root !== "string" || !/^[0-9a-f]{64}$/.test(root)) return reply(res, 400, { error: "root must be 64 hex characters" });
    reply(res, 200, await anchor(root));
  } catch (e) {
    reply(res, 502, { error: describe(e) });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`anchor service on http://127.0.0.1:${PORT} · ${SERVER} · paying from ${ADDRESS.slice(0, 16)}…`));

async function shutdown() {
  server.close();
  await binding.dispose().catch(() => {});
  await wallet.close().catch(() => {});
  await signer.dispose().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
