import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DynamicMarker } from "@/lib/server-meta";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Only the reveal card's own fields pass through to the image. */
async function cardUrl(searchParams: SP) {
  const q = await searchParams;
  const p = new URLSearchParams({ type: "reveal", home: one(q.home, 40) || "Home", away: one(q.away, 40) || "Away" });
  const h = one(q.h, 2), a = one(q.a, 2), result = one(q.result, 10);
  if (/^\d{1,2}$/.test(h) && /^\d{1,2}$/.test(a)) { p.set("h", h); p.set("a", a); }
  if (["exact", "correct", "wrong"].includes(result)) p.set("result", result);
  return { url: `/api/og?${p}`, title: `${p.get("home")} vs ${p.get("away")}`, result };
}

// The link players share after a match: it previews as their reveal card and opens the app.
export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const c = await cardUrl(searchParams);
  const title = c.result === "exact" ? `Called it: ${c.title}` : `My sealed call: ${c.title}`;
  const description = "Sealed before kickoff and timestamped on Bitcoin. Make your own call on Called It, free.";
  return {
    title, description,
    openGraph: { title, description, images: [{ url: c.url, width: 1200, height: 630, alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [c.url] },
  };
}

async function Card({ searchParams }: { searchParams: SP }) {
  const c = await cardUrl(searchParams);
  return <img src={c.url} alt={c.title} width={1200} height={630} style={{ width: "100%", height: "auto", borderRadius: 18 }} />;
}

export default function SharePage({ searchParams }: { searchParams: SP }) {
  return (
    <main className="screen" style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 720, margin: "0 auto" }}>
      <Suspense fallback={<div style={{ aspectRatio: "1200 / 630", borderRadius: 18, background: "var(--panel)" }} />}>
        <Card searchParams={searchParams} />
      </Suspense>
      <h1 className="display" style={{ margin: 0, fontSize: 30 }}>Think you can call it?</h1>
      <p style={{ margin: 0, fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>Seal your score before kickoff. Nobody can see or change it, and after full time it proves you called it. Free to play.</p>
      <Link href="/" className="btn" style={{ background: "var(--lime)", color: "#111", border: "3px solid #111" }}>Make your call</Link>
      <DynamicMarker />
    </main>
  );
}
