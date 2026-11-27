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
  async headers() {
    return [{ source: "/zcash/:engine/:dir/:file*.mjs", headers: [{ key: "Content-Type", value: "text/javascript" }] }];
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
