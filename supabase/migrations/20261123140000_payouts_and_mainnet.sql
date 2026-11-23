-- Migration: Enable Zcash Mainnet addresses, Per-Winner Release Tracking & Sponsor Payouts
-- 1. Updates request_withdrawal to accept mainnet (u1..., zs1...) and testnet (utest1..., ztestsapling1...)
-- 2. Updates admin_close_contest so winners JSON array includes recipient shielded addresses, user_ids & status.
-- 3. Adds admin_mark_contest_winner_paid function to track individual winner releases.

create or replace function public.request_withdrawal(p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  earned numeric;
  taken numeric;
  available numeric;
  w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  -- Accepts Mainnet Unified Address (u1...), Testnet Unified Address (utest1...), or Sapling (zs1.../ztestsapling1...)
  if p_address !~ '^(u|utest|zs|ztestsapling)1[a-z0-9]{20,}$' then
    raise exception 'use a valid shielded Zcash address (u1… for mainnet or utest1… for testnet)';
  end if;

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  available := earned - taken;

  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', available);
  end if;

  insert into public.withdrawals (user_id, address, amount)
  values (uid, p_address, available)
  returning * into w;

  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'id', w.id);
end $$;

revoke all on function public.request_withdrawal(text) from public, anon;
grant execute on function public.request_withdrawal(text) to authenticated;

-- Close contest: includes winner addresses, user_ids & individual payout status
create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contests; w jsonb := '[]'::jsonb;
  shares_top3 numeric[] := array[0.5, 0.3, 0.2];
  shares_top10 numeric[] := array[0.25, 0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05];
  rec record; n int; total numeric := 0; i int := 0;
  winner_count int; each_share numeric; random_winner_id uuid;
begin
  -- Service role or admin can close
  if auth.uid() is not null then
    perform public.require_admin();
  end if;

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
      select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, coalesce(p.address, '') as address, sum(r.points) as points
      from public.rewards r
      join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
      left join public.profiles p on p.id = r.user_id
      where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      group by r.user_id, p.name, p.address order by 4 desc limit 3
    loop
      i := i + 1;
      w := w || jsonb_build_object(
        'rank', i, 'name', rec.name, 'points', rec.points,
        'user_id', rec.user_id, 'address', rec.address,
        'zec', case when total > 0 then round(c.prize_zec * shares_top3[i] / total, 8) else 0 end,
        'status', 'pending', 'txid', null
      );
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
      select r.user_id, coalesce(nullif(p.name, ''), 'Player') as name, coalesce(p.address, '') as address, sum(r.points) as points
      from public.rewards r
      join public.contest_entries ce on ce.contest_id = c.id and ce.user_id = r.user_id
      left join public.profiles p on p.id = r.user_id
      where r.verified and r.points > 0 and r.round = any (c.fixture_ids)
      group by r.user_id, p.name, p.address order by 4 desc limit 10
    loop
      i := i + 1;
      w := w || jsonb_build_object(
        'rank', i, 'name', rec.name, 'points', rec.points,
        'user_id', rec.user_id, 'address', rec.address,
        'zec', case when total > 0 then round(c.prize_zec * shares_top10[i] / total, 8) else 0 end,
        'status', 'pending', 'txid', null
      );
      if c.prize_zec > 0 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (rec.user_id, 'prize_' || c.id || '_' || i, 'Prize · ' || c.title || ' · #' || i, 0,
                round(c.prize_zec * shares_top10[i] / total, 8), now(), true, 'contest:' || c.id)
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

-- Mark an individual contest winner as paid with txid
create or replace function public.admin_mark_contest_winner_paid(p_contest_id text, p_rank int, p_txid text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.contests;
  w jsonb := '[]'::jsonb;
  item jsonb;
  winner_uid uuid;
begin
  if auth.uid() is not null then
    perform public.require_admin();
  end if;

  select * into c from public.contests where id = p_contest_id for update;
  if not found then raise exception 'unknown contest'; end if;

  for item in select * from jsonb_array_elements(c.winners) loop
    if (item->>'rank')::int = p_rank then
      item := jsonb_set(item, '{status}', '"paid"'::jsonb);
      item := jsonb_set(item, '{txid}', to_jsonb(coalesce(nullif(trim(p_txid), ''), 'paid_manually')));
      if item->>'user_id' is not null then
        winner_uid := (item->>'user_id')::uuid;
      end if;
    end if;
    w := w || item;
  end loop;

  update public.contests set winners = w where id = p_contest_id;

  -- Also mark corresponding requested withdrawal if any
  if winner_uid is not null then
    update public.withdrawals set status = 'paid', txid = coalesce(nullif(trim(p_txid), ''), txid)
    where user_id = winner_uid and status = 'requested';
  end if;
end $$;

revoke all on function public.admin_close_contest(text) from public, anon;
grant execute on function public.admin_close_contest(text) to authenticated, service_role;

revoke all on function public.admin_mark_contest_winner_paid(text, int, text) from public, anon;
grant execute on function public.admin_mark_contest_winner_paid(text, int, text) to authenticated, service_role;
