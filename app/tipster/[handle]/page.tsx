import type { Metadata } from "next";
import { Suspense } from "react";
import { TipsterView } from "@/components/tipster-view";

type Props = { params: Promise<{ handle: string }> };

// Public tipster records live at /@handle (rewritten here), like x.com/username.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const handle = decodeURIComponent((await params).handle).replace(/^@/, "");
  const title = `@${handle} · tipster record`;
  const description = `Every call @${handle} made, sealed before kickoff and timestamped on Bitcoin. Check the record yourself on Called It.`;
  return {
    title,
    description,
    alternates: { canonical: `/tipster/${handle}` },
    openGraph: { title, description, url: `/tipster/${handle}`, images: [{ url: "/api/og", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: ["/api/og"] },
  };
}

async function View({ params }: Props) {
  return <TipsterView handle={decodeURIComponent((await params).handle).replace(/^@/, "")} />;
}

export default function TipsterPage({ params }: Props) {
  return <Suspense fallback={<main className="screen wide hub" style={{ padding: "18px 20px" }}><div style={{ height: 260, borderRadius: 26, background: "var(--panel)" }} /></main>}><View params={params} /></Suspense>;
}
