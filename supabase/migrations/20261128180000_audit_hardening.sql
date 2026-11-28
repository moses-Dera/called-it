-- Security, anti-abuse, and scalability hardening from full audit:
-- 1. Fix infinite ZEC balance duplication between send_tip, request_withdrawal, and payout_claim_winner + add advisory lock to send_tip.
-- 2. Enforce require_admin() on both admin_list_all_players overloads.
-- 3. Enable RLS on Telegram tables (tg_rounds, tg_predictions) and lock down tg_score_round.
-- 4. Lock down internal room/contest/payout/reset SECURITY DEFINER functions & syndicates RLS.
-- 5. Enforce earliest pre-kickoff seal in claim_classic (anti-hedging) & proportional ZEC clamping in rewards_room_cap.
-- 6. Guard werewolf_settle against non-UUID ('skip'/'sleep') moves & protect wallet_backups / list_players privacy.
-- 7. Add missing idx_room_players_user index & cap my_open_rooms().

-- 1a. send_tip: lock sender balance before checking available & debiting
create or replace function public.send_tip(p_to uuid, p_amount numeric, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  earned numeric;
  taken numeric;
  tipped_out numeric;
  available numeric;
  t public.tips;
  to_name text;
begin
  if uid is null then raise exception 'sign in to send a tip'; end if;
  if p_to is null or p_to = uid then raise exception 'cannot tip yourself'; end if;
  if p_amount is null or p_amount < 0.0001 then raise exception 'minimum tip is 0.0001 ZEC'; end if;
  if p_amount > 10 then raise exception 'maximum tip is 10 ZEC'; end if;

  if not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'player not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
  available := earned - taken - tipped_out;

  if p_amount > available then
    return jsonb_build_object('status', 'insufficient', 'available', available);
  end if;

  if (select count(*) from public.tips where from_user = uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many tips — wait a bit';
  end if;

  insert into public.tips (from_user, to_user, amount, message)
  values (uid, p_to, p_amount, nullif(trim(coalesce(p_message, '')), ''))
  returning * into t;

  insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
  values (p_to, 'tip_' || t.id, 'Tip from a fellow player', 0, p_amount, now(), true, 'tip:' || uid)
  on conflict do nothing;

  select coalesce(nullif(name, ''), 'Player') into to_name from public.profiles where id = p_to;
  return jsonb_build_object('status', 'sent', 'amount', p_amount, 'to', to_name, 'tip_id', t.id);
end $$;

-- 1b. request_withdrawal: subtract sent tips from available balance
create or replace function public.request_withdrawal(p_address text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  addr text := trim(coalesce(p_address, ''));
  earned numeric;
  taken numeric;
  tipped_out numeric;
  available numeric;
  w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  if not public.is_shielded_for(addr, public.app_network()) then
    raise exception 'use a % shielded Zcash address', public.app_network();
  end if;

  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
  available := earned - taken - tipped_out;

  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', greatest(available, 0));
  end if;

  insert into public.withdrawals (user_id, address, amount)
  values (uid, addr, available)
  returning * into w;

  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'id', w.id);
end $$;

-- 1c. payout_claim_winner: also subtract sent tips before paying contest prize directly
create or replace function public.payout_claim_winner(p_contest_id text, p_rank int)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests; item jsonb; uid uuid; earned numeric; taken numeric; tipped_out numeric;
begin
  perform public.payout_guard();
  select * into c from public.contests where id = p_contest_id;
  select x into item from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where (x->>'rank')::int = p_rank;
  if item is null then raise exception 'no winner at rank %', p_rank; end if;
  uid := (item->>'user_id')::uuid;
  if uid is not null then
    perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));
    if exists (select 1 from public.withdrawals where user_id = uid and status in ('requested', 'sending')) then
      raise exception 'winner #% has a withdrawal request waiting; pay that instead', p_rank;
    end if;
    select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
    select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
    select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
    if earned - taken - tipped_out < coalesce((item->>'zec')::numeric, 0) - 0.00000001 then
      raise exception 'winner #% has already withdrawn or tipped this prize', p_rank;
    end if;
  end if;
  return public.set_winner_status(p_contest_id, p_rank, array['pending'], 'sending') is not null;
end $$;

-- 2. Require admin on both admin_list_all_players overloads
create or replace function public.admin_list_all_players(p_search text default null)
returns table (id uuid, name text, address text, avatar int, ranked_points bigint, earned_zec numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
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
end $$;
revoke all on function public.admin_list_all_players(text) from public, anon;
grant execute on function public.admin_list_all_players(text) to authenticated;

create or replace function public.admin_list_all_players(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, address text, avatar int, ranked_points bigint, earned_zec numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
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
    order by ranked_points desc, p.name asc
    limit least(p_limit, 200)
    offset greatest(p_offset, 0);
end $$;
revoke all on function public.admin_list_all_players(text, int, int) from public, anon;
grant execute on function public.admin_list_all_players(text, int, int) to authenticated;

-- 3. Lock down Telegram group rounds & predictions (bot calls via service_role)
alter table public.tg_rounds enable row level security;
alter table public.tg_predictions enable row level security;
revoke all on function public.tg_score_round(uuid) from public, anon, authenticated;
grant execute on function public.tg_score_round(uuid) to service_role;

-- 4. Lock down internal helper functions & syndicate invite_code
-- Use DO blocks so REVOKE is idempotent (fails silently if privilege was never granted)
do $$ begin
  revoke all on function public.room_name(uuid) from public, anon, authenticated;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.room_participants(uuid) from public, anon, authenticated;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.contest_rooms(text) from public, anon;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.is_room_member(uuid) from public, anon, authenticated;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.admin_overview() from public, anon;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.my_tips(int, int) from public, anon;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.my_syndicates() from public, anon;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.sponsor_dashboard() from public, anon;
exception when undefined_function or insufficient_privilege then null; end $$;
do $$ begin
  revoke all on function public.leaderboard_weekly_reset() from public, anon, authenticated;
exception when undefined_function or insufficient_privilege then null; end $$;
grant execute on function public.leaderboard_weekly_reset() to service_role;
do $$ begin
  revoke all on function public.prize_overdue(public.contests, jsonb) from public, anon, authenticated;
exception when undefined_function or insufficient_privilege then null; end $$;

drop policy if exists "syndicates are public" on public.syndicates;

-- 5a. claim_classic: prevent multi-seal score hedging (only earliest pre-kickoff seal counts)
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
  zec_amt numeric;
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
  if exists (
    select 1 from public.seals s2
    where s2.user_id = uid and s2.round = s.round and s2.game = 'classic'
      and s2.received_at < f.kickoff
      and (s2.received_at < s.received_at or (s2.received_at = s.received_at and s2.id < s.id))
  ) then
    return jsonb_build_object('status', 'superseded', 'message', 'Only your first seal before kickoff counts for ranked points.');
  end if;
  if f.home_goals is null then
    return jsonb_build_object('status', 'pending', 'message', 'Waiting for the official full-time result.');
  end if;

  h := split_part(split_part(p_move, '|', 1), '-', 1)::int;
  a := split_part(split_part(p_move, '|', 1), '-', 2)::int;
  is_banker := '2X' = any(string_to_array(p_move, '|'));
  wk := date_trunc('week', f.kickoff at time zone 'UTC');
  perform pg_advisory_xact_lock(hashtext('claim:' || uid::text || ':' || wk::text));

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

  zec_amt := round(total * public.point_value_zec('classic'), 8);

  perform set_config('calledit.claiming', 'on', true);
  update public.seals set revealed = true where user_id = uid and id = s.id;
  if total > 0 then
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round, banker, banker_week)
    values (uid, 'v_' || s.id, f.home || ' ' || f.home_goals || ' – ' || f.away_goals || ' ' || f.away || ' · Classic Call (verified)' || case when apply_banker then ' ⚡ 2x' else '' end,
            total, zec_amt, now(), true, s.round, apply_banker, case when apply_banker then wk else null end)
    on conflict do nothing;
  end if;
  return jsonb_build_object('status', 'scored', 'points', total, 'zec', zec_amt, 'exact', exact, 'result', result_ok, 'banker', apply_banker,
                            'final', f.home_goals || '-' || f.away_goals, 'id', 'v_' || s.id);
end $$;

-- 5b. Scale room ZEC proportionally when daily room points cap clamps new.points
create or replace function public.rewards_room_cap() returns trigger language plpgsql as $$
declare today int; orig int;
begin
  if new.id not like 'room_%' or not new.verified then return new; end if;
  select coalesce(sum(points), 0) into today from public.rewards
    where user_id = new.user_id and id like 'room_%' and verified and at >= date_trunc('day', now());
  if today >= 100 then return null; end if;
  orig := new.points;
  new.points := least(new.points, 100 - today);
  if orig > 0 and new.points < orig and new.zec > 0 then
    new.zec := round(new.zec * (new.points::numeric / orig), 8);
  end if;
  return new;
end $$;

-- 6a. werewolf_settle: guard ::uuid casts against invalid/skip strings
create or replace function public.werewolf_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; res jsonb; alive jsonb; victim uuid; seer uuid; seer_pick uuid; wolves_left int; others_left int; team text; entry jsonb; zec_amt numeric;
        uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  select * into r from public.rooms where id = p_room for update;
  res := r.result; alive := res -> 'alive';
  if res ->> 'phase' = 'night' then
    select s.move::uuid into victim from public.room_seals s join public.room_roles x on x.room_id = s.room_id and x.user_id = s.user_id
      where s.room_id = p_room and s.round = r.round and x.role = 'wolf' and s.move ~ uuid_re
      group by s.move order by count(*) desc, s.move limit 1;
    select s.user_id, s.move::uuid into seer, seer_pick from public.room_seals s join public.room_roles x on x.room_id = s.room_id and x.user_id = s.user_id
      where s.room_id = p_room and s.round = r.round and x.role = 'seer' and s.move ~ uuid_re;
    if seer is not null and seer_pick is not null then
      update public.room_roles set seen = seen || jsonb_build_array(jsonb_build_object('name', public.room_name(seer_pick),
        'wolf', (select role = 'wolf' from public.room_roles where room_id = p_room and user_id = seer_pick), 'night', res -> 'day'))
      where room_id = p_room and user_id = seer;
    end if;
    entry := jsonb_build_object('day', res -> 'day', 'phase', 'night', 'out', case when victim is null then null else public.room_name(victim) end,
      'role', (select role from public.room_roles where room_id = p_room and user_id = victim));
    if victim is not null then alive := alive - victim::text; end if;
    res := res || jsonb_build_object('phase', 'day', 'alive', alive, 'log', (res -> 'log') || jsonb_build_array(entry));
  else
    select move::uuid into victim from (
      select move, count(*) c, rank() over (order by count(*) desc) rk from public.room_seals
      where room_id = p_room and round = r.round and move ~ uuid_re group by move) t
      where rk = 1 and (select count(*) from (select move, count(*) c from public.room_seals where room_id = p_room and round = r.round and move ~ uuid_re group by move) q where q.c = t.c) = 1;
    entry := jsonb_build_object('day', res -> 'day', 'phase', 'day', 'out', case when victim is null then null else public.room_name(victim) end,
      'role', (select role from public.room_roles where room_id = p_room and user_id = victim),
      'votes', (select coalesce(jsonb_object_agg(public.room_name(move::uuid), c), '{}'::jsonb) from (
        select move, count(*) c from public.room_seals where room_id = p_room and round = r.round and move ~ uuid_re group by move) v));
    if victim is not null then alive := alive - victim::text; end if;
    res := res || jsonb_build_object('phase', 'night', 'day', (res ->> 'day')::int + 1, 'alive', alive, 'log', (res -> 'log') || jsonb_build_array(entry));
  end if;

  select count(*) filter (where role = 'wolf'), count(*) filter (where role <> 'wolf') into wolves_left, others_left
    from public.room_roles where room_id = p_room and user_id::text in (select jsonb_array_elements_text(alive));
  if wolves_left = 0 then team := 'village'; elsif wolves_left >= others_left then team := 'wolves'; end if;

  if team is not null then
    zec_amt := round(30 * public.point_value_zec('game'), 8);
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
      select user_id, 'room_' || r.id || '_ww', 'Werewolf win (' || team || ') · room ' || r.code, 30, zec_amt, now(), true, 'room:' || r.id || ':ww'
      from public.room_roles where room_id = p_room and (role = 'wolf') = (team = 'wolves')
      on conflict do nothing;
    res := res || jsonb_build_object('winner_team', team,
      'roles', (select jsonb_agg(jsonb_build_object('name', public.room_name(user_id), 'role', role) order by role, user_id) from public.room_roles where room_id = p_room));
    update public.rooms set status = 'done', result = res, updated_at = now() where id = p_room;
  else
    update public.rooms set status = 'sealing', round = r.round + 1, step_started_at = now(), result = res, updated_at = now() where id = p_room;
  end if;
end $$;

-- 6b. Restrict direct client updates/deletes on wallet_backups; validate inputs in save_wallet_backup
drop policy if exists "own_backup_update" on public.wallet_backups;
drop policy if exists "own_backup_delete" on public.wallet_backups;
drop policy if exists "own_backup_insert" on public.wallet_backups;

create or replace function public.save_wallet_backup(
  p_network text, p_ciphertext text, p_iv text, p_salt text, p_kdf text default 'argon2id'
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_network not in ('mainnet', 'testnet') then raise exception 'invalid network'; end if;
  if length(coalesce(p_ciphertext, '')) not between 16 and 8192 then raise exception 'invalid ciphertext'; end if;
  if length(coalesce(p_iv, '')) not between 8 and 128 then raise exception 'invalid iv'; end if;
  if length(coalesce(p_salt, '')) not between 8 and 128 then raise exception 'invalid salt'; end if;
  insert into public.wallet_backups (user_id, network, ciphertext, iv, salt, kdf, updated_at)
  values (auth.uid(), p_network, p_ciphertext, p_iv, p_salt, coalesce(nullif(p_kdf, ''), 'argon2id'), now())
  on conflict (user_id, network) do update set
    ciphertext = excluded.ciphertext, iv = excluded.iv,
    salt = excluded.salt, kdf = excluded.kdf, updated_at = now();
  return true;
end $$;

-- 6c. Respect searchable privacy in list_players
create or replace function public.list_players(p_search text default null)
returns table (id uuid, name text, avatar int)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.name, ''), 'Player'), p.avatar from public.profiles p
  where p.id <> auth.uid() and coalesce(p.searchable, true) = true
    and (coalesce(p_search, '') = '' or p.name ilike '%' || p_search || '%')
  order by p.name nulls last limit 40
$$;

-- 7. Scale: room_players(user_id, state) index & cap my_open_rooms()
create index if not exists idx_room_players_user on public.room_players (user_id, state);

create or replace function public.my_open_rooms() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.rooms r join public.room_players rp on rp.room_id = r.id and rp.user_id = auth.uid() and rp.state = 'joined'
  where r.status in ('sealing', 'revealing', 'report') and r.updated_at > now() - interval '7 days'
  order by r.updated_at desc limit 40
$$;
