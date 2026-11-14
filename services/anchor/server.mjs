#!/usr/bin/env node
// Called It anchor service: writes one Merkle root into a shielded Zcash testnet memo.
// It wraps zingo-cli, so it must run on a machine that has the binary and a funded testnet wallet
// (not on Vercel). The web app reaches it through ANCHOR_URL and ANCHOR_TOKEN.
//
//   POST /anchor  { "root": "<64 hex>" }   Authorization: Bearer <ANCHOR_TOKEN>
//   ->            { "txid": "...", "height": 1234567 }
//   GET  /health  -> { ok, address, height }
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const env = process.env;
const PORT = Number(env.PORT ?? 8787);
const TOKEN = env.ANCHOR_TOKEN ?? "";
const ADDRESS = env.ANCHOR_ADDRESS ?? "";                       // utest1... that receives the anchor memos
const ZATS = String(env.ANCHOR_ZATS ?? "0");                    // amount per anchor; raise it if the wallet refuses 0
const CLI = env.ZINGO_CLI ?? "zingo-cli";
const DATA = env.ZINGO_DATA_DIR ?? join(homedir(), ".called-it", "testnet-wallet");
const SERVER = env.ZINGO_SERVER ?? "https://testnet.zec.rocks:443";

if (TOKEN.length < 16) { console.error("Set ANCHOR_TOKEN to a random secret of at least 16 characters."); process.exit(1); }
if (!/^utest1[a-z0-9]{20,}$/.test(ADDRESS)) { console.error("Set ANCHOR_ADDRESS to the anchor wallet's utest1... unified address."); process.exit(1); }

const base = ["--chain", "testnet", "--server", SERVER, "--data-dir", DATA];
function zingo(args, timeout = 5 * 60_000) {
  return new Promise((resolve, reject) => {
    execFile(CLI, [...base, ...args], { timeout, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().slice(-600)));
      else resolve(stdout);
    });
  });
}
const heightOf = (out) => Number(/"height"\s*:\s*(\d+)/.exec(out)?.[1] ?? 0);

// One wallet, so one send at a time.
let queue = Promise.resolve();
function anchor(root) {
  const job = queue.then(async () => {
    const sent = await zingo(["--waitsync", "quicksend", ADDRESS, ZATS, `CI1|${root}`]);
    const txid = /"txids"\s*:\s*\[\s*"([0-9a-f]{64})"/.exec(sent)?.[1];
    if (!txid) throw new Error("zingo-cli returned no txid: " + sent.trim().slice(-300));
    // Chain tip when the transaction was broadcast. It is mined in the next block or two.
    const height = heightOf(await zingo(["--nosync", "height"], 60_000));
    return { txid, height };
  });
  queue = job.catch(() => {});
  return job;
}

const authed = (req) => {
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, "")), want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
  try {
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, address: ADDRESS, height: heightOf(await zingo(["--nosync", "height"], 60_000)) });
    }
    if (req.method !== "POST" || req.url !== "/anchor") return send(res, 404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(res, 413, { error: "too large" }); }
    const root = JSON.parse(raw || "{}").root;
    if (typeof root !== "string" || !/^[0-9a-f]{64}$/.test(root)) return send(res, 400, { error: "root must be 64 hex characters" });
    const out = await anchor(root);
    console.log(new Date().toISOString(), "anchored", root.slice(0, 12), "tx", out.txid);
    send(res, 200, out);
  } catch (e) {
    console.error(new Date().toISOString(), "anchor failed:", e.message);
    send(res, 502, { error: e.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`anchor service on http://127.0.0.1:${PORT} -> ${SERVER}`));
