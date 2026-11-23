-- Called It: Tipping (player-to-player ZEC) and Syndicates (group prediction pools).
-- Applied with `npx supabase db push --remote`.

-- ══════════════════════════════════════════════════════════════════
-- 1. TIPPING — player-to-player ZEC tips from earned balance
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount >= 0.0001),
  message text CHECK (char_length(message) <= 140),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user <> to_user)
);
ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read own tips" ON public.tips;
CREATE POLICY "read own tips" ON public.tips FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IN (from_user, to_user));

CREATE INDEX IF NOT EXISTS idx_tips_from ON public.tips (from_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tips_to ON public.tips (to_user, created_at DESC);

CREATE OR REPLACE FUNCTION public.send_tip(p_to uuid, p_amount numeric, p_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  earned numeric;
  taken numeric;
  tipped_out numeric;
  available numeric;
  t public.tips;
  to_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in to send a tip'; END IF;
  IF p_to IS NULL OR p_to = uid THEN RAISE EXCEPTION 'cannot tip yourself'; END IF;
  IF p_amount < 0.0001 THEN RAISE EXCEPTION 'minimum tip is 0.0001 ZEC'; END IF;
  IF p_amount > 10 THEN RAISE EXCEPTION 'maximum tip is 10 ZEC'; END IF;

  -- Check the user exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to) THEN
    RAISE EXCEPTION 'player not found';
  END IF;

  -- Calculate available balance (earned - withdrawn - tipped out)
  SELECT coalesce(sum(zec), 0) INTO earned FROM public.rewards WHERE user_id = uid AND verified;
  SELECT coalesce(sum(amount), 0) INTO taken FROM public.withdrawals WHERE user_id = uid AND status <> 'rejected';
  SELECT coalesce(sum(amount), 0) INTO tipped_out FROM public.tips WHERE from_user = uid;
  available := earned - taken - tipped_out;

  IF p_amount > available THEN
    RETURN jsonb_build_object('status', 'insufficient', 'available', available);
  END IF;

  -- Rate limit: max 10 tips per hour
  IF (SELECT count(*) FROM public.tips WHERE from_user = uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too many tips — wait a bit';
  END IF;

  INSERT INTO public.tips (from_user, to_user, amount, message)
  VALUES (uid, p_to, p_amount, nullif(trim(coalesce(p_message, '')), ''))
  RETURNING * INTO t;

  -- Credit the recipient as a verified reward so it shows in their balance
  INSERT INTO public.rewards (user_id, id, label, points, zec, at, verified, round)
  VALUES (p_to, 'tip_' || t.id, 'Tip from a fellow player', 0, p_amount, now(), true, 'tip:' || uid)
  ON CONFLICT DO NOTHING;

  SELECT coalesce(nullif(name, ''), 'Player') INTO to_name FROM public.profiles WHERE id = p_to;
  RETURN jsonb_build_object('status', 'sent', 'amount', p_amount, 'to', to_name, 'tip_id', t.id);
END $$;
REVOKE ALL ON FUNCTION public.send_tip(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.send_tip(uuid, numeric, text) TO authenticated;

-- My recent tips (sent and received)
CREATE OR REPLACE FUNCTION public.my_tips(p_limit int DEFAULT 20, p_offset int DEFAULT 0)
RETURNS TABLE (
  id uuid, direction text, other_name text, amount numeric, message text, created_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id,
         CASE WHEN t.from_user = auth.uid() THEN 'sent' ELSE 'received' END,
         coalesce(nullif(CASE WHEN t.from_user = auth.uid() THEN p2.name ELSE p1.name END, ''), 'Player'),
         t.amount,
         t.message,
         t.created_at
  FROM public.tips t
  LEFT JOIN public.profiles p1 ON p1.id = t.from_user
  LEFT JOIN public.profiles p2 ON p2.id = t.to_user
  WHERE auth.uid() IN (t.from_user, t.to_user)
  ORDER BY t.created_at DESC
  LIMIT LEAST(p_limit, 50) OFFSET GREATEST(p_offset, 0)
$$;
GRANT EXECUTE ON FUNCTION public.my_tips(int, int) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- 2. SYNDICATES — group prediction pools
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.syndicates (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,32}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  description text CHECK (char_length(description) <= 200),
  owner uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  invite_code text NOT NULL DEFAULT substr(md5(random()::text), 1, 8),
  max_members int NOT NULL DEFAULT 20 CHECK (max_members BETWEEN 2 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.syndicates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "syndicates are public" ON public.syndicates;
CREATE POLICY "syndicates are public" ON public.syndicates FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.syndicate_members (
  syndicate_id text NOT NULL REFERENCES public.syndicates ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (syndicate_id, user_id)
);
ALTER TABLE public.syndicate_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read syndicate members" ON public.syndicate_members;
CREATE POLICY "read syndicate members" ON public.syndicate_members FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "own membership" ON public.syndicate_members;
CREATE POLICY "own membership" ON public.syndicate_members FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_syndicate_members_user ON public.syndicate_members (user_id);

-- Create a syndicate
CREATE OR REPLACE FUNCTION public.create_syndicate(p_name text, p_description text DEFAULT NULL, p_max_members int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  sid text;
  s public.syndicates;
  my_count int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  -- Limit: max 3 syndicates owned per user
  SELECT count(*) INTO my_count FROM public.syndicates WHERE owner = uid;
  IF my_count >= 3 THEN RAISE EXCEPTION 'you can own up to 3 syndicates'; END IF;

  sid := substr(md5(uid::text || now()::text), 1, 12);
  INSERT INTO public.syndicates (id, name, description, owner, max_members)
  VALUES (sid, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), uid, LEAST(GREATEST(p_max_members, 2), 100))
  RETURNING * INTO s;

  -- Owner auto-joins
  INSERT INTO public.syndicate_members (syndicate_id, user_id) VALUES (sid, uid);

  RETURN jsonb_build_object('id', s.id, 'name', s.name, 'invite_code', s.invite_code);
END $$;
REVOKE ALL ON FUNCTION public.create_syndicate(text, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_syndicate(text, text, int) TO authenticated;

-- Join a syndicate by invite code
CREATE OR REPLACE FUNCTION public.join_syndicate(p_invite_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.syndicates;
  member_count int;
  my_syndicates int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;

  SELECT * INTO s FROM public.syndicates WHERE invite_code = p_invite_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid invite code'; END IF;

  -- Limit: max 5 syndicates per user
  SELECT count(*) INTO my_syndicates FROM public.syndicate_members WHERE user_id = uid;
  IF my_syndicates >= 5 THEN RAISE EXCEPTION 'you can join up to 5 syndicates'; END IF;

  SELECT count(*) INTO member_count FROM public.syndicate_members WHERE syndicate_id = s.id;
  IF member_count >= s.max_members THEN RAISE EXCEPTION 'this syndicate is full'; END IF;

  INSERT INTO public.syndicate_members (syndicate_id, user_id)
  VALUES (s.id, uid)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('joined', true, 'syndicate', s.name, 'id', s.id);
END $$;
REVOKE ALL ON FUNCTION public.join_syndicate(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_syndicate(text) TO authenticated;

-- Leave a syndicate
CREATE OR REPLACE FUNCTION public.leave_syndicate(p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s public.syndicates;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
  SELECT * INTO s FROM public.syndicates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown syndicate'; END IF;
  IF s.owner = uid THEN RAISE EXCEPTION 'owners cannot leave — delete the syndicate instead'; END IF;
  DELETE FROM public.syndicate_members WHERE syndicate_id = p_id AND user_id = uid;
END $$;
REVOKE ALL ON FUNCTION public.leave_syndicate(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leave_syndicate(text) TO authenticated;

-- Delete a syndicate (owner only)
CREATE OR REPLACE FUNCTION public.delete_syndicate(p_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in first'; END IF;
  DELETE FROM public.syndicates WHERE id = p_id AND owner = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not found or not your syndicate'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.delete_syndicate(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_syndicate(text) TO authenticated;

-- Syndicate leaderboard: combined points of all members
CREATE OR REPLACE FUNCTION public.syndicate_leaderboard(p_period text DEFAULT 'all')
RETURNS TABLE (rank bigint, syndicate_id text, name text, member_count bigint, total_points bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    rank() OVER (ORDER BY sum(r.points) DESC),
    s.id,
    s.name,
    count(DISTINCT sm.user_id),
    coalesce(sum(r.points), 0)::bigint
  FROM public.syndicates s
  JOIN public.syndicate_members sm ON sm.syndicate_id = s.id
  LEFT JOIN public.rewards r ON r.user_id = sm.user_id AND r.verified AND r.points > 0
    AND (p_period = 'all' OR r.at >= date_trunc('week', now()))
  GROUP BY s.id, s.name
  HAVING coalesce(sum(r.points), 0) > 0
  ORDER BY 5 DESC
  LIMIT 50
$$;
GRANT EXECUTE ON FUNCTION public.syndicate_leaderboard(text) TO anon, authenticated;

-- My syndicates
CREATE OR REPLACE FUNCTION public.my_syndicates()
RETURNS TABLE (id text, name text, description text, member_count bigint, is_owner boolean, invite_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.name, s.description,
         (SELECT count(*) FROM public.syndicate_members WHERE syndicate_id = s.id),
         s.owner = auth.uid(),
         CASE WHEN s.owner = auth.uid() THEN s.invite_code ELSE NULL END
  FROM public.syndicates s
  JOIN public.syndicate_members sm ON sm.syndicate_id = s.id AND sm.user_id = auth.uid()
  ORDER BY sm.joined_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.my_syndicates() TO authenticated;

-- Syndicate detail with members
CREATE OR REPLACE FUNCTION public.syndicate_detail(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.syndicates;
  members jsonb;
  is_member boolean;
BEGIN
  SELECT * INTO s FROM public.syndicates WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown syndicate'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'user_id', sm.user_id,
    'name', coalesce(nullif(p.name, ''), 'Player'),
    'avatar', coalesce(p.avatar, 1),
    'points', coalesce((SELECT sum(r.points) FROM public.rewards r WHERE r.user_id = sm.user_id AND r.verified AND r.points > 0), 0)
  ) ORDER BY 1 DESC)
  INTO members
  FROM public.syndicate_members sm
  LEFT JOIN public.profiles p ON p.id = sm.user_id
  WHERE sm.syndicate_id = p_id;

  is_member := EXISTS (SELECT 1 FROM public.syndicate_members WHERE syndicate_id = p_id AND user_id = auth.uid());

  RETURN jsonb_build_object(
    'id', s.id, 'name', s.name, 'description', s.description,
    'owner', s.owner, 'max_members', s.max_members,
    'invite_code', CASE WHEN s.owner = auth.uid() THEN s.invite_code ELSE NULL END,
    'is_member', is_member,
    'members', coalesce(members, '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.syndicate_detail(text) TO anon, authenticated;
