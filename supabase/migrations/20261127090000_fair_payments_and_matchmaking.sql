-- Fair payments, fresh-account limits and quick matches.
--
-- Payments (a winner can no longer trap an honest sponsor):
--   * Every status change records status_at.
--   * A prize the sponsor marked sent WITH a transaction ID, and the winner hasn't disputed within 7 days,
--     counts as paid automatically.
--   * A sponsor is only "overdue" for winners still waiting (pending) after the 72 hours who have a valid
--     address. A winner with no address can't be paid, so that is not the sponsor's fault; after 30 days
--     without an address the prize is marked unclaimed and stops counting against the sponsor.
--   * Disputes go to the admin, who rules paid or not paid (not paid gives the sponsor 72 more hours).
-- Fresh accounts: accounts less than 24 hours old can play but can't rank in a contest, and games against
--   them don't count. Spinning up extra accounts on the spot no longer wins anything.
-- Quick match: one tap joins a waiting game in a contest, or opens one.

-- ---------- Helpers ----------
create or replace function public.sponsor_set_winner(p_contest_id text, p_rank int, p_from text[], p_to text, p_txid text)
returns boolean language plpgsql security definer set search_path = public as $$
declare w jsonb; hit boolean := false;
begin
  select coalesce(jsonb_agg(case when (x->>'rank')::int = p_rank and coalesce(x->>'status', 'pending') = any (p_from)
      then x || jsonb_build_object('status', p_to, 'status_at', now())
             || case when p_txid is null then '{}'::jsonb else jsonb_build_object('txid', p_txid) end
      else x end order by (x->>'rank')::int), '[]'::jsonb),
    bool_or((x->>'rank')::int = p_rank and coalesce(x->>'status', 'pending') = any (p_from))
  into w, hit
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where c.id = p_contest_id;
  if coalesce(hit, false) then update public.contests set winners = w where id = p_contest_id; end if;
  return coalesce(hit, false);
end $$;
revoke all on function public.sponsor_set_winner(text, int, text[], text, text) from public, anon, authenticated;

-- A sponsor prize that still needs something from the sponsor or the winner.
create or replace function public.prize_open(w jsonb) returns boolean language sql immutable as $$
  select coalesce((w->>'zec')::numeric, 0) > 0 and coalesce(w->>'status', 'pending') not in ('paid', 'unclaimed')
$$;

-- Late: the 72 hours passed and the winner, who has a valid address, is still waiting.
create or replace function public.prize_overdue(c public.contests, w jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select c.pay_by < now() and coalesce((w->>'zec')::numeric, 0) > 0 and coalesce(w->>'status', 'pending') = 'pending'
    and exists (select 1 from public.profiles p where p.id = (w->>'user_id')::uuid
                and public.is_shielded_for(coalesce(p.address, ''), public.app_network()))
$$;

create or replace function public.sponsor_owed(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum((w->>'zec')::numeric), 0)
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
  where c.owner_id = p_owner and c.status = 'closed' and public.prize_open(w)
$$;
revoke all on function public.sponsor_owed(uuid) from public, anon, authenticated;

create or replace function public.sponsor_records()
returns table (owner_id uuid, contests bigint, paid_contests bigint, overdue_contests bigint, paid_zec numeric)
language sql stable security definer set search_path = public as $$
  select c.owner_id,
    count(*) filter (where c.status = 'closed' and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where (w->>'zec')::numeric > 0)),
    count(*) filter (where c.status = 'closed' and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where (w->>'zec')::numeric > 0)
                       and not exists (select 1 from jsonb_array_elements(c.winners) w where public.prize_open(w))),
    count(*) filter (where c.status = 'closed' and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where public.prize_overdue(c, w))),
    public.sponsor_paid_total(c.owner_id)
  from public.contests c where c.owner_id is not null group by c.owner_id
$$;
grant execute on function public.sponsor_records() to anon, authenticated;

create or replace function public.contests_sponsor_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare late text; promised numeric; lim numeric;
begin
  if new.owner_id is null or new.status <> 'open' or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.prize_zec = old.prize_zec then return new; end if;
  if tg_op = 'INSERT' then
    select title into late from public.contests c
    where c.owner_id = new.owner_id and c.status = 'closed'
      and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where public.prize_overdue(c, w))
    limit 1;
    if late is not null then
      raise exception 'winners of "%" are still waiting to be paid. Pay them before starting another contest', late;
    end if;
  end if;
  select coalesce(sum(prize_zec), 0) into promised from public.contests
  where owner_id = new.owner_id and status = 'open' and id <> new.id;
  promised := promised + public.sponsor_owed(new.owner_id) + new.prize_zec;
  lim := public.sponsor_limit(new.owner_id);
  if promised > lim then
    raise exception 'your prize limit is % ZEC in total (open prizes plus unpaid winners). It grows by every ZEC your winners confirm they received', lim;
  end if;
  return new;
end $$;

-- ---------- Automatic settling (run by the server every 15 minutes) ----------
create or replace function public.auto_settle_prizes() returns int
language plpgsql security definer set search_path = public as $$
declare c public.contests; w jsonb; n int := 0;
begin
  for c in select * from public.contests where owner_id is not null and status = 'closed' and winners is not null for update loop
    for w in select * from jsonb_array_elements(c.winners) loop
      -- Sent with a transaction ID, not disputed for 7 days: paid.
      if w->>'status' = 'sent' and coalesce(w->>'txid', '') <> '' and coalesce((w->>'status_at')::timestamptz, c.pay_by) < now() - interval '7 days' then
        perform public.sponsor_set_winner(c.id, (w->>'rank')::int, array['sent'], 'paid', null); n := n + 1;
      -- Still no address 30 days after closing: unclaimed.
      elsif coalesce(w->>'status', 'pending') = 'pending' and c.pay_by < now() + interval '72 hours' - interval '30 days'
        and not exists (select 1 from public.profiles p where p.id = (w->>'user_id')::uuid
                        and public.is_shielded_for(coalesce(p.address, ''), public.app_network())) then
        perform public.sponsor_set_winner(c.id, (w->>'rank')::int, array['pending'], 'unclaimed', null); n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.auto_settle_prizes() from public, anon, authenticated;
grant execute on function public.auto_settle_prizes() to service_role;

-- ---------- Disputes, for the admin ----------
create or replace function public.admin_prize_disputes()
returns table (contest_id text, title text, sponsor text, rank int, winner text, zec numeric, txid text, status_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
    select c.id, c.title, c.sponsor, (w->>'rank')::int, w->>'name', (w->>'zec')::numeric, w->>'txid', (w->>'status_at')::timestamptz
    from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
    where c.owner_id is not null and w->>'status' = 'disputed'
    order by (w->>'status_at')::timestamptz nulls first;
end $$;
revoke all on function public.admin_prize_disputes() from public, anon;
grant execute on function public.admin_prize_disputes() to authenticated;

create or replace function public.admin_resolve_prize(p_contest_id text, p_rank int, p_paid boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_paid then
    return public.sponsor_set_winner(p_contest_id, p_rank, array['disputed', 'sent', 'pending'], 'paid', null);
  end if;
  if not public.sponsor_set_winner(p_contest_id, p_rank, array['disputed', 'sent'], 'pending', null) then return false; end if;
  update public.contests set pay_by = greatest(pay_by, now() + interval '72 hours') where id = p_contest_id;
  return true;
end $$;
revoke all on function public.admin_resolve_prize(text, int, boolean) from public, anon;
grant execute on function public.admin_resolve_prize(text, int, boolean) to authenticated;

-- ---------- Scores: fresh accounts can't rank, and games against them don't count ----------
create or replace function public.contest_scores(p_id text)
returns table (user_id uuid, points bigint)
language sql stable security definer set search_path = public, auth as $$
  with c as (select * from public.contests where id = p_id),
  cutoff as (select least(now(), coalesce(c.ends_at, now())) - interval '24 hours' as t from c),
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
      and not exists (select 1 from public.room_players rp join auth.users u on u.id = rp.user_id
                      where rp.room_id = rm.id and rp.state = 'joined' and u.created_at > r.at - interval '24 hours')
    group by r.user_id, rm.id
  ),
  capped as (
    select user_id, pts, row_number() over (partition by user_id, others order by pts desc) as n from per_room
  ),
  scores as (
    select user_id, pts from football
    union all
    select user_id, sum(pts)::bigint from capped where n <= 2 group by user_id
  )
  select s.user_id, s.pts from scores s, cutoff
  where exists (select 1 from auth.users u where u.id = s.user_id and u.created_at <= cutoff.t)
$$;
revoke all on function public.contest_scores(text) from public, anon, authenticated;

-- ---------- Quick match ----------
create or replace function public.contest_quick_match(p_contest text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.contests; code text; cap int;
begin
  if uid is null then raise exception 'sign in to play'; end if;
  select * into c from public.contests where id = p_contest;
  if not found or c.game = 'football' then raise exception 'this contest has no game rooms'; end if;
  cap := case c.game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end;
  -- Already waiting in one of this contest's games: go back to it.
  select r.code into code from public.rooms r join public.room_players p on p.room_id = r.id and p.user_id = uid and p.state = 'joined'
    where r.contest_id = c.id and r.status = 'lobby' order by r.created_at desc limit 1;
  if code is null then
    select r.code into code from public.rooms r
      where r.contest_id = c.id and r.status = 'lobby' and r.created_at > now() - interval '1 day'
        and (select count(*) from public.room_players p where p.room_id = r.id and p.state = 'joined') < cap
      order by r.created_at limit 1;
  end if;
  if code is not null then return public.join_room(code); end if;
  return (public.create_contest_room(p_contest) ->> 'id')::uuid;
end $$;
revoke all on function public.contest_quick_match(text) from public, anon;
grant execute on function public.contest_quick_match(text) to authenticated;
