-- Called It: show every registered player on the leaderboard, give admins a transaction record,
-- and close contests without a temporary table. Applied with `npx supabase db push --remote`.

-- ---------- Leaderboard: every registered player, ranked by verified points (0 until scored) ----------
create or replace function public.leaderboard(p_period text default 'week')
returns table (rank bigint, name text, avatar int, points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by coalesce(sum(r.points), 0) desc), coalesce(nullif(p.name, ''), 'Player'), p.avatar,
         coalesce(sum(r.points), 0)::bigint, p.id = auth.uid()
  from public.profiles p
  left join public.rewards r on r.user_id = p.id and r.verified and r.points > 0
    and (p_period = 'all' or r.at >= date_trunc('week', now()))
  group by p.id, p.name, p.avatar
  order by 4 desc, 2 asc
  limit 50
$$;
grant execute on function public.leaderboard(text) to anon, authenticated;

-- ---------- Close a contest (top three share the pot 50/30/20, renormalised for fewer players) ----------
create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests; w jsonb := '[]'::jsonb; shares numeric[] := array[0.5, 0.3, 0.2];
        rec record; n int; total numeric := 0; i int := 0;
begin
  perform public.require_admin();
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;
  select least(count(distinct r.user_id), 3) into n from public.rewards r
  where r.verified and r.points > 0 and r.round = any (c.fixture_ids);
  for i in 1..n loop total := total + shares[i]; end loop;
  i := 0;
  for rec in
    select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, sum(r.points) as points
    from public.rewards r left join public.profiles p on p.id = r.user_id
    where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
    group by r.user_id, p.name order by 3 desc limit 3
  loop
    i := i + 1;
    w := w || jsonb_build_object('rank', i, 'name', rec.name, 'points', rec.points,
                                 'zec', case when total > 0 then round(c.prize_zec * shares[i] / total, 8) else 0 end);
    if c.prize_zec > 0 then
      insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
      values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
              round(c.prize_zec * shares[i] / total, 8), now(), true, 'contest:' || c.id)
      on conflict do nothing;
    end if;
  end loop;
  update public.contests set status = 'closed', winners = w where id = p_id;
  return w;
end $$;

-- ---------- Transaction record for admins: anchors and payouts, no explorer needed ----------
create or replace function public.admin_transactions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'anchors', (select coalesce(jsonb_agg(a order by a.last_seal desc), '[]'::jsonb) from (
        select txid, max(height) as height, min(root) as root, count(*) as seals,
               count(distinct user_id) as players, max(received_at) as last_seal
        from public.seals where txid is not null and mode = 'testnet'
        group by txid order by max(received_at) desc limit 100) a),
    'payouts', (select coalesce(jsonb_agg(w order by w.created_at desc), '[]'::jsonb) from (
        select w.txid, w.amount, w.address, w.created_at, coalesce(nullif(p.name, ''), 'Player') as name
        from public.withdrawals w left join public.profiles p on p.id = w.user_id
        where w.status = 'paid' order by w.created_at desc limit 100) w)
  );
end $$;
revoke all on function public.admin_transactions() from public, anon;
grant execute on function public.admin_transactions() to authenticated;
