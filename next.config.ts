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
      { source: "/tipster", has: [{ type: "query", key: "h", value: "(?<h>[A-Za-z0-9_]{1,32})" }], destination: "/@:h", permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: "/@:handle", destination: "/tipster/:handle" }];
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
