import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Close every open contest that has finished: football contests once all their matches have results, game
 * contests once their end time passes. Closing ranks the winners; sponsors then pay them directly.
 * Runs from the daily cron and from /api/live (every 15 minutes), with the service role.
 */
export async function settleContests(sb: SupabaseClient): Promise<string[]> {
  const log: string[] = [];
  try {
    const { data: open, error } = await sb.from("contests").select("id, title, fixture_ids, hidden, game, ends_at").eq("status", "open");
    if (error) return [`! Contest list: ${error.message}`];
    for (const c of open ?? []) {
      const isGame = c.game && c.game !== "football";
      if (!isGame && !c.fixture_ids?.length) continue;
      if (c.hidden) continue; // hidden contests wait for the admin
      let done: boolean;
      if (isGame) {
        done = !!c.ends_at && Date.parse(c.ends_at) <= Date.now();
      } else {
        const { data: finished } = await sb.from("fixtures").select("id").in("id", c.fixture_ids).not("home_goals", "is", null);
        done = !!finished && finished.length === c.fixture_ids.length;
      }
      if (!done) continue;
      const { error: closeErr } = await sb.rpc("admin_close_contest", { p_id: c.id });
      log.push(closeErr ? `! Could not settle ${c.id}: ${closeErr.message}` : `🏁 Settled "${c.title}" (${c.id})`);
    }
  } catch (e) {
    log.push(`! Contest settle error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return log;
}
