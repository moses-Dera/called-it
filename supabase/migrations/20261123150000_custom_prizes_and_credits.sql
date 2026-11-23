-- Migration: Configurable prize structures, custom winner splits, and direct player credits
-- 1. Expands contest prize structures to include top3, top5, top10, top20, custom, equal_split
-- 2. Adds custom_shares numeric[] to public.contests
-- 3. Updates admin_close_contest to handle any number of winners and custom percentages
-- 4. Adds admin_credit_player and admin_credit_players_batch to award ZEC / points directly to any set of players
-- 5. Adds admin_list_all_players for searching and selecting recipients

alter table public.contests drop constraint if exists contests_prize_structure_check;
alter table public.contests add constraint contests_prize_structure_check
  check (prize_structure in ('top3', 'top5', 'top10', 'top20', 'all_correct', 'random_draw', 'custom', 'equal_split'));

alter table public.contests add column if not exists custom_shares numeric[];

-- Update admin_upsert_contest to accept custom_shares
create or replace function public.admin_upsert_contest(
  p_id text, p_title text, p_sponsor text, p_prize numeric, p_fixtures text[],
  p_sponsor_logo text default null, p_sponsor_color text default null, p_sponsor_url text default null,
  p_prize_structure text default 'top3', p_entry_deadline timestamptz default null, p_description text default null,
  p_custom_shares numeric[] default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  insert into public.contests (
    id, title, sponsor, prize_zec, fixture_ids,
    sponsor_logo, sponsor_color, sponsor_url,
    prize_structure, entry_deadline, description, custom_shares
  ) values (
    p_id, p_title, nullif(trim(p_sponsor), ''), greatest(0, p_prize), p_fixtures,
    nullif(trim(p_sponsor_logo), ''), nullif(trim(p_sponsor_color), ''), nullif(trim(p_sponsor_url), ''),
    p_prize_structure, p_entry_deadline, nullif(trim(p_description), ''), p_custom_shares
  ) on conflict (id) do update set
    title = excluded.title, sponsor = excluded.sponsor, prize_zec = excluded.prize_zec,
    fixture_ids = excluded.fixture_ids, sponsor_logo = excluded.sponsor_logo,
    sponsor_color = excluded.sponsor_color, sponsor_url = excluded.sponsor_url,
    prize_structure = excluded.prize_structure, entry_deadline = excluded.entry_deadline,
    description = excluded.description, custom_shares = excluded.custom_shares
  where public.contests.status = 'open';
end $$;

revoke all on function public.admin_upsert_contest(text, text, text, numeric, text[], text, text, text, text, timestamptz, text, numeric[]) from public, anon;
grant execute on function public.admin_upsert_contest(text, text, text, numeric, text[], text, text, text, text, timestamptz, text, numeric[]) to authenticated;

-- Close contest: handles top3, top5, top10, top20, custom shares, equal split, etc.
create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contests; w jsonb := '[]'::jsonb;
  shares_top3 numeric[]  := array[0.50, 0.30, 0.20];
  shares_top5 numeric[]  := array[0.40, 0.25, 0.15, 0.10, 0.10];
  shares_top10 numeric[] := array[0.25, 0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05];
  shares_top20 numeric[] := array[0.20, 0.12, 0.10, 0.08, 0.06, 0.05, 0.05, 0.05, 0.04, 0.04,
                                  0.03, 0.03, 0.03, 0.03, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01];
  active_shares numeric[];
  rec record; n int; total numeric := 0; i int := 0;
  winner_count int; each_share numeric; random_winner_id uuid;
  max_winners int;
begin
  if auth.uid() is not null then
    perform public.require_admin();
  end if;

  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;

  -- Determine active shares array based on structure
  if c.prize_structure = 'top3' then
    active_shares := shares_top3;
  elsif c.prize_structure = 'top5' then
    active_shares := shares_top5;
  elsif c.prize_structure = 'top10' then
    active_shares := shares_top10;
  elsif c.prize_structure = 'top20' then
    active_shares := shares_top20;
  elsif c.prize_structure = 'custom' and c.custom_shares is not null and array_length(c.custom_shares, 1) > 0 then
    active_shares := c.custom_shares;
  elsif c.prize_structure = 'equal_split' then
    max_winners := coalesce(c.custom_shares[1]::int, 5);
    active_shares := array_fill(1.0::numeric, array[max_winners]);
  end if;

  -- Tiered / share-based distribution (top3, top5, top10, top20, custom, equal_split)
  if active_shares is not null then
    max_winners := array_length(active_shares, 1);
    select least(count(distinct r.user_id), max_winners) into n
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids);

    for i in 1..n loop total := total + active_shares[i]; end loop;
    i := 0;
    for rec in
      select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, coalesce(p.address, '') as address, sum(r.points) as points
      from public.rewards r
      join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
      left join public.profiles p on p.id = r.user_id
      where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      group by r.user_id, p.name, p.address order by 4 desc limit max_winners
    loop
      i := i + 1;
      each_share := case when total > 0 then round(c.prize_zec * active_shares[i] / total, 8) else 0 end;
      w := w || jsonb_build_object(
        'rank', i, 'name', rec.name, 'points', rec.points,
        'user_id', rec.user_id, 'address', rec.address,
        'zec', each_share,
        'status', 'pending', 'txid', null
      );
      if c.prize_zec > 0 and each_share > 0 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
                each_share, now(), true, 'contest:' || c.id)
        on conflict do nothing;
      end if;
    end loop;

  elsif c.prize_structure = 'all_correct' then
    select count(distinct r.user_id) into winner_count
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points >= 50 and r.round = any (c.fixture_ids);
    if winner_count > 0 then
      each_share := round(c.prize_zec / winner_count, 8);
      for rec in
        select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, coalesce(p.address, '') as address, sum(r.points) as points
        from public.rewards r
        join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
        left join public.profiles p on p.id = r.user_id
        where r.verified and r.points >= 50 and r.round = any (c.fixture_ids)
        group by r.user_id, p.name, p.address order by 4 desc
      loop
        i := i + 1;
        w := w || jsonb_build_object(
          'rank', i, 'name', rec.name, 'points', rec.points, 'zec', each_share,
          'user_id', rec.user_id, 'address', rec.address,
          'status', 'pending', 'txid', null
        );
        if c.prize_zec > 0 then
          insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
          values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' (exact score split)', 0,
                  each_share, now(), true, 'contest:' || c.id)
          on conflict do nothing;
        end if;
      end loop;
    end if;

  elsif c.prize_structure = 'random_draw' then
    select r.user_id into random_winner_id
    from public.rewards r
    join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
    group by r.user_id
    order by random() limit 1;
    if random_winner_id is not null then
      select coalesce(nullif(p.name, ''), 'Player') as name, coalesce(p.address, '') as address into rec
      from public.profiles p where p.id = random_winner_id;
      w := w || jsonb_build_object(
        'rank', 1, 'name', coalesce(rec.name, 'Player'), 'points', 0, 'zec', c.prize_zec,
        'user_id', random_winner_id, 'address', coalesce(rec.address, ''),
        'status', 'pending', 'txid', null
      );
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

-- ---------- Admin Direct Credits ----------
-- Credit an individual player an arbitrary amount of ZEC and/or ranked points
create or replace function public.admin_credit_player(
  p_user_id uuid,
  p_zec numeric,
  p_points int default 0,
  p_label text default 'Bonus Award'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  reward_id text := 'award_' || substr(md5(random()::text), 1, 12);
begin
  perform public.require_admin();
  if p_user_id is null then raise exception 'user id required'; end if;
  if p_zec <= 0 and p_points <= 0 then raise exception 'amount or points must be > 0'; end if;

  insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
  values (p_user_id, reward_id, p_label, greatest(0, p_points), greatest(0, p_zec), now(), true, 'manual:credit');

  return jsonb_build_object('ok', true, 'reward_id', reward_id, 'user_id', p_user_id, 'zec', p_zec, 'points', p_points);
end $$;

revoke all on function public.admin_credit_player(uuid, numeric, int, text) from public, anon;
grant execute on function public.admin_credit_player(uuid, numeric, int, text) to authenticated;

-- Credit a batch of players with the same amount
create or replace function public.admin_credit_players_batch(
  p_user_ids uuid[],
  p_zec numeric,
  p_points int default 0,
  p_label text default 'Community Award'
) returns int language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  reward_id text;
  c int := 0;
begin
  perform public.require_admin();
  if p_user_ids is null or array_length(p_user_ids, 1) = 0 then raise exception 'user ids required'; end if;
  if p_zec <= 0 and p_points <= 0 then raise exception 'amount or points must be > 0'; end if;

  foreach uid in array p_user_ids loop
    reward_id := 'award_' || substr(md5(random()::text || uid::text), 1, 12);
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (uid, reward_id, p_label, greatest(0, p_points), greatest(0, p_zec), now(), true, 'manual:batch_credit');
    c := c + 1;
  end loop;

  return c;
end $$;

revoke all on function public.admin_credit_players_batch(uuid[], numeric, int, text) from public, anon;
grant execute on function public.admin_credit_players_batch(uuid[], numeric, int, text) to authenticated;

-- List players directory for admin search & credit
create or replace function public.admin_list_all_players(p_search text default null)
returns table (id uuid, name text, address text, avatar int, ranked_points bigint, earned_zec numeric)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    coalesce(nullif(p.name, ''), 'Player') as name,
    p.address,
    p.avatar,
    coalesce(sum(r.points) filter (where r.verified), 0) as ranked_points,
    coalesce(sum(r.zec) filter (where r.verified), 0) as earned_zec
  from public.profiles p
  left join public.rewards r on r.user_id = p.id
  where (coalesce(p_search, '') = '' or p.name ilike '%' || p_search || '%' or p.address ilike '%' || p_search || '%')
  group by p.id, p.name, p.address, p.avatar
  order by ranked_points desc, p.name asc limit 50;
$$;

revoke all on function public.admin_list_all_players(text) from public, anon;
grant execute on function public.admin_list_all_players(text) to authenticated;
