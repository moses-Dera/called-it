import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Called It", short_name: "Called It",
    description: "Seal your call now. Prove it later.",
    start_url: "/", display: "standalone", orientation: "portrait",
    background_color: "#0B0F14", theme_color: "#0B0F14",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
