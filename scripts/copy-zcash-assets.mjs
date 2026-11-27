// Copies the in-app wallet's engine (WebAssembly + workers + manifest) to public/zcash/<version>/ so the browser
// can load it from the app's own site. Runs after npm install; the files are generated, not committed.
// The folder is named after the engine's manifest fingerprint, so an upgrade never meets a stale browser cache.
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Must match ENGINE in lib/in-app-wallet.ts (the first 8 hex digits of the engine manifest's SHA-256).
const ENGINE = "ea08c661";
const from = "node_modules/@zcashlabs/zcash.js/dist/src/runtime/assets";
if (!existsSync(from)) { console.log("copy-zcash-assets: zcash.js not installed, skipping"); process.exit(0); }
const sha = createHash("sha256").update(await readFile(join(from, "wallet/manifest.json"))).digest("hex").slice(0, 8);
if (sha !== ENGINE) { console.error(`copy-zcash-assets: engine is ${sha}, expected ${ENGINE}. Update ENGINE here and in lib/in-app-wallet.ts.`); process.exit(1); }
const to = join("public/zcash", ENGINE, "wallet");
await rm("public/zcash", { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const f of ["manifest.json", "wallet.mjs", "worker.mjs", "bindings_bg.wasm", "opfs.mjs", "node-fs.mjs"]) await copyFile(join(from, "wallet", f), join(to, f));
console.log(`copy-zcash-assets: wallet engine ${ENGINE} copied to ${to}`);
