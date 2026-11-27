import { Suspense } from "react";
import { connection } from "next/server";

/** Marks a page as reading its URL at request time, so its link preview can use that, while the rest still prerenders. */
async function Connection() { await connection(); return null; }
export function DynamicMarker() { return <Suspense><Connection /></Suspense>; }

/** Read public rows with the anon key (no session), for link previews. */
export async function publicRow<T>(table: string, query: string): Promise<T | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const rows = (await r.json()) as T[];
    return rows[0] ?? null;
  } catch { return null; }
}
