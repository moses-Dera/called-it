import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerView } from "@/components/player-view";

type Props = { params: Promise<{ handle: string }> };
const clean = (h: string) => decodeURIComponent(h).replace(/^@/, "").toLowerCase();

// Every player's public card lives at /@username (rewritten here), like x.com/username.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const h = clean((await params).handle);
  const title = `@${h} on Called It`;
  const description = `@${h}'s football calls, contest wins and ZEC prizes on Called It. Every call sealed before kickoff.`;
  return { title, description, alternates: { canonical: `/@${h}` }, openGraph: { title, description, url: `/@${h}` } };
}

async function View({ params }: Props) {
  return <PlayerView handle={clean((await params).handle)} />;
}

export default function PlayerPage({ params }: Props) {
  return <Suspense fallback={<main className="screen wide hub" style={{ padding: "18px 20px" }}><div style={{ height: 220, borderRadius: 26, background: "var(--panel)" }} /></main>}><View params={params} /></Suspense>;
}
