-- Called It: pagination support for leaderboards, admin lists, and contest boards.
-- Applied with `npx supabase db push --remote`.

-- ══════════════════════════════════════════════════════════════════
-- 1. LEADERBOARD with offset pagination
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.leaderboard(p_period text DEFAULT 'week', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (rank bigint, name text, avatar int, points bigint, me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    rank() OVER (ORDER BY
      CASE WHEN p_period = 'week' THEN lc.weekly_points ELSE lc.all_points END DESC),
    coalesce(nullif(p.name, ''), 'Player'),
    coalesce(p.avatar, 1),
    CASE WHEN p_period = 'week' THEN lc.weekly_points ELSE lc.all_points END,
    lc.user_id = auth.uid()
  FROM public.leaderboard_cache lc
  LEFT JOIN public.profiles p ON p.id = lc.user_id
  WHERE CASE WHEN p_period = 'week' THEN lc.weekly_points ELSE lc.all_points END > 0
  ORDER BY 4 DESC, 2 ASC
  LIMIT LEAST(p_limit, 100)
  OFFSET GREATEST(p_offset, 0)
$$;
GRANT EXECUTE ON FUNCTION public.leaderboard(text, int, int) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 2. CONTEST LEADERBOARD with offset pagination
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.contest_leaderboard(p_id text, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (rank bigint, name text, avatar int, points bigint, me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rank() OVER (ORDER BY sum(r.points) DESC),
         coalesce(nullif(p.name, ''), 'Player'),
         coalesce(p.avatar, 1),
         sum(r.points)::bigint,
         r.user_id = auth.uid()
  FROM public.rewards r
  JOIN public.contests c ON c.id = p_id
  JOIN public.contest_entries ce ON ce.contest_id = p_id AND ce.user_id = r.user_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.verified AND r.points > 0 AND r.round = any (c.fixture_ids)
  GROUP BY r.user_id, p.name, p.avatar
  ORDER BY 4 DESC
  LIMIT LEAST(p_limit, 100)
  OFFSET GREATEST(p_offset, 0)
$$;
GRANT EXECUTE ON FUNCTION public.contest_leaderboard(text, int, int) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 3. ADMIN: paginated player list
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_list_all_players(p_search text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (id uuid, name text, address text, avatar int, ranked_points bigint, earned_zec numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    coalesce(nullif(p.name, ''), 'Player') AS name,
    p.address,
    p.avatar,
    coalesce(sum(r.points) FILTER (WHERE r.verified), 0) AS ranked_points,
    coalesce(sum(r.zec) FILTER (WHERE r.verified), 0) AS earned_zec
  FROM public.profiles p
  LEFT JOIN public.rewards r ON r.user_id = p.id
  WHERE (coalesce(p_search, '') = '' OR p.name ILIKE '%' || p_search || '%' OR p.address ILIKE '%' || p_search || '%')
  GROUP BY p.id, p.name, p.address, p.avatar
  ORDER BY ranked_points DESC, p.name ASC
  LIMIT LEAST(p_limit, 200)
  OFFSET GREATEST(p_offset, 0)
$$;
REVOKE ALL ON FUNCTION public.admin_list_all_players(text, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_all_players(text, int, int) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. ADMIN: paginated overview with withdrawal offset
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_overview(p_w_limit int DEFAULT 50, p_w_offset int DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.require_admin();
  RETURN jsonb_build_object(
    'players', (SELECT count(*) FROM public.profiles),
    'seals', (SELECT count(*) FROM public.seals),
    'ranked_points', (SELECT coalesce(sum(points), 0) FROM public.rewards WHERE verified),
    'requested_zec', (SELECT coalesce(sum(amount), 0) FROM public.withdrawals WHERE status = 'requested'),
    'withdrawals', (SELECT coalesce(jsonb_agg(w ORDER BY w.created_at DESC), '[]'::jsonb) FROM (
        SELECT w.id, w.address, w.amount, w.status, w.txid, w.created_at, coalesce(nullif(p.name, ''), 'Player') AS name
        FROM public.withdrawals w LEFT JOIN public.profiles p ON p.id = w.user_id
        ORDER BY w.created_at DESC
        LIMIT LEAST(p_w_limit, 200)
        OFFSET GREATEST(p_w_offset, 0)) w),
    'total_withdrawals', (SELECT count(*) FROM public.withdrawals)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_overview(int, int) TO authenticated;
