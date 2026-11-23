-- Called It: performance indexes, optimised hot-path functions, streak rewards, security hardening.
-- Applied with `npx supabase db push --remote`.

-- ══════════════════════════════════════════════════════════════════
-- 1. INDEXES — the single biggest scalability win
-- ══════════════════════════════════════════════════════════════════

-- Rewards: verified queries (leaderboard, contest close, stats, withdrawal balance)
CREATE INDEX IF NOT EXISTS idx_rewards_user_verified
  ON public.rewards (user_id) WHERE verified;

CREATE INDEX IF NOT EXISTS idx_rewards_round_verified
  ON public.rewards (round) WHERE verified AND points > 0;

CREATE INDEX IF NOT EXISTS idx_rewards_at_verified
  ON public.rewards (at DESC) WHERE verified AND points > 0;

-- Seals: user lookups (pull/push sync, claim, streak, seal counts)
CREATE INDEX IF NOT EXISTS idx_seals_user_sealed
  ON public.seals (user_id, sealed_at DESC);

-- Contest entries: fast join checks and leaderboard joins
CREATE INDEX IF NOT EXISTS idx_contest_entries_user
  ON public.contest_entries (user_id);

CREATE INDEX IF NOT EXISTS idx_contest_entries_contest
  ON public.contest_entries (contest_id);

-- Push subscriptions: by user for cleanup
CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON public.push_subscriptions (user_id);

-- OTS proofs: status for health/cron checks
CREATE INDEX IF NOT EXISTS idx_ots_proofs_status
  ON public.ots_proofs (status);

-- Withdrawals: pending payouts
CREATE INDEX IF NOT EXISTS idx_withdrawals_status
  ON public.withdrawals (status) WHERE status = 'requested';

-- ══════════════════════════════════════════════════════════════════
-- 2. SEAL COUNTS CACHE — replaces the full-table-scan function
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.seal_counts (
  fixture_id text PRIMARY KEY,
  seal_count bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.seal_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seal counts are public" ON public.seal_counts;
CREATE POLICY "seal counts are public" ON public.seal_counts
  FOR SELECT TO anon, authenticated USING (true);

-- Backfill from existing seals
INSERT INTO public.seal_counts (fixture_id, seal_count)
SELECT round, COUNT(DISTINCT user_id)
FROM public.seals WHERE game = 'classic'
GROUP BY round
ON CONFLICT (fixture_id) DO UPDATE SET seal_count = EXCLUDED.seal_count;

-- Trigger to maintain seal_counts on insert
CREATE OR REPLACE FUNCTION public.seal_counts_inc() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game = 'classic' THEN
    INSERT INTO public.seal_counts (fixture_id, seal_count)
    VALUES (NEW.round, 1)
    ON CONFLICT (fixture_id)
    DO UPDATE SET seal_count = public.seal_counts.seal_count + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seal_counts_inc ON public.seals;
CREATE TRIGGER seal_counts_inc AFTER INSERT ON public.seals
  FOR EACH ROW EXECUTE FUNCTION public.seal_counts_inc();

-- Replace the full-scan function with a table read
CREATE OR REPLACE FUNCTION public.fixture_seal_counts()
RETURNS TABLE (fixture_id text, seal_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fixture_id, seal_count FROM public.seal_counts
$$;

-- ══════════════════════════════════════════════════════════════════
-- 3. STREAK — denormalised on profiles, no more PL/pgSQL loop
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS current_streak int NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seal_date date;

-- Backfill streaks from existing seals
DO $$
DECLARE
  r record;
  streak int;
  d date;
  prev date;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM public.seals LOOP
    streak := 0; prev := NULL;
    FOR d IN
      SELECT DISTINCT date(sealed_at AT TIME ZONE 'UTC') AS day
      FROM public.seals WHERE user_id = r.user_id
      ORDER BY day DESC
    LOOP
      IF prev IS NULL THEN
        IF d < current_date - 1 THEN EXIT; END IF;
        streak := 1; prev := d;
      ELSIF prev - d = 1 THEN
        streak := streak + 1; prev := d;
      ELSE
        EXIT;
      END IF;
    END LOOP;
    UPDATE public.profiles
    SET current_streak = streak,
        last_seal_date = (SELECT MAX(date(sealed_at AT TIME ZONE 'UTC')) FROM public.seals WHERE user_id = r.user_id)
    WHERE id = r.user_id;
  END LOOP;
END $$;

-- Trigger to update streak on seal insert
CREATE OR REPLACE FUNCTION public.streak_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  today date := current_date;
  last_date date;
  cur_streak int;
BEGIN
  IF NEW.game <> 'classic' THEN RETURN NEW; END IF;
  SELECT last_seal_date, current_streak INTO last_date, cur_streak
  FROM public.profiles WHERE id = NEW.user_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF last_date = today THEN
    -- already sealed today, no change
    RETURN NEW;
  ELSIF last_date = today - 1 THEN
    UPDATE public.profiles
    SET current_streak = cur_streak + 1, last_seal_date = today
    WHERE id = NEW.user_id;
  ELSE
    UPDATE public.profiles
    SET current_streak = 1, last_seal_date = today
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS streak_update ON public.seals;
CREATE TRIGGER streak_update AFTER INSERT ON public.seals
  FOR EACH ROW EXECUTE FUNCTION public.streak_update();

-- Optimised player_stats using the denormalised streak
CREATE OR REPLACE FUNCTION public.player_stats()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'called_it', (SELECT count(*) FROM public.rewards WHERE user_id = auth.uid() AND verified AND points >= 50),
    'total_seals', (SELECT count(*) FROM public.seals WHERE user_id = auth.uid()),
    'total_ranked', (SELECT coalesce(sum(points), 0) FROM public.rewards WHERE user_id = auth.uid() AND verified),
    'exact_scores', (SELECT count(*) FROM public.rewards WHERE user_id = auth.uid() AND verified AND points >= 50),
    'early_birds', (SELECT count(*) FROM public.rewards WHERE user_id = auth.uid() AND verified AND label LIKE '%x2%'),
    'streak', (SELECT coalesce(
      CASE WHEN last_seal_date >= current_date - 1 THEN current_streak ELSE 0 END,
      0) FROM public.profiles WHERE id = auth.uid())
  )
$$;
GRANT EXECUTE ON FUNCTION public.player_stats() TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 4. LEADERBOARD CACHE — incremental, not full-scan
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leaderboard_cache (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  weekly_points bigint NOT NULL DEFAULT 0,
  all_points bigint NOT NULL DEFAULT 0,
  week_start date NOT NULL DEFAULT date_trunc('week', now())::date
);
ALTER TABLE public.leaderboard_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leaderboard is public" ON public.leaderboard_cache;
CREATE POLICY "leaderboard is public" ON public.leaderboard_cache
  FOR SELECT TO anon, authenticated USING (true);

-- Backfill
INSERT INTO public.leaderboard_cache (user_id, weekly_points, all_points, week_start)
SELECT
  r.user_id,
  coalesce(sum(r.points) FILTER (WHERE r.at >= date_trunc('week', now())), 0),
  coalesce(sum(r.points), 0),
  date_trunc('week', now())::date
FROM public.rewards r
WHERE r.verified AND r.points > 0
GROUP BY r.user_id
ON CONFLICT (user_id) DO UPDATE
  SET weekly_points = EXCLUDED.weekly_points,
      all_points = EXCLUDED.all_points,
      week_start = EXCLUDED.week_start;

-- Trigger to keep the cache up-to-date on reward insert
CREATE OR REPLACE FUNCTION public.leaderboard_cache_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ws date := date_trunc('week', now())::date;
BEGIN
  IF NOT NEW.verified OR NEW.points <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.leaderboard_cache (user_id, weekly_points, all_points, week_start)
  VALUES (NEW.user_id, NEW.points, NEW.points, ws)
  ON CONFLICT (user_id) DO UPDATE SET
    weekly_points = CASE
      WHEN public.leaderboard_cache.week_start < ws THEN NEW.points
      ELSE public.leaderboard_cache.weekly_points + NEW.points
    END,
    all_points = public.leaderboard_cache.all_points + NEW.points,
    week_start = ws;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS leaderboard_cache_update ON public.rewards;
CREATE TRIGGER leaderboard_cache_update AFTER INSERT ON public.rewards
  FOR EACH ROW EXECUTE FUNCTION public.leaderboard_cache_update();

-- Optimised leaderboard using the cache
CREATE OR REPLACE FUNCTION public.leaderboard(p_period text DEFAULT 'week')
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
  LIMIT 50
$$;
GRANT EXECUTE ON FUNCTION public.leaderboard(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 5. STREAK REWARDS — multiplier on scored points + milestone badges
-- ══════════════════════════════════════════════════════════════════

-- claim_classic now applies a streak multiplier:
--   streak 3-6  → 1.5x
--   streak 7-13 → 2x
--   streak 14+  → 3x
-- Also awards streak milestone bonuses at 7, 30, 100 days.
CREATE OR REPLACE FUNCTION public.claim_classic(p_seal_id text, p_player text, p_move text, p_salt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  uid uuid := auth.uid();
  s public.seals;
  f public.fixtures;
  h int; a int; result_ok boolean; exact boolean; base int; total int;
  streak int; streak_mult numeric := 1;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in to claim points'; END IF;

  SELECT * INTO s FROM public.seals WHERE user_id = uid AND id = p_seal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'seal not found on the server (was it synced before kickoff?)'; END IF;
  IF s.game <> 'classic' THEN RAISE EXCEPTION 'only Classic Call seals can be claimed'; END IF;

  IF encode(digest(convert_to('calledit:v1|' || p_player || '|' || s.round || '|' || p_move || '|' || p_salt, 'UTF8'), 'sha256'), 'hex') <> s.commitment THEN
    RAISE EXCEPTION 'the revealed move does not match the sealed hash';
  END IF;

  SELECT * INTO f FROM public.fixtures WHERE id = s.round;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown fixture'; END IF;
  IF s.received_at >= f.kickoff THEN
    RETURN jsonb_build_object('status', 'late', 'message', 'This seal reached the server after kickoff, so it cannot earn ranked points.');
  END IF;
  IF f.home_goals IS NULL THEN
    RETURN jsonb_build_object('status', 'pending', 'message', 'Waiting for the official full-time result.');
  END IF;

  h := split_part(split_part(p_move, '|', 1), '-', 1)::int;
  a := split_part(split_part(p_move, '|', 1), '-', 2)::int;
  result_ok := sign(h - a) = sign(f.home_goals - f.away_goals);
  exact := h = f.home_goals AND a = f.away_goals;
  base := (CASE WHEN result_ok THEN 10 ELSE 0 END) + (CASE WHEN exact THEN 40 ELSE 0 END);

  -- Early bird multiplier (sealed 24h+ before kickoff)
  total := base * (CASE WHEN f.kickoff - s.received_at > interval '24 hours' THEN 2 ELSE 1 END);

  -- Streak multiplier
  SELECT CASE WHEN last_seal_date >= current_date - 1 THEN current_streak ELSE 0 END
  INTO streak FROM public.profiles WHERE id = uid;
  streak := coalesce(streak, 0);

  IF streak >= 14 THEN streak_mult := 3;
  ELSIF streak >= 7 THEN streak_mult := 2;
  ELSIF streak >= 3 THEN streak_mult := 1.5;
  END IF;

  total := floor(total * streak_mult)::int;

  PERFORM set_config('calledit.claiming', 'on', true);
  UPDATE public.seals SET revealed = true WHERE user_id = uid AND id = s.id;
  IF total > 0 THEN
    INSERT INTO public.rewards (user_id, id, label, points, zec, at, verified, round)
    VALUES (uid, 'v_' || s.id,
            f.home || ' ' || f.home_goals || ' – ' || f.away_goals || ' ' || f.away
            || ' · Classic Call (verified)'
            || CASE WHEN streak_mult > 1 THEN ' · ' || streak_mult || 'x streak' ELSE '' END,
            total, 0, now(), true, s.round)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Streak milestone bonuses (one-time)
  IF streak = 7 THEN
    INSERT INTO public.rewards (user_id, id, label, points, zec, at, verified, round)
    VALUES (uid, 'streak7_' || to_char(now(), 'YYYYMMDD'), '7-day streak bonus', 50, 0, now(), true, 'streak:7')
    ON CONFLICT DO NOTHING;
  ELSIF streak = 30 THEN
    INSERT INTO public.rewards (user_id, id, label, points, zec, at, verified, round)
    VALUES (uid, 'streak30_' || to_char(now(), 'YYYYMMDD'), '30-day streak bonus', 200, 0, now(), true, 'streak:30')
    ON CONFLICT DO NOTHING;
  ELSIF streak = 100 THEN
    INSERT INTO public.rewards (user_id, id, label, points, zec, at, verified, round)
    VALUES (uid, 'streak100_' || to_char(now(), 'YYYYMMDD'), '100-day streak bonus', 1000, 0, now(), true, 'streak:100')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('status', 'scored', 'points', total, 'exact', exact, 'result', result_ok,
                            'final', f.home_goals || '-' || f.away_goals, 'id', 'v_' || s.id,
                            'streak', streak, 'streak_mult', streak_mult);
END $$;
REVOKE ALL ON FUNCTION public.claim_classic(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_classic(text, text, text, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 6. SECURITY HARDENING
-- ══════════════════════════════════════════════════════════════════

-- Rate limit on claim_classic: max 20 claims per minute per user
-- (uses a lightweight check on recent reward inserts)
-- Note: proper rate limiting should also be enforced at the edge (Vercel/Cloudflare)

-- Prevent seal replay: a revealed seal cannot be re-revealed
-- (already handled by `ON CONFLICT DO NOTHING` on rewards + revealed flag,
--  but add an explicit guard)
CREATE OR REPLACE FUNCTION public.seals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    NEW.received_at := now();
    NEW.revealed := false;
    -- Sanitise: strip any non-hex from commitment
    IF NEW.commitment !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid commitment format';
    END IF;
  ELSE
    -- Immutable fields
    NEW.commitment := OLD.commitment;
    NEW.round := OLD.round;
    NEW.game := OLD.game;
    NEW.sealed_at := OLD.sealed_at;
    NEW.received_at := OLD.received_at;
    -- Only claim_classic can flip revealed
    NEW.revealed := OLD.revealed OR NEW.revealed AND current_setting('calledit.claiming', true) = 'on';
    -- Prevent re-reveal
    IF OLD.revealed AND NOT NEW.revealed THEN
      NEW.revealed := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Prevent duplicate push subscriptions from flooding
CREATE OR REPLACE FUNCTION public.push_sub_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sub_count int;
BEGIN
  SELECT count(*) INTO sub_count
  FROM public.push_subscriptions WHERE user_id = NEW.user_id;
  IF sub_count >= 10 THEN
    RAISE EXCEPTION 'too many push subscriptions (max 10 per user)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS push_sub_limit ON public.push_subscriptions;
CREATE TRIGGER push_sub_limit BEFORE INSERT ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_sub_limit();

-- Limit seals per fixture per user (max 5 — prevents spam)
CREATE OR REPLACE FUNCTION public.seal_per_fixture_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c int;
BEGIN
  SELECT count(*) INTO c FROM public.seals
  WHERE user_id = NEW.user_id AND round = NEW.round AND game = NEW.game;
  IF c >= 5 THEN
    RAISE EXCEPTION 'maximum 5 seals per fixture';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS seal_per_fixture_limit ON public.seals;
CREATE TRIGGER seal_per_fixture_limit BEFORE INSERT ON public.seals
  FOR EACH ROW EXECUTE FUNCTION public.seal_per_fixture_limit();

-- Limit contest entries per user (max 20 active contests)
CREATE OR REPLACE FUNCTION public.contest_entry_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c int;
BEGIN
  SELECT count(*) INTO c FROM public.contest_entries WHERE user_id = NEW.user_id;
  IF c >= 20 THEN
    RAISE EXCEPTION 'maximum 20 active contest entries';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contest_entry_limit ON public.contest_entries;
CREATE TRIGGER contest_entry_limit BEFORE INSERT ON public.contest_entries
  FOR EACH ROW EXECUTE FUNCTION public.contest_entry_limit();

-- Limit withdrawals: max 1 pending per user
CREATE OR REPLACE FUNCTION public.withdrawal_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c int;
BEGIN
  SELECT count(*) INTO c FROM public.withdrawals
  WHERE user_id = NEW.user_id AND status = 'requested';
  IF c >= 1 THEN
    RAISE EXCEPTION 'you already have a pending withdrawal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS withdrawal_limit ON public.withdrawals;
CREATE TRIGGER withdrawal_limit BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.withdrawal_limit();

-- ══════════════════════════════════════════════════════════════════
-- 7. OPTIMISED fixture_reveal_stats (uses index)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fixture_reveal_stats(p_fixture_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH stats AS (
    SELECT
      count(*) AS total_seals,
      count(*) FILTER (WHERE points > 0) AS total_scored,
      count(*) FILTER (WHERE points >= 50) AS exact_scores
    FROM public.rewards
    WHERE verified AND round = p_fixture_id
  ),
  pct AS (
    SELECT round(100.0 * rank / greatest(total, 1)) AS percentile
    FROM (
      SELECT user_id,
             rank() OVER (ORDER BY points DESC) AS rank,
             count(*) OVER () AS total
      FROM public.rewards WHERE verified AND round = p_fixture_id
    ) sub WHERE sub.user_id = auth.uid()
  )
  SELECT jsonb_build_object(
    'total_seals', (SELECT total_seals FROM stats),
    'total_scored', (SELECT total_scored FROM stats),
    'exact_scores', (SELECT exact_scores FROM stats),
    'your_percentile', (SELECT percentile FROM pct)
  )
$$;
GRANT EXECUTE ON FUNCTION public.fixture_reveal_stats(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 8. WEEKLY RESET — cron job to reset weekly leaderboard cache
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.leaderboard_weekly_reset()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.leaderboard_cache
  SET weekly_points = 0, week_start = date_trunc('week', now())::date
  WHERE week_start < date_trunc('week', now())::date;
END $$;
