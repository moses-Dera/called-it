import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/shell";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Called It", template: "%s — Called It" },
  description: "Seal your call now. Prove it later. Nobody can cheat.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Called It", statusBarStyle: "black-translucent" },
  openGraph: { type: "website", siteName: "Called It", title: "Called It", description: "Seal your call before kickoff. Prove it after. Nobody can cheat." },
  twitter: { card: "summary_large_image" },
  other: { google: "notranslate" },
};
export const viewport: Viewport = { themeColor: "#0B0F14", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no" suppressHydrationWarning className={`${display.variable} ${inter.variable}`}>
      <head>
        {/* Old service workers served stale dev chunks cache-first; purge them once on local hosts. */}
        <Script id="purge-stale-sw" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `(function(){var h=location.hostname;if(!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(h)||!window.caches)return;caches.keys().then(function(ks){var old=ks.filter(function(k){return k!=="calledit-v2"});if(!old.length)return;return Promise.all(old.map(function(k){return caches.delete(k)})).then(function(){return navigator.serviceWorker?navigator.serviceWorker.getRegistrations():[]}).then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){try{if(sessionStorage.getItem("sw-purged"))return;sessionStorage.setItem("sw-purged","1")}catch(e){return}location.reload()})}).catch(function(){})})();` }} />
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
