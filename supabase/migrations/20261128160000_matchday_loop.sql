-- Matchday Loop:
--   1. Weekly 2x Banker boost (1 verified 2x call per ISO week, sealed in the commitment before kickoff)
--   2. Kickoff Reveal (fixture_picks unlocked ONLY once kickoff passes, verified against seal hash)
--   3. Live Contest Standings (real-time rank swings using live_home / live_away while matches play)

alter table public.rewards add column if not exists banker boolean not null default false;
alter table public.rewards add column if not exists banker_week timestamptz;
create unique index if not exists rewards_one_banker_per_week
  on public.rewards (user_id, banker_week) where banker_week is not null;

-- Update claim_classic to honor |2X banker seal (at most 1 per ISO week matching kickoff).
create or replace function public.claim_classic(p_seal_id text, p_player text, p_move text, p_salt text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  s public.seals;
  f public.fixtures;
  h int; a int;
  result_ok boolean;
  exact boolean;
  is_banker boolean;
  apply_banker boolean := false;
  wk timestamptz;
  base int;
  total int;
begin
  if uid is null then raise exception 'sign in to claim points'; end if;
  select * into s from public.seals where user_id = uid and id = p_seal_id;
  if not found then raise exception 'seal not found on the server (was it synced before kickoff?)'; end if;
  if s.game <> 'classic' then raise exception 'only Classic Call seals can be claimed'; end if;

  if encode(digest(convert_to('calledit:v1|' || p_player || '|' || s.round || '|' || p_move || '|' || p_salt, 'UTF8'), 'sha256'), 'hex') <> s.commitment then
    raise exception 'the revealed move does not match the sealed hash';
  end if;

  select * into f from public.fixtures where id = s.round;
  if not found then raise exception 'unknown fixture'; end if;
  if s.received_at >= f.kickoff then
    return jsonb_build_object('status', 'late', 'message', 'This seal reached the server after kickoff, so it cannot earn ranked points.');
  end if;
  if f.home_goals is null then
    return jsonb_build_object('status', 'pending', 'message', 'Waiting for the official full-time result.');
  end if;

  h := split_part(split_part(p_move, '|', 1), '-', 1)::int;
  a := split_part(split_part(p_move, '|', 1), '-', 2)::int;
  is_banker := '2X' = any(string_to_array(p_move, '|'));
  wk := date_trunc('week', f.kickoff at time zone 'UTC');

  result_ok := sign(h - a) = sign(f.home_goals - f.away_goals);
  exact := h = f.home_goals and a = f.away_goals;
  base := (case when result_ok then 10 else 0 end) + (case when exact then 40 else 0 end);
  total := base * (case when f.kickoff - s.received_at > interval '24 hours' then 2 else 1 end);

  if is_banker and total > 0 and not exists (
    select 1 from public.rewards where user_id = uid and banker_week = wk
  ) then
    apply_banker := true;
    total := total * 2;
  end if;

  perform set_config('calledit.claiming', 'on', true);
  update public.seals set revealed = true where user_id = uid and id = s.id;
  if total > 0 then
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round, banker, banker_week)
    values (uid, 'v_' || s.id, f.home || ' ' || f.home_goals || ' – ' || f.away_goals || ' ' || f.away || ' · Classic Call (verified)' || case when apply_banker then ' ⚡ 2x' else '' end,
            total, total / 100000.0, now(), true, s.round, apply_banker, case when apply_banker then wk else null end)
    on conflict do nothing;
  end if;
  return jsonb_build_object('status', 'scored', 'points', total, 'exact', exact, 'result', result_ok, 'banker', apply_banker,
                            'final', f.home_goals || '-' || f.away_goals, 'id', 'v_' || s.id);
end $$;

-- Kickoff-unlocked calls: strictly hidden until f.kickoff <= now().
create table if not exists public.fixture_picks (
  fixture_id text not null references public.fixtures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seal_id text not null,
  home_goals int not null check (home_goals >= 0),
  away_goals int not null check (away_goals >= 0),
  banker boolean not null default false,
  received_at timestamptz not null,
  revealed_at timestamptz not null default now(),
  primary key (fixture_id, user_id)
);
alter table public.fixture_picks enable row level security;
drop policy if exists "picks visible after kickoff" on public.fixture_picks;
create policy "picks visible after kickoff" on public.fixture_picks for select to anon, authenticated
  using (exists (select 1 from public.fixtures f where f.id = fixture_id and f.kickoff <= now()));

-- Reveal a classic pick as soon as kickoff has passed (verified against the sealed commitment).
create or replace function public.reveal_at_kickoff(p_seal_id text, p_player text, p_move text, p_salt text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  s public.seals;
  f public.fixtures;
  h int; a int;
  is_banker boolean;
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into s from public.seals where user_id = uid and id = p_seal_id;
  if not found then raise exception 'seal not found on the server'; end if;
  if s.game <> 'classic' then raise exception 'only Classic Call seals unlock at kickoff'; end if;

  if encode(digest(convert_to('calledit:v1|' || p_player || '|' || s.round || '|' || p_move || '|' || p_salt, 'UTF8'), 'sha256'), 'hex') <> s.commitment then
    raise exception 'revealed move does not match sealed hash';
  end if;

  select * into f from public.fixtures where id = s.round;
  if not found then raise exception 'unknown fixture'; end if;
  if now() < f.kickoff then raise exception 'kickoff has not arrived yet'; end if;
  if s.received_at >= f.kickoff then
    return jsonb_build_object('status', 'late');
  end if;

  h := split_part(split_part(p_move, '|', 1), '-', 1)::int;
  a := split_part(split_part(p_move, '|', 1), '-', 2)::int;
  is_banker := '2X' = any(string_to_array(p_move, '|'));

  insert into public.fixture_picks (fixture_id, user_id, seal_id, home_goals, away_goals, banker, received_at)
  values (s.round, uid, s.id, h, a, is_banker, s.received_at)
  on conflict (fixture_id, user_id) do nothing;

  return jsonb_build_object('status', 'ok', 'fixture_id', s.round, 'home_goals', h, 'away_goals', a, 'banker', is_banker);
end $$;
revoke all on function public.reveal_at_kickoff(text, text, text, text) from public, anon;
grant execute on function public.reveal_at_kickoff(text, text, text, text) to authenticated;

-- Public unlocked predictions for a fixture once kickoff has arrived, with live score calculation.
create or replace function public.live_fixture_calls(p_fixture_id text, p_contest_id text default null)
returns table (name text, avatar int, home_goals int, away_goals int, banker boolean, early boolean, live_points int, me boolean)
language sql stable security definer set search_path = public as $$
  with f as (select * from public.fixtures where id = p_fixture_id and kickoff <= now()),
  cur as (
    select id, kickoff,
      coalesce(home_goals, live_home) as gh,
      coalesce(away_goals, live_away) as ga
    from f
  )
  select
    coalesce(nullif(p.name, ''), 'Player'),
    coalesce(p.avatar, 1),
    fp.home_goals,
    fp.away_goals,
    fp.banker,
    (cur.kickoff - fp.received_at) > interval '24 hours',
    case when cur.gh is null or cur.ga is null then 0 else
      ((case when sign(fp.home_goals - fp.away_goals) = sign(cur.gh - cur.ga) then 10 else 0 end)
       + (case when fp.home_goals = cur.gh and fp.away_goals = cur.ga then 40 else 0 end))
      * (case when (cur.kickoff - fp.received_at) > interval '24 hours' then 2 else 1 end)
      * (case when fp.banker then 2 else 1 end)
    end,
    fp.user_id = auth.uid()
  from cur
  join public.fixture_picks fp on fp.fixture_id = cur.id
  left join public.profiles p on p.id = fp.user_id
  where p_contest_id is null
     or exists (select 1 from public.contest_entries ce where ce.contest_id = p_contest_id and ce.user_id = fp.user_id)
  order by 7 desc, fp.received_at asc
  limit 50
$$;
grant execute on function public.live_fixture_calls(text, text) to anon, authenticated;

-- Live contest standings: verified full-time rewards PLUS provisional live-match points from fixture_picks.
create or replace function public.contest_live_leaderboard(p_id text, p_limit int default 50, p_offset int default 0)
returns table (rank bigint, name text, avatar int, points bigint, live_points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.contests where id = p_id),
  settled as (
    select s.user_id, s.points as pts from public.contest_scores(p_id) s
  ),
  live_prov as (
    select fp.user_id,
      sum(
        ((case when sign(fp.home_goals - fp.away_goals) = sign(coalesce(f.home_goals, f.live_home) - coalesce(f.away_goals, f.live_away)) then 10 else 0 end)
         + (case when fp.home_goals = coalesce(f.home_goals, f.live_home) and fp.away_goals = coalesce(f.away_goals, f.live_away) then 40 else 0 end))
        * (case when (f.kickoff - fp.received_at) > interval '24 hours' then 2 else 1 end)
        * (case when fp.banker then 2 else 1 end)
      )::bigint as pts
    from c
    join public.fixtures f on f.id = any(c.fixture_ids)
    join public.fixture_picks fp on fp.fixture_id = f.id
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = fp.user_id
    where c.game = 'football'
      and f.kickoff <= now()
      and (f.home_goals is not null or f.live_home is not null)
      and not exists (select 1 from public.rewards r where r.user_id = fp.user_id and r.round = f.id and r.verified)
    group by fp.user_id
  ),
  combined as (
    select
      coalesce(s.user_id, l.user_id) as user_id,
      (coalesce(s.pts, 0) + coalesce(l.pts, 0))::bigint as total_pts,
      coalesce(l.pts, 0)::bigint as live_pts
    from settled s
    full outer join live_prov l on l.user_id = s.user_id
    where coalesce(s.pts, 0) + coalesce(l.pts, 0) > 0
  )
  select
    rank() over (order by cb.total_pts desc),
    coalesce(nullif(p.name, ''), 'Player'),
    coalesce(p.avatar, 1),
    cb.total_pts,
    cb.live_pts,
    cb.user_id = auth.uid()
  from combined cb
  left join public.profiles p on p.id = cb.user_id
  order by cb.total_pts desc
  limit least(p_limit, 100) offset greatest(p_offset, 0)
$$;
grant execute on function public.contest_live_leaderboard(text, int, int) to anon, authenticated;
