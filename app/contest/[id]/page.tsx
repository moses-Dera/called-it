import type { Metadata } from "next";
import { Suspense } from "react";
import { ContestView } from "@/components/contest-view";
import { contestGame } from "@/lib/data";
import { publicRow } from "@/lib/server-meta";

type Props = { params: Promise<{ id: string }> };
type Row = { title: string; prize_zec: number; game: string | null; sponsor: string | null; description: string | null };
const valid = (id: string) => /^[a-z0-9-]{3,64}$/.test(id);

// Each contest has its own address (/contest/<name>) and its own preview card: title, prize, game and sponsor.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = valid(id) ? await publicRow<Row>("contests", `id=eq.${id}&select=*`) : null;
  if (!c) return { title: "Contest" };
  const game = contestGame(c.game).name;
  const prize = Number(c.prize_zec) > 0 ? `${Number(c.prize_zec)} ZEC prize. ` : "";
  const description = c.description || `${prize}${game}. Free to play${c.sponsor ? `, by ${c.sponsor}` : ""}.`;
  const og = new URLSearchParams({ type: "contest", contest: c.title, game });
  if (Number(c.prize_zec) > 0) og.set("prize", String(Number(c.prize_zec)));
  if (c.sponsor) og.set("sponsor", c.sponsor);
  const image = { url: `/api/og?${og}`, width: 1200, height: 630, alt: c.title };
  return {
    title: c.title, description, alternates: { canonical: `/contest/${id}` },
    openGraph: { title: `${c.title} — Called It`, description, url: `/contest/${id}`, images: [image] },
    twitter: { card: "summary_large_image", title: c.title, description, images: [image.url] },
  };
}

async function View({ params }: Props) {
  const { id } = await params;
  return <ContestView id={decodeURIComponent(id)} />;
}

export default function ContestPage({ params }: Props) {
  return <Suspense fallback={<main className="screen wide hub" style={{ padding: "18px 20px" }}><div style={{ height: 260, borderRadius: 26, background: "var(--panel)" }} /></main>}><View params={params} /></Suspense>;
}
