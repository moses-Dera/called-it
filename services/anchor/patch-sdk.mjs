#!/usr/bin/env node
// Runs after `npm install`. zcash.js 0.1.1 only accepts light servers that advertise protocol v0.5.0,
// but testnet.zec.rocks now advertises v0.6.0, which only adds GetStandardFee (unused here).
// 1) applies the upstream fix from https://github.com/zcashlabs/zcashjs/pull/28 (issue #25);
// 2) stops standing transparent-address polls from blocking every send;
// 3) gives the pre-broadcast tip check more than 3 refreshes (see below).
// Remove each part once a zcash.js release includes it.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "node_modules", "@zcashlabs", "zcash.js");
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
