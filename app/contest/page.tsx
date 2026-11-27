import type { Metadata } from "next";
import { ContestView } from "@/components/contest-view";
import { contestGame } from "@/lib/data";
import { DynamicMarker, publicRow } from "@/lib/server-meta";

type Row = { title: string; prize_zec: number; game: string | null; sponsor: string | null; description: string | null };

// Each shared contest link gets its own preview card: title, prize, game and sponsor.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const id = (await searchParams).c;
  const c = typeof id === "string" && /^[a-z0-9-]{3,64}$/.test(id)
    ? await publicRow<Row>("contests", `id=eq.${id}&select=*`) : null;
  if (!c) return { title: "Contest" };
  const game = contestGame(c.game).name;
  const prize = Number(c.prize_zec) > 0 ? `${Number(c.prize_zec)} ZEC prize. ` : "";
  const description = c.description || `${prize}${game}. Free to play${c.sponsor ? `, by ${c.sponsor}` : ""}.`;
  const og = new URLSearchParams({ type: "contest", contest: c.title, game });
  if (Number(c.prize_zec) > 0) og.set("prize", String(Number(c.prize_zec)));
  if (c.sponsor) og.set("sponsor", c.sponsor);
  const image = { url: `/api/og?${og}`, width: 1200, height: 630, alt: c.title };
  return {
    title: c.title, description,
    openGraph: { title: `${c.title} — Called It`, description, images: [image] },
    twitter: { card: "summary_large_image", title: c.title, description, images: [image.url] },
  };
}

export default function ContestPage() {
  return <><ContestView /><DynamicMarker /></>;
}
