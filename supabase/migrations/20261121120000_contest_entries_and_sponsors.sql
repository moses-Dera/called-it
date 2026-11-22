-- Called It: sponsor contest system. Players opt into contests; sponsors get branding.
-- A single seal counts toward all contests the player has joined. Players who don't
-- join still play the same fixtures for regular ranked points.
-- Applied with `npx supabase db push --remote`.

-- ---------- Contest entries (opt-in) ----------
create table if not exists public.contest_entries (
  contest_id text not null references public.contests on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (contest_id, user_id)
);
alter table public.contest_entries enable row level security;
drop policy if exists "read contest entries" on public.contest_entries;
create policy "read contest entries" on public.contest_entries for select to anon, authenticated using (true);
drop policy if exists "join own entries" on public.contest_entries;
create policy "join own entries" on public.contest_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "leave own entries" on public.contest_entries;
create policy "leave own entries" on public.contest_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------- Sponsor branding and prize structure on contests ----------
alter table public.contests add column if not exists sponsor_logo text;
alter table public.contests add column if not exists sponsor_color text;
alter table public.contests add column if not exists sponsor_url text;
alter table public.contests add column if not exists prize_structure text not null default 'top3'
  check (prize_structure in ('top3', 'top10', 'all_correct', 'random_draw'));
alter table public.contests add column if not exists entry_deadline timestamptz;
alter table public.contests add column if not exists description text;

-- ---------- Seal counts (public, per fixture) ----------
create or replace function public.fixture_seal_counts()
returns table (fixture_id text, seal_count bigint)
language sql stable security definer set search_path = public as $$
  select round, count(distinct user_id)
  from public.seals
  where game = 'classic'
  group by round
$$;
grant execute on function public.fixture_seal_counts() to anon, authenticated;

-- ---------- Contest entry count ----------
create or replace function public.contest_entry_count(p_id text)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.contest_entries where contest_id = p_id
$$;
grant execute on function public.contest_entry_count(text) to anon, authenticated;

-- ---------- Join / leave a contest ----------
create or replace function public.join_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests;
begin
  if auth.uid() is null then raise exception 'sign in to join a contest'; end if;
  select * into c from public.contests where id = p_id;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then raise exception 'this contest is closed'; end if;
  if c.entry_deadline is not null and now() > c.entry_deadline then
    raise exception 'entry deadline has passed';
  end if;
  insert into public.contest_entries (contest_id, user_id)
  values (p_id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('joined', true, 'contest', c.title);
end $$;
revoke all on function public.join_contest(text) from public, anon;
grant execute on function public.join_contest(text) to authenticated;

create or replace function public.leave_contest(p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  delete from public.contest_entries where contest_id = p_id and user_id = auth.uid();
end $$;
revoke all on function public.leave_contest(text) from public, anon;
grant execute on function public.leave_contest(text) to authenticated;

-- ---------- My contest entries ----------
create or replace function public.my_contest_ids()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(contest_id), '{}') from public.contest_entries where user_id = auth.uid()
$$;
grant execute on function public.my_contest_ids() to anon, authenticated;

-- ---------- Contest leaderboard: only joined players ----------
create or replace function public.contest_leaderboard(p_id text)
returns table (rank bigint, name text, avatar int, points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by sum(r.points) desc), coalesce(nullif(p.name, ''), 'Player'), coalesce(p.avatar, 1),
         sum(r.points)::bigint, r.user_id = auth.uid()
  from public.rewards r
  join public.contests c on c.id = p_id
  join public.contest_entries ce on ce.contest_id = p_id and ce.user_id = r.user_id
  left join public.profiles p on p.id = r.user_id
  where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
  group by r.user_id, p.name, p.avatar
  order by 4 desc
  limit 50
$$;
grant execute on function public.contest_leaderboard(text) to anon, authenticated;

-- ---------- Admin: create contest with sponsor branding ----------
create or replace function public.admin_upsert_contest(
  p_id text, p_title text, p_sponsor text, p_prize numeric, p_fixtures text[],
  p_sponsor_logo text default null, p_sponsor_color text default null,
  p_sponsor_url text default null, p_prize_structure text default 'top3',
  p_entry_deadline timestamptz default null, p_description text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if coalesce(trim(p_title), '') = '' then raise exception 'a title is required'; end if;
  if coalesce(array_length(p_fixtures, 1), 0) = 0 then raise exception 'pick at least one fixture'; end if;
  if exists (select 1 from unnest(p_fixtures) f where f not in (select id from public.fixtures)) then
    raise exception 'unknown fixture in the list';
  end if;
  insert into public.contests (id, title, sponsor, prize_zec, fixture_ids,
    sponsor_logo, sponsor_color, sponsor_url, prize_structure, entry_deadline, description)
  values (p_id, trim(p_title), nullif(trim(coalesce(p_sponsor, '')), ''), coalesce(p_prize, 0), p_fixtures,
    nullif(trim(coalesce(p_sponsor_logo, '')), ''), nullif(trim(coalesce(p_sponsor_color, '')), ''),
    nullif(trim(coalesce(p_sponsor_url, '')), ''), coalesce(p_prize_structure, 'top3'),
    p_entry_deadline, nullif(trim(coalesce(p_description, '')), ''))
  on conflict (id) do update set
    title = excluded.title, sponsor = excluded.sponsor, prize_zec = excluded.prize_zec,
    fixture_ids = excluded.fixture_ids, sponsor_logo = excluded.sponsor_logo,
    sponsor_color = excluded.sponsor_color, sponsor_url = excluded.sponsor_url,
    prize_structure = excluded.prize_structure, entry_deadline = excluded.entry_deadline,
    description = excluded.description
  where public.contests.status = 'open';
end $$;
revoke all on function public.admin_upsert_contest(text, text, text, numeric, text[], text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_upsert_contest(text, text, text, numeric, text[], text, text, text, text, timestamptz, text) to authenticated;

-- ---------- Close contest: flexible prize structures ----------
create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contests; w jsonb := '[]'::jsonb;
  shares_top3 numeric[] := array[0.5, 0.3, 0.2];
  shares_top10 numeric[] := array[0.25, 0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05];
  rec record; n int; total numeric := 0; i int := 0;
  winner_count int; each_share numeric; random_winner_id uuid;
begin
  perform public.require_admin();
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;

  if c.prize_structure = 'top3' then
    select least(count(distinct r.user_id), 3) into n
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids);
    for i in 1..n loop total := total + shares_top3[i]; end loop;
    i := 0;
    for rec in
      select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, sum(r.points) as points
      from public.rewards r
      join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
      left join public.profiles p on p.id = r.user_id
      where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      group by r.user_id, p.name order by 3 desc limit 3
    loop
      i := i + 1;
      w := w || jsonb_build_object('rank', i, 'name', rec.name, 'points', rec.points,
                                   'zec', case when total > 0 then round(c.prize_zec * shares_top3[i] / total, 8) else 0 end);
      if c.prize_zec > 0 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
                round(c.prize_zec * shares_top3[i] / total, 8), now(), true, 'contest:' || c.id)
        on conflict do nothing;
      end if;
    end loop;

  elsif c.prize_structure = 'top10' then
    select least(count(distinct r.user_id), 10) into n
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids);
    for i in 1..n loop total := total + shares_top10[i]; end loop;
    i := 0;
    for rec in
      select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, sum(r.points) as points
      from public.rewards r
      join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
      left join public.profiles p on p.id = r.user_id
      where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      group by r.user_id, p.name order by 3 desc limit 10
    loop
      i := i + 1;
      w := w || jsonb_build_object('rank', i, 'name', rec.name, 'points', rec.points,
                                   'zec', case when total > 0 then round(c.prize_zec * shares_top10[i] / total, 8) else 0 end);
      if c.prize_zec > 0 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
                round(c.prize_zec * shares_top10[i] / total, 8), now(), true, 'contest:' || c.id)
        on conflict do nothing;
      end if;
    end loop;

  elsif c.prize_structure = 'all_correct' then
    -- Split equally among everyone who got at least one exact score in the contest
    select count(distinct r.user_id) into winner_count
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points >= 50 and r.round = any (c.fixture_ids);
    if winner_count > 0 then
      each_share := round(c.prize_zec / winner_count, 8);
      for rec in
        select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, sum(r.points) as points
        from public.rewards r
        join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
        left join public.profiles p on p.id = r.user_id
        where r.verified and r.points >= 50 and r.round = any (c.fixture_ids)
        group by r.user_id, p.name order by 3 desc
      loop
        i := i + 1;
        w := w || jsonb_build_object('rank', i, 'name', rec.name, 'points', rec.points, 'zec', each_share);
        if c.prize_zec > 0 then
          insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
          values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' (exact score split)', 0,
                  each_share, now(), true, 'contest:' || c.id)
          on conflict do nothing;
        end if;
      end loop;
    end if;

  elsif c.prize_structure = 'random_draw' then
    -- Random winner from all entered players who scored any points
    select r.user_id into random_winner_id
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
    group by r.user_id
    order by random() limit 1;
    if random_winner_id is not null then
      select coalesce(nullif(p.name, ''), 'Player') into rec from public.profiles p where p.id = random_winner_id;
      w := w || jsonb_build_object('rank', 1, 'name', coalesce(rec.name, 'Player'), 'points', 0, 'zec', c.prize_zec);
      if c.prize_zec > 0 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (random_winner_id, 'prize_' || c.id || '_draw', 'Prize · ' || c.title || ' (lucky draw)', 0,
                c.prize_zec, now(), true, 'contest:' || c.id)
        on conflict do nothing;
      end if;
    end if;
  end if;

  update public.contests set status = 'closed', winners = w where id = p_id;
  return w;
end $$;

-- ---------- Seal count per fixture (for the home screen) ----------
-- Add an index to speed up the count
create index if not exists seals_round_game on public.seals (round, game) where game = 'classic';

-- ---------- Player stats: streaks, called-it count ----------
create or replace function public.player_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'called_it', (select count(*) from public.rewards where user_id = auth.uid() and verified and points >= 50),
    'total_seals', (select count(*) from public.seals where user_id = auth.uid()),
    'total_ranked', (select coalesce(sum(points), 0) from public.rewards where user_id = auth.uid() and verified),
    'exact_scores', (select count(*) from public.rewards where user_id = auth.uid() and verified and points >= 50),
    'early_birds', (select count(*) from public.rewards where user_id = auth.uid() and verified and label like '%x2%')
  )
$$;
grant execute on function public.player_stats() to anon, authenticated;

-- ---------- Reveal stats: how others did on a fixture ----------
create or replace function public.fixture_reveal_stats(p_fixture_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total_seals', count(*),
    'total_scored', count(*) filter (where r.points > 0),
    'exact_scores', count(*) filter (where r.points >= 50),
    'your_percentile', (
      select round(100.0 * rank / greatest(total, 1))
      from (
        select user_id, rank() over (order by points desc) as rank, count(*) over () as total
        from public.rewards where verified and round = p_fixture_id
      ) sub where sub.user_id = auth.uid()
    )
  )
  from public.rewards r
  where r.verified and r.round = p_fixture_id
$$;
grant execute on function public.fixture_reveal_stats(text) to anon, authenticated;
