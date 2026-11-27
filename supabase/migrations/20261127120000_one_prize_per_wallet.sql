-- New accounts can win again; instead, one prize per wallet in each contest.
--
-- The 24-hour account-age rule (20261127090000) stopped extra accounts made on the spot, but it also stopped
-- every genuine new fan from winning on their first day. Extra accounts usually point at the same wallet, so
-- the rule is now: when a contest closes, a winner whose wallet address already won a higher place in that
-- contest is skipped and the next player moves up. Games against the same opponents still count at most twice.

create or replace function public.contest_scores(p_id text)
returns table (user_id uuid, points bigint)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.contests where id = p_id),
  football as (
    select r.user_id, sum(r.points)::bigint as pts
    from c, public.rewards r
    where c.game = 'football' and r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      and exists (select 1 from public.contest_entries ce where ce.contest_id = c.id and ce.user_id = r.user_id)
    group by r.user_id
  ),
  per_room as (
    select r.user_id, rm.id as room_id, sum(r.points) as pts,
      (select array_agg(rp.user_id order by rp.user_id) from public.room_players rp
        where rp.room_id = rm.id and rp.state = 'joined' and rp.user_id <> r.user_id) as others
    from c
    join public.rooms rm on rm.contest_id = c.id and rm.game = c.game
    join public.rewards r on r.round like 'room:' || rm.id::text || ':%'
    where c.game <> 'football' and r.verified and r.points > 0
      and r.at >= coalesce(c.opens_at, c.created_at) and r.at <= c.ends_at
      and exists (select 1 from public.contest_entries ce where ce.contest_id = c.id and ce.user_id = r.user_id)
    group by r.user_id, rm.id
  ),
  capped as (
    select user_id, pts, row_number() over (partition by user_id, others order by pts desc) as n from per_room
  )
  select user_id, pts from football
  union all
  select user_id, sum(pts)::bigint from capped where n <= 2 group by user_id
$$;
revoke all on function public.contest_scores(text) from public, anon, authenticated;

-- Ranked players for a close: best score first, skipping anyone whose wallet already appears higher up.
create or replace function public.contest_ranked(p_id text)
returns table (user_id uuid, points bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select s.user_id, s.points, nullif(lower(trim(coalesce(p.address, ''))), '') as addr,
      row_number() over (order by s.points desc, s.user_id) as pos
    from public.contest_scores(p_id) s left join public.profiles p on p.id = s.user_id
    where s.points > 0
  )
  select user_id, points from s
  where addr is null or not exists (select 1 from s s2 where s2.addr = s.addr and s2.pos < s.pos)
  order by points desc, user_id
$$;
revoke all on function public.contest_ranked(text) from public, anon, authenticated;

create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contests; w jsonb := '[]'::jsonb; shares numeric[]; rec record;
  n int; total numeric := 0; i int := 0; each_share numeric; cnt int;
begin
  if auth.uid() is not null then perform public.require_admin(); end if;
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;

  shares := case c.prize_structure
    when 'top3' then array[0.50, 0.30, 0.20]
    when 'top5' then array[0.40, 0.25, 0.15, 0.10, 0.10]
    when 'top10' then array[0.25, 0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05]
    when 'top20' then array[0.20, 0.12, 0.10, 0.08, 0.06, 0.05, 0.05, 0.05, 0.04, 0.04, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01]
    when 'custom' then c.custom_shares
    when 'equal_split' then array_fill(1.0::numeric, array[coalesce(c.custom_shares[1]::int, 5)])
  end;

  if c.prize_structure = 'all_correct' then
    select count(*) into cnt from public.contest_ranked(c.id) s
      where exists (select 1 from public.rewards r where r.user_id = s.user_id and r.verified and r.points >= 50 and r.round = any (c.fixture_ids));
    each_share := case when cnt > 0 then round(c.prize_zec / cnt, 8) else 0 end;
    for rec in select s.user_id, s.points from public.contest_ranked(c.id) s
      where exists (select 1 from public.rewards r where r.user_id = s.user_id and r.verified and r.points >= 50 and r.round = any (c.fixture_ids))
    loop
      i := i + 1;
      w := w || public.contest_winner(c, rec.user_id, rec.points, i, each_share);
    end loop;
  elsif c.prize_structure = 'random_draw' then
    select s.user_id, s.points into rec from public.contest_ranked(c.id) s order by random() limit 1;
    if found then w := w || public.contest_winner(c, rec.user_id, rec.points, 1, c.prize_zec); end if;
  elsif shares is not null then
    select least(count(*), array_length(shares, 1)) into n from public.contest_ranked(c.id);
    for k in 1..coalesce(n, 0) loop total := total + shares[k]; end loop;
    for rec in select s.user_id, s.points from public.contest_ranked(c.id) s limit n loop
      i := i + 1;
      each_share := case when total > 0 then round(c.prize_zec * shares[i] / total, 8) else 0 end;
      w := w || public.contest_winner(c, rec.user_id, rec.points, i, each_share);
    end loop;
  end if;

  update public.contests set status = 'closed', winners = w where id = p_id;
  return w;
end $$;
revoke all on function public.admin_close_contest(text) from public, anon;
grant execute on function public.admin_close_contest(text) to authenticated, service_role;
