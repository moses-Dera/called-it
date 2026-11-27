import { NextResponse } from "next/server";
import http2 from "node:http2";

// Every outside service Called It relies on, what it is for, and whether it answers right now.
// Shown in Admin > Overview. No secrets are returned.

type Check = { name: string; purpose: string; url: string; ok: boolean; ms: number; note?: string };

async function timed(fn: () => Promise<string | void>): Promise<{ ok: boolean; ms: number; note?: string }> {
  const t = Date.now();
  try { const note = await fn(); return { ok: true, ms: Date.now() - t, note: note || undefined }; }
  catch (e) { return { ok: false, ms: Date.now() - t, note: e instanceof Error ? e.message : String(e) }; }
}

async function http(url: string, init?: RequestInit, okStatus = (s: number) => s < 400) {
  const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!okStatus(r.status)) throw new Error(`answered ${r.status}`);
}

/** Ask a Zcash light wallet server (lightwalletd) for its info over gRPC, as wallets do. */
function lightwalletd(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = http2.connect(`https://${host}`);
    const timer = setTimeout(() => { s.destroy(); reject(new Error("no answer in 8s")); }, 8000);
    s.on("error", (e) => { clearTimeout(timer); reject(e); });
    const req = s.request({ ":method": "POST", ":path": "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo", "content-type": "application/grpc", te: "trailers" });
    let body = Buffer.alloc(0);
    req.on("data", (d: Buffer) => { body = Buffer.concat([body, d]); });
    req.on("error", (e) => { clearTimeout(timer); s.destroy(); reject(e); });
    req.on("end", () => {
      clearTimeout(timer); s.close();
      // The reply names the chain ("main" or "test") and the block height; show the chain name.
      const text = body.subarray(5).toString("latin1");
      const chain = /\b(main|test)\b/.exec(text)?.[1];
      if (chain) resolve(`${chain === "main" ? "mainnet" : "testnet"} chain`); else reject(new Error("unexpected reply"));
    });
    req.end(Buffer.from([0, 0, 0, 0, 0]));
  });
}

let cache: { at: number; body: Check[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) return NextResponse.json(cache.body);
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const sbKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const fdKey = process.env.FOOTBALL_DATA_KEY ?? "";
  const specs: [string, string, string, () => Promise<string | void>][] = [
    ["Database", "Accounts, contests, seals, prizes (Supabase)", sbUrl, () => http(`${sbUrl}/rest/v1/app_settings?select=key&limit=1`, { headers: { apikey: sbKey, authorization: `Bearer ${sbKey}` } })],
    ["Football results", "Matches, kickoffs and final scores (football-data.org)", "https://api.football-data.org", () => fdKey ? http("https://api.football-data.org/v4/competitions/PL", { headers: { "X-Auth-Token": fdKey } }) : Promise.reject(new Error("FOOTBALL_DATA_KEY not set"))],
    ["Bitcoin timestamps", "Stamps every sealed call on Bitcoin (OpenTimestamps)", "https://a.pool.opentimestamps.org", () => http("https://a.pool.opentimestamps.org/")],
    ["Zcash testnet server", "Light wallet server for test coins (TAZ)", "testnet.zec.rocks:443", () => lightwalletd("testnet.zec.rocks:443")],
    ["Zcash mainnet server", "Light wallet server for real ZEC", "zec.rocks:443", () => lightwalletd("zec.rocks:443")],
    ["Block explorer", "Public proof pages for each prize payment", "https://blockexplorer.one/zcash", () => http("https://blockexplorer.one/zcash/mainnet")],
  ];
  const body = await Promise.all(specs.map(async ([name, purpose, url, fn]) => ({ name, purpose, url, ...(await timed(fn)) })));
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
