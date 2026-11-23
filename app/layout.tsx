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
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
