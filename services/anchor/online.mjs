#!/usr/bin/env node
// One command to put the anchor service online from this machine:
//   npm run online
// Starts server.mjs, opens a free Cloudflare quick tunnel to it, and prints the two values for Vercel.
// The token is created once and kept in ~/.called-it/anchor-token, so only the URL changes between runs.
// The quick-tunnel address changes every time this starts: update ANCHOR_URL in Vercel and redeploy.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = process.env.PORT ?? "8787";
const tokenFile = join(homedir(), ".called-it", "anchor-token");
let token = process.env.ANCHOR_TOKEN || (await readFile(tokenFile, "utf8").catch(() => "")).trim();
if (!token) {
  token = randomBytes(32).toString("hex");
  await writeFile(tokenFile, token + "\n", { mode: 0o600 });
}

const children = [];
const stop = () => { for (const c of children) c.kill("SIGTERM"); setTimeout(() => process.exit(0), 1500); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const server = spawn(process.execPath, ["server.mjs"], { cwd: import.meta.dirname, env: { ...process.env, PORT, ANCHOR_TOKEN: token }, stdio: "inherit" });
children.push(server);
server.on("exit", (code) => { console.error(`anchor service stopped (${code}); closing the tunnel`); stop(); });

const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
children.push(tunnel);
tunnel.on("error", () => { console.error("cloudflared is not installed. See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"); stop(); });
tunnel.on("exit", (code) => { console.error(`tunnel closed (${code})`); stop(); });

let shown = false;
const watch = (chunk) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
  if (!url || shown) return;
  shown = true;
  console.log(`
────────────────────────────────────────────────────────────
 Anchor service is online at ${url}

 In Vercel → Settings → Environment Variables (then redeploy):
   ANCHOR_URL   = ${url}
   ANCHOR_TOKEN = (the value in ${tokenFile})

 For local testing, the same two lines go in .env.local.
 Keep this window open. Ctrl+C stops the service and the tunnel.
────────────────────────────────────────────────────────────`);
};
tunnel.stdout.on("data", watch);
tunnel.stderr.on("data", watch);
