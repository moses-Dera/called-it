#!/usr/bin/env node
// Runs after `npm install`. zcash.js 0.1.1 only accepts light servers that advertise protocol v0.5.0,
// but testnet.zec.rocks now advertises v0.6.0, which only adds GetStandardFee (unused here).
// 1) applies the upstream fix from https://github.com/zcashlabs/zcashjs/pull/28 (issue #25);
// 2) stops standing transparent-address polls from blocking every send;
// 3) gives the pre-broadcast tip check more than 3 refreshes (see below).
// Remove each part once a zcash.js release includes it.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Patches the anchor service's copy by default, or the copy at the path given (the web app's, for the in-app wallet).
const root = process.argv[2] ? resolve(process.argv[2]) : join(dirname(fileURLToPath(import.meta.url)), "node_modules", "@zcashlabs", "zcash.js");
if (!existsSync(join(root, "package.json"))) { console.log("patch-sdk: zcash.js not installed, skipping"); process.exit(0); }

const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const file = join(root, "dist/src/clients/light-server-observation.js");
let src = await readFile(file, "utf8");
const check = "if (dto.lightwallet_protocol_version !== 'v0.5.0') {";
const fixed = "if (dto.lightwallet_protocol_version !== 'v0.5.0' && dto.lightwallet_protocol_version !== 'v0.6.0') {";

if (src.includes(fixed)) console.log(`patch-sdk: zcash.js ${version} already accepts protocol v0.6.0`);
else if (src.includes(check)) {
  src = src.replace(check, fixed).replace("protocolRevision: 'v0.5.0',", "protocolRevision: dto.lightwallet_protocol_version,");
  await writeFile(file, src);
  console.log(`patch-sdk: zcash.js ${version} now accepts light-server protocol v0.6.0`);
} else console.log(`patch-sdk: zcash.js ${version} changed; the v0.6.0 fix is probably included, nothing to do`);

// 2) Freshness: a proposal requires zero "actionable" enhancement requests, but every transparent
// receive address keeps a standing UTXO-polling request (no end height) that sync visits and keeps.
// So a live wallet never reaches zero and every send fails with SYNC_REQUIRED. Count only finite
// work; standing polls are still visited on every sync.
const syncFile = join(root, "dist/src/wallet/sync.js");
let sync = await readFile(syncFile, "utf8");
const before = "enhancement: { actionable: pending.requests.length - delayed, delayed },";
const after = "enhancement: { actionable: pending.requests.length - delayed - pending.requests.filter(r => r.kind === 'address' && r.endExclusive === null && !(r.requestAt !== null && r.requestAt > Date.now())).length, delayed },";
if (sync.includes(after)) console.log("patch-sdk: standing address polls already excluded from freshness");
else if (sync.includes(before)) { await writeFile(syncFile, sync.replace(before, after)); console.log("patch-sdk: standing address polls no longer block sends"); }
else console.log("patch-sdk: sync.js changed upstream; freshness patch not applied");

// 3) Submission: before broadcasting, the wallet must match the chain tip exactly, refreshing at most
// 3 times. A refresh sync takes about one testnet block (~25 s), so it rarely catches up in 3.
// Allow 12; the transaction itself is already built and signed and is never rebuilt.
const payFile = join(root, "dist/src/wallet/payments.js");
const pay = await readFile(payFile, "utf8");
const tries = "if (refreshes === 3) {", moreTries = "if (refreshes === 12) {";
if (pay.includes(moreTries)) console.log("patch-sdk: submission refresh limit already 12");
else if (pay.includes(tries)) { await writeFile(payFile, pay.replace(tries, moreTries)); console.log("patch-sdk: submission refresh limit raised to 12"); }
else console.log("patch-sdk: payments.js changed upstream; refresh-limit patch not applied");

// 4) Browser bundling (the in-app wallet): Node-only modules are loaded with dynamic imports that browsers
// never run, but bundlers still try to resolve them and fail on net/tls/@grpc/grpc-js. Mark them ignored.
const ignore = (code, from, to) => code.includes(to) ? code : code.replace(from, to);
for (const [rel, from, to] of [
  ["dist/src/runtime/worker-platform.js", "const builtin = (name) => import(`node:${name}`);", "const builtin = (name) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `node:${name}`);"],
  ["dist/src/grpc.js", "await import(/* @vite-ignore */ path);", "await import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ path);"],
]) {
  const f = join(root, rel);
  if (!existsSync(f)) continue;
  const code = await readFile(f, "utf8");
  const out = ignore(code, from, to);
  if (out === code && !code.includes(to)) console.log(`patch-sdk: ${rel} changed upstream; bundler-ignore patch not applied`);
  else if (out !== code) { await writeFile(f, out); console.log(`patch-sdk: ${rel} Node-only import hidden from browser bundlers`); }
}

// 5) In-app wallet: browsers load the wallet engine from /zcash/ on the app's own site (copied there by
// scripts/copy-zcash-assets.mjs) instead of from bundler-renamed files, which broke the engine's manifest.
// The engine still verifies every file against its pinned SHA-256. Node (the anchor service) is unchanged.
const assetsFile = join(root, "dist/src/runtime/bundled-assets.mjs");
if (existsSync(assetsFile)) {
  let a = await readFile(assetsFile, "utf8");
  if (a.includes("__CALLEDIT_ZCASH_ASSETS__")) console.log("patch-sdk: wallet engine location already configurable");
  else {
    a = a.replace(/new URL\("(\.\/assets\/[^"]+)", import\.meta\.url\)/g, 'at("$1")');
    a = a.replace("let urls;", 'let urls;\nconst at = (rel) => { const base = globalThis.__CALLEDIT_ZCASH_ASSETS__; return base ? new URL(rel.slice("./assets/".length), base) : new URL(rel, import.meta.url); };');
    await writeFile(assetsFile, a);
    console.log("patch-sdk: wallet engine location configurable for browsers");
  }
}
