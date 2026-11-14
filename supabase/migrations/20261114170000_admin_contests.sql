-- Called It: admin, contests and sponsors. Applied with `npx supabase db push --remote`.
--
-- Admin: the first signed-in user who opens /admin and presses "Claim admin" becomes admin (only while
-- nobody is). Everything admin-only goes through the security-definer functions below; the tables
-- themselves have no write policies.

-- ---------- Admins ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security; -- no policies: only reachable through functions

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.admin_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('is_admin', public.is_admin(), 'has_admins', exists (select 1 from public.admins))
$$;
grant execute on function public.admin_status() to anon, authenticated;

create or replace function public.claim_first_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  lock table public.admins in exclusive mode;
  if exists (select 1 from public.admins) then return public.is_admin(); end if;
  insert into public.admins (user_id) values (auth.uid());
  return true;
end $$;
revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;

create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
end $$;
revoke all on function public.require_admin() from public, anon;

-- ---------- Fixtures ----------
create or replace function public.admin_upsert_fixture(p_id text, p_home text, p_away text, p_kickoff timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_id !~ '^[a-z0-9-]{3,64}$' then raise exception 'fixture id: 3-64 lowercase letters, digits or dashes'; end if;
  if coalesce(trim(p_home), '') = '' or coalesce(trim(p_away), '') = '' then raise exception 'both team names are required'; end if;
  insert into public.fixtures (id, home, away, kickoff) values (p_id, trim(p_home), trim(p_away), p_kickoff)
  on conflict (id) do update set home = excluded.home, away = excluded.away, kickoff = excluded.kickoff;
end $$;

create or replace function public.admin_set_result(p_id text, p_home int, p_away int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if (p_home is null) <> (p_away is null) then raise exception 'enter both scores, or clear both'; end if;
  update public.fixtures set home_goals = p_home, away_goals = p_away where id = p_id;
  if not found then raise exception 'unknown fixture'; end if;
end $$;

-- ---------- Contests (optionally sponsored, with a testnet ZEC prize pot) ----------
create table if not exists public.contests (
  id text primary key check (id ~ '^[a-z0-9-]{3,64}$'),
  title text not null,
  sponsor text,
  prize_zec numeric not null default 0 check (prize_zec >= 0),
  fixture_ids text[] not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  winners jsonb,
  created_at timestamptz not null default now()
);
alter table public.contests enable row level security;
drop policy if exists "contests are public" on public.contests;
create policy "contests are public" on public.contests for select to anon, authenticated using (true);

-- Prize rewards carry ZEC but no points, so allow zero points on verified rows only.
alter table public.rewards drop constraint if exists rewards_points_check;
alter table public.rewards add constraint rewards_points_check check (points > 0 or (verified and points = 0 and zec > 0));

create or replace function public.admin_upsert_contest(p_id text, p_title text, p_sponsor text, p_prize numeric, p_fixtures text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if coalesce(trim(p_title), '') = '' then raise exception 'a title is required'; end if;
  if coalesce(array_length(p_fixtures, 1), 0) = 0 then raise exception 'pick at least one fixture'; end if;
  if exists (select 1 from unnest(p_fixtures) f where f not in (select id from public.fixtures)) then raise exception 'unknown fixture in the list'; end if;
  insert into public.contests (id, title, sponsor, prize_zec, fixture_ids)
  values (p_id, trim(p_title), nullif(trim(coalesce(p_sponsor, '')), ''), coalesce(p_prize, 0), p_fixtures)
  on conflict (id) do update set title = excluded.title, sponsor = excluded.sponsor, prize_zec = excluded.prize_zec, fixture_ids = excluded.fixture_ids
  where public.contests.status = 'open';
end $$;

-- Ranked (verified) points from the contest's fixtures only.
create or replace function public.contest_leaderboard(p_id text)
returns table (rank bigint, name text, avatar int, points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by sum(r.points) desc), coalesce(nullif(p.name, ''), 'Player'), coalesce(p.avatar, 1),
         sum(r.points)::bigint, r.user_id = auth.uid()
  from public.rewards r
  join public.contests c on c.id = p_id
  left join public.profiles p on p.id = r.user_id
  where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
  group by r.user_id, p.name, p.avatar
  order by 4 desc
  limit 50
$$;
grant execute on function public.contest_leaderboard(text) to anon, authenticated;

-- Close a contest: the top three by ranked points share the pot 50/30/20 (fewer players: renormalised).
create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests; w jsonb := '[]'::jsonb; shares numeric[] := array[0.5, 0.3, 0.2]; total numeric; rec record; i int := 0;
begin
  perform public.require_admin();
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;
  create temporary table top on commit drop as
    select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, sum(r.points) as points
    from public.rewards r left join public.profiles p on p.id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
    group by r.user_id, p.name order by 3 desc limit 3;
  select coalesce(sum(shares[n]), 0) into total from generate_series(1, (select count(*)::int from top)) n;
  for rec in select * from top order by points desc loop
    i := i + 1;
    w := w || jsonb_build_object('rank', i, 'name', rec.name, 'points', rec.points,
                                 'zec', case when total > 0 then round(c.prize_zec * shares[i] / total, 8) else 0 end);
    if c.prize_zec > 0 and total > 0 then
      insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
      values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
              round(c.prize_zec * shares[i] / total, 8), now(), true, 'contest:' || c.id)
      on conflict do nothing;
    end if;
  end loop;
  update public.contests set status = 'closed', winners = w where id = p_id;
  return w;
end $$;

-- ---------- Overview and payouts ----------
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'seals', (select count(*) from public.seals),
    'ranked_points', (select coalesce(sum(points), 0) from public.rewards where verified),
    'requested_zec', (select coalesce(sum(amount), 0) from public.withdrawals where status = 'requested'),
    'withdrawals', (select coalesce(jsonb_agg(w order by w.created_at desc), '[]'::jsonb) from (
        select w.id, w.address, w.amount, w.status, w.txid, w.created_at, coalesce(nullif(p.name, ''), 'Player') as name
        from public.withdrawals w left join public.profiles p on p.id = w.user_id
        order by w.created_at desc limit 50) w)
  );
end $$;

create or replace function public.admin_mark_withdrawal(p_id uuid, p_status text, p_txid text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('requested', 'paid', 'rejected') then raise exception 'bad status'; end if;
  update public.withdrawals set status = p_status, txid = coalesce(nullif(trim(p_txid), ''), txid) where id = p_id;
end $$;

revoke all on function public.admin_upsert_fixture(text, text, text, timestamptz) from public, anon;
revoke all on function public.admin_set_result(text, int, int) from public, anon;
revoke all on function public.admin_upsert_contest(text, text, text, numeric, text[]) from public, anon;
revoke all on function public.admin_close_contest(text) from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_mark_withdrawal(uuid, text, text) from public, anon;
grant execute on function public.admin_upsert_fixture(text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_set_result(text, int, int) to authenticated;
grant execute on function public.admin_upsert_contest(text, text, text, numeric, text[]) to authenticated;
grant execute on function public.admin_close_contest(text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_mark_withdrawal(uuid, text, text) to authenticated;
