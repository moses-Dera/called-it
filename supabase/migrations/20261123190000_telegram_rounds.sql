-- Called It: Telegram group game rounds.
-- A round is pinned to a fixture. Players predict via DM; the bot reveals after full time.

CREATE TABLE IF NOT EXISTS public.tg_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  fixture_id text NOT NULL REFERENCES public.fixtures(id) ON DELETE CASCADE,
  started_by bigint NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'revealed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id, fixture_id)
);

CREATE TABLE IF NOT EXISTS public.tg_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.tg_rounds(id) ON DELETE CASCADE,
  tg_user_id bigint NOT NULL,
  tg_name text NOT NULL DEFAULT 'Player',
  home_score int NOT NULL CHECK (home_score BETWEEN 0 AND 99),
  away_score int NOT NULL CHECK (away_score BETWEEN 0 AND 99),
  points int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, tg_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_rounds_chat ON public.tg_rounds (chat_id, status);
CREATE INDEX IF NOT EXISTS idx_tg_predictions_round ON public.tg_predictions (round_id);

-- Score predictions for a finished round
CREATE OR REPLACE FUNCTION public.tg_score_round(p_round_id uuid)
RETURNS TABLE (tg_user_id bigint, tg_name text, home_score int, away_score int, points int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.tg_rounds;
  f public.fixtures;
BEGIN
  SELECT * INTO r FROM public.tg_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found'; END IF;

  SELECT * INTO f FROM public.fixtures WHERE id = r.fixture_id;
  IF f.home_goals IS NULL THEN RAISE EXCEPTION 'fixture not finished yet'; END IF;

  -- Score each prediction
  UPDATE public.tg_predictions tp SET points = (
    CASE
      WHEN tp.home_score = f.home_goals AND tp.away_score = f.away_goals THEN 10
      WHEN sign(tp.home_score - tp.away_score) = sign(f.home_goals - f.away_goals) THEN 5
      ELSE 0
    END
  ) WHERE tp.round_id = p_round_id;

  UPDATE public.tg_rounds SET status = 'revealed' WHERE id = p_round_id;

  RETURN QUERY
    SELECT tp.tg_user_id, tp.tg_name, tp.home_score, tp.away_score, tp.points
    FROM public.tg_predictions tp
    WHERE tp.round_id = p_round_id
    ORDER BY tp.points DESC, tp.created_at ASC;
END $$;
