import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Clean addresses: /contest/<name> and /@<handle>, like x.com/username. Old query links still work.
  async redirects() {
    return [
      { source: "/contest", has: [{ type: "query", key: "c", value: "(?<id>[a-z0-9-]{3,64})" }], destination: "/contest/:id", permanent: true },
      { source: "/contest", destination: "/contests", permanent: false },
      { source: "/tipster", has: [{ type: "query", key: "h", value: "(?<h>[A-Za-z0-9_]{1,32})" }], destination: "/tipster/:h", permanent: true },
    ];
  },
  // The in-app wallet engine checks each file's exact type; .mjs must be text/javascript.
  // Wallet routes enforce a strict CSP so third-party scripts (such as Telegram) can never run alongside keys.
  async headers() {
    const originOf = (u?: string) => { try { return u ? new URL(u).origin : ""; } catch { return ""; } };
    const sbOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const sbWs = sbOrigin ? sbOrigin.replace(/^http/, "ws") : "";
    const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);
    const relayTestnet = originOf(process.env.NEXT_PUBLIC_ZCASH_RELAY_TESTNET) || "https://zcash-testnet.chainsafe.dev";
    const relayMainnet = originOf(process.env.NEXT_PUBLIC_ZCASH_RELAY_MAINNET) || "https://zcash-mainnet.chainsafe.dev";
    const isDev = process.env.NODE_ENV !== "production";
    const connectSrc = ["'self'", relayTestnet, relayMainnet, sbOrigin, sbWs, sentryOrigin].filter(Boolean).join(" ");
    const walletCsp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src ${connectSrc}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
    const walletHeaders = [{ key: "Content-Security-Policy", value: walletCsp }];
    return [
      { source: "/zcash/:engine/:dir/:file*.mjs", headers: [{ key: "Content-Type", value: "text/javascript" }] },
      { source: "/wallet-lab", headers: walletHeaders },
      { source: "/wallet-lab/:path*", headers: walletHeaders },
      { source: "/wallet", headers: walletHeaders },
      { source: "/wallet/:path*", headers: walletHeaders },
      { source: "/vault", headers: walletHeaders },
      { source: "/vault/:path*", headers: walletHeaders },
    ];
  },
  async rewrites() {
    return [{ source: "/@:handle", destination: "/u/:handle" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
