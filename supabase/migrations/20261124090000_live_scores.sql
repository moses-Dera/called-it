-- In-play state lives in its own columns. home_goals/away_goals mean "final result" only:
-- claim_classic and contest auto-settle both treat a non-null home_goals as full time.
alter table public.fixtures
  add column if not exists status text,
  add column if not exists live_home int check (live_home >= 0),
  add column if not exists live_away int check (live_away >= 0);
