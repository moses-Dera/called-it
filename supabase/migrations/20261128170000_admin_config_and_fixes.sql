-- Admin point-to-ZEC configuration, per-network wallet_backups, custom fixture deletion,
-- and fixture kickoff notification deduplication.

-- 1. Separate encrypted wallet backups per (user_id, network) so testnet & mainnet never overwrite each other.
alter table public.wallet_backups drop constraint if exists wallet_backups_pkey;
alter table public.wallet_backups add primary key (user_id, network);

create or replace function public.save_wallet_backup(
  p_network text, p_ciphertext text, p_iv text, p_salt text, p_kdf text default 'argon2id'
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.wallet_backups (user_id, network, ciphertext, iv, salt, kdf, updated_at)
  values (auth.uid(), p_network, p_ciphertext, p_iv, p_salt, p_kdf, now())
  on conflict (user_id, network) do update set
    ciphertext = excluded.ciphertext, iv = excluded.iv,
    salt = excluded.salt, kdf = excluded.kdf, updated_at = now();
  return true;
end $$;

drop function if exists public.get_wallet_backup();
create or replace function public.get_wallet_backup(p_network text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'network', wb.network, 'ciphertext', wb.ciphertext, 'iv', wb.iv,
    'salt', wb.salt, 'kdf', wb.kdf, 'backup_verified', wb.backup_verified
  ) from public.wallet_backups wb
  where wb.user_id = auth.uid() and wb.network = coalesce(nullif(p_network, ''), public.app_network())
$$;
revoke all on function public.get_wallet_backup(text) from public, anon;
grant execute on function public.get_wallet_backup(text) to authenticated;

drop function if exists public.verify_wallet_backup();
create or replace function public.verify_wallet_backup(p_network text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update public.wallet_backups set backup_verified = true, updated_at = now()
  where user_id = auth.uid() and network = coalesce(nullif(p_network, ''), public.app_network());
  return found;
end $$;
revoke all on function public.verify_wallet_backup(text) from public, anon;
grant execute on function public.verify_wallet_backup(text) to authenticated;

-- 2. Admin-configurable point->ZEC settings
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key in ('fund_address', 'network', 'point_zec', 'general_game_zec'));

create or replace function public.admin_set_setting(p_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_value, '')); num numeric;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_key = 'network' then
    if v not in ('mainnet', 'testnet') then raise exception 'network must be mainnet or testnet'; end if;
    if v <> public.app_network() then delete from public.app_settings where key = 'fund_address'; end if;
  elsif p_key = 'fund_address' then
    if v = '' then delete from public.app_settings where key = p_key; return true; end if;
    if not public.is_shielded_for(v, public.app_network()) then
      raise exception 'that is not a % shielded Zcash address', public.app_network();
    end if;
  elsif p_key = 'point_zec' then
    begin num := v::numeric; exception when others then raise exception 'enter a numeric ZEC amount per point'; end;
    if num < 0 or num > 0.01 then raise exception 'ZEC per point must be between 0 and 0.01'; end if;
    v := num::text;
  elsif p_key = 'general_game_zec' then
    if v not in ('true', 'false') then raise exception 'general_game_zec must be true or false'; end if;
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;

create or replace function public.point_value_zec(p_kind text default 'classic') returns numeric
language sql stable security definer set search_path = public as $$
  with s as (
    select
      coalesce((select nullif(value, '')::numeric from public.app_settings where key = 'point_zec'), 0.00001) as pv,
      coalesce((select value from public.app_settings where key = 'general_game_zec'), 'false') = 'true' as games_on
  )
  select case when p_kind = 'classic' or games_on then pv else 0 end from s
$$;
grant execute on function public.point_value_zec(text) to anon, authenticated, service_role;

-- Update Classic Call claim to use configured point_value_zec('classic').
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

-- Update room_settle, fog_finish, werewolf_settle, force_settle, set_room_answer to honor point_value_zec('game').
create or replace function public.fog_finish(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; a uuid; b uuid; liar uuid[] := '{}'; place_a int[]; place_b int[];
        ta int[]; tb int[]; ca int[]; cb int[]; ha int := 0; hb int := 0; winner uuid; i int; nturns int; zec_amt numeric;
begin
  select * into r from public.rooms where id = p_room;
  select min(user_id::text)::uuid, max(user_id::text)::uuid into a, b from public.room_participants(p_room) user_id;
  select public.cells(move) into place_a from public.room_seals where room_id = p_room and round = 0 and user_id = a;
  select public.cells(move) into place_b from public.room_seals where room_id = p_room and round = 0 and user_id = b;
  if place_a is null then liar := liar || a; end if;
  if place_b is null then liar := liar || b; end if;
  select coalesce(max(round), 0) into nturns from public.room_seals where room_id = p_room and round > 0;
  for i in 1..nturns loop
    select public.cells(move), claim into ta, ca from public.room_seals where room_id = p_room and round = i and user_id = a;
    select public.cells(move), claim into tb, cb from public.room_seals where room_id = p_room and round = i and user_id = b;
    if place_a is not null and coalesce((select array_agg(x order by x) from unnest(coalesce(tb, '{}')) x where x = any(place_a)), '{}') <> coalesce((select array_agg(x order by x) from unnest(coalesce(ca, '{}')) x), '{}') then liar := liar || a; end if;
    if place_b is not null and coalesce((select array_agg(x order by x) from unnest(coalesce(ta, '{}')) x where x = any(place_b)), '{}') <> coalesce((select array_agg(x order by x) from unnest(coalesce(cb, '{}')) x), '{}') then liar := liar || b; end if;
    hb := hb + coalesce((select count(*) from unnest(coalesce(tb, '{}')) x where x = any(coalesce(place_a, '{}'))), 0);
    ha := ha + coalesce((select count(*) from unnest(coalesce(ta, '{}')) x where x = any(coalesce(place_b, '{}'))), 0);
  end loop;
  liar := array(select distinct unnest(liar));
  if array_length(liar, 1) = 1 then winner := case when liar[1] = a then b else a end;
  elsif coalesce(array_length(liar, 1), 0) = 0 and ha <> hb then winner := case when ha > hb then a else b end;
  end if;
  if winner is not null then
    zec_amt := round(40 * public.point_value_zec('game'), 8);
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (winner, 'room_' || r.id || '_fog', 'Fog of War win · room ' || r.code, 40, zec_amt, now(), true, 'room:' || r.id || ':fog')
    on conflict do nothing;
  end if;
  update public.rooms set status = 'done', updated_at = now(), result = coalesce(r.result, '{}'::jsonb) || jsonb_build_object(
    'final', true, 'winner', winner, 'winner_name', case when winner is null then null else public.room_name(winner) end,
    'hits', jsonb_build_object(a::text, ha, b::text, hb),
    'placements', jsonb_build_object(a::text, to_jsonb(place_a), b::text, to_jsonb(place_b)),
    'liars', to_jsonb(array(select public.room_name(x) from unnest(liar) x)))
  where id = p_room;
end $$;

create or replace function public.werewolf_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; res jsonb; alive jsonb; victim uuid; seer uuid; seer_pick uuid; wolves_left int; others_left int; team text; entry jsonb; zec_amt numeric;
begin
  select * into r from public.rooms where id = p_room for update;
  res := r.result; alive := res -> 'alive';
  if res ->> 'phase' = 'night' then
    select s.move::uuid into victim from public.room_seals s join public.room_roles x on x.room_id = s.room_id and x.user_id = s.user_id
      where s.room_id = p_room and s.round = r.round and x.role = 'wolf' and s.move is not null and s.move <> 'sleep'
      group by s.move order by count(*) desc, s.move limit 1;
    select s.user_id, s.move::uuid into seer, seer_pick from public.room_seals s join public.room_roles x on x.room_id = s.room_id and x.user_id = s.user_id
      where s.room_id = p_room and s.round = r.round and x.role = 'seer' and s.move is not null and s.move <> 'sleep';
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
      where room_id = p_room and round = r.round and move is not null and move <> 'skip' group by move) t
      where rk = 1 and (select count(*) from (select move, count(*) c from public.room_seals where room_id = p_room and round = r.round and move is not null and move <> 'skip' group by move) q where q.c = t.c) = 1;
    entry := jsonb_build_object('day', res -> 'day', 'phase', 'day', 'out', case when victim is null then null else public.room_name(victim) end,
      'role', (select role from public.room_roles where room_id = p_room and user_id = victim),
      'votes', (select coalesce(jsonb_object_agg(public.room_name(move::uuid), c), '{}'::jsonb) from (
        select move, count(*) c from public.room_seals where room_id = p_room and round = r.round and move is not null and move <> 'skip' group by move) v));
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
    update public.rooms set status = 'done', updated_at = now(), result = res || jsonb_build_object('final', true, 'team', team,
      'roles', (select jsonb_agg(jsonb_build_object('name', public.room_name(user_id), 'role', role) order by role, user_id) from public.room_roles where room_id = p_room),
      'deal', (select deal from public.room_secrets where room_id = p_room), 'salt', (select salt from public.room_secrets where room_id = p_room))
    where id = p_room;
  else
    update public.rooms set round = r.round + 1, status = 'sealing', reveal_by = null, result = res, updated_at = now() where id = p_room;
  end if;
end $$;

create or replace function public.set_room_answer(p_room uuid, p_answer numeric) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; best numeric; winners jsonb; zec_amt numeric;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can enter the answer'; end if;
  if r.status <> 'answer' then raise exception 'not waiting for an answer'; end if;
  select min(abs(move::numeric - p_answer)) into best from public.room_seals where room_id = p_room and round = r.round and move is not null;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', public.room_name(user_id), 'move', move)), '[]'::jsonb) into winners
    from public.room_seals where room_id = p_room and round = r.round and move is not null and abs(move::numeric - p_answer) = best;
  zec_amt := round(40 * public.point_value_zec('game'), 8);
  insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    select user_id, 'room_' || r.id || '_' || r.round, 'Closest Wins · room ' || r.code, 40, zec_amt, now(), true, 'room:' || r.id || ':' || r.round
    from public.room_seals where room_id = p_room and round = r.round and move is not null and abs(move::numeric - p_answer) = best
    on conflict do nothing;
  update public.rooms set status = 'done', answer = p_answer,
    result = coalesce(r.result, '{}'::jsonb) || jsonb_build_object('answer', p_answer, 'winners', winners), updated_at = now()
  where id = p_room;
end $$;

create or replace function public.room_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  moves jsonb;
  a record;
  b record;
  winner uuid;
  tally jsonb;
  top jsonb;
  w uuid[];
  scores jsonb;
  best numeric;
  targets jsonb;
  target_rounds int;
  hist jsonb;
  best_wins int;
  leaders uuid[];
  zec_amt numeric;
begin
  select * into r from public.rooms where id = p_room for update;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', public.room_name(user_id), 'move', move) order by revealed_at), '[]'::jsonb)
    into moves from public.room_seals where room_id = p_room and round = r.round and move is not null;

  if r.game = 'arcade' then
    select user_id, move into a from public.room_seals where room_id = p_room and round = r.round and move is not null order by user_id limit 1;
    select user_id, move into b from public.room_seals where room_id = p_room and round = r.round and move is not null and user_id <> a.user_id limit 1;
    if a.user_id is not null and b.user_id is null then
      winner := a.user_id;
    elsif a.user_id is not null and a.move <> b.move then
      winner := case when (a.move, b.move) in (('Rock', 'Scissors'), ('Paper', 'Rock'), ('Scissors', 'Paper')) then a.user_id else b.user_id end;
    end if;

    scores := coalesce(r.result -> 'scores', '{}'::jsonb);
    if winner is not null then
      scores := jsonb_set(scores, array[winner::text], to_jsonb(coalesce((scores ->> winner::text)::int, 0) + 1));
    end if;
    hist := coalesce(r.result -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'round', jsonb_array_length(coalesce(r.result -> 'history', '[]'::jsonb)) + 1,
      'cards', moves,
      'winner', winner,
      'winner_name', case when winner is null then null else public.room_name(winner) end
    ));
    target_rounds := coalesce((r.options ->> 'rounds')::int, 3);

    if jsonb_array_length(hist) < target_rounds then
      update public.rooms set round = r.round + 1, status = 'sealing', reveal_by = null,
        result = jsonb_build_object('scores', scores, 'history', hist),
        updated_at = now() where id = p_room;
    else
      select max(value::int) into best_wins from jsonb_each_text(scores);
      select array_agg(key::uuid) into leaders from jsonb_each_text(scores) where value::int = best_wins;
      if coalesce(best_wins, 0) > 0 and coalesce(array_length(leaders, 1), 0) = 1 then
        winner := leaders[1];
        zec_amt := round(18 * public.point_value_zec('game'), 8);
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (winner, 'room_' || r.id || '_' || r.round, 'Rock Paper Scissors match win · room ' || r.code, 18, zec_amt, now(), true, 'room:' || r.id || ':' || r.round)
        on conflict do nothing;
      else
        winner := null;
      end if;
      update public.rooms set status = 'done',
        result = jsonb_build_object('final', true, 'moves', moves, 'scores', scores, 'history', hist,
          'winner', winner, 'winner_name', case when winner is null then null else public.room_name(winner) end),
        updated_at = now() where id = p_room;
    end if;

  elsif r.game = 'vote' then
    select coalesce(jsonb_object_agg(move, n), '{}'::jsonb) into tally from (
      select move, count(*) as n from public.room_seals where room_id = p_room and round = r.round and move is not null group by move) t;
    select coalesce(jsonb_agg(move), '[]'::jsonb) into top from (
      select move from public.room_seals where room_id = p_room and round = r.round and move is not null
      group by move having count(*) = (select max(c) from (select count(*) c from public.room_seals where room_id = p_room and round = r.round and move is not null group by move) m)) t;
    update public.rooms set status = 'done', result = jsonb_build_object('tally', tally, 'top', top, 'votes', jsonb_array_length(moves)), updated_at = now() where id = p_room;

  elsif r.game = 'closest' then
    update public.rooms set status = 'answer', result = jsonb_build_object('guesses', moves), updated_at = now() where id = p_room;

  elsif r.game = 'capsule' then
    update public.rooms set status = 'done', result = jsonb_build_object('messages', moves), updated_at = now() where id = p_room;

  elsif r.game = 'bluff' then
    w := public.bluff_winners(p_room, r.round);
    scores := coalesce(r.result -> 'scores', '{}'::jsonb);
    if coalesce(array_length(w, 1), 0) > 0 then
      select scores || coalesce(jsonb_object_agg(x::text, coalesce((scores ->> x::text)::numeric, 0) + round(10.0 / array_length(w, 1), 2)), '{}'::jsonb)
        into scores from unnest(w) x;
    end if;
    r.result := jsonb_set(jsonb_set(coalesce(r.result, '{}'::jsonb), '{scores}', scores), '{history}',
      coalesce(r.result -> 'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', r.round, 'cards', moves,
        'winners', to_jsonb(array(select public.room_name(x) from unnest(w) x)))));
    if r.round < coalesce((r.options ->> 'rounds')::int, 5) then
      update public.rooms set round = r.round + 1, status = 'sealing', reveal_by = null, result = r.result, updated_at = now() where id = p_room;
    else
      select max(value::numeric) into best from jsonb_each_text(scores);
      w := array(select key::uuid from jsonb_each_text(scores) where value::numeric = best);
      zec_amt := round(30 * public.point_value_zec('game'), 8);
      insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        select x, 'room_' || r.id || '_bluff', 'Bluff Vault win · room ' || r.code, 30, zec_amt, now(), true, 'room:' || r.id || ':bluff'
        from unnest(w) x on conflict do nothing;
      update public.rooms set status = 'done', updated_at = now(),
        result = r.result || jsonb_build_object('final', true, 'champions', to_jsonb(array(select public.room_name(x) from unnest(w) x)))
      where id = p_room;
    end if;

  elsif r.game = 'fog' then
    if r.round = 0 then
      perform public.fog_finish(p_room);
    else
      select coalesce(jsonb_object_agg(user_id::text, to_jsonb(public.cells(move))), '{}'::jsonb) into targets
        from public.room_seals where room_id = p_room and round = r.round;
      update public.rooms set status = 'report', reveal_by = now() + interval '10 minutes', updated_at = now(),
        result = jsonb_set(coalesce(r.result, '{}'::jsonb), '{turns}', coalesce(r.result -> 'turns', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('round', r.round, 'targets', targets)))
      where id = p_room;
    end if;
  end if;
end $$;

-- 3. Allow Admin to remove stale custom/demo fixtures (keeps real fd-* and contest-linked matches safe).
create or replace function public.admin_delete_fixture(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_id like 'fd-%' then raise exception 'cannot delete live football-data fixtures'; end if;
  if exists (select 1 from public.contests where p_id = any(fixture_ids)) then
    raise exception 'fixture is used in a contest';
  end if;
  delete from public.fixtures where id = p_id;
  return found;
end $$;
revoke all on function public.admin_delete_fixture(text) from public, anon;
grant execute on function public.admin_delete_fixture(text) to authenticated;

-- 4. Track kickoff push reminders so automated cron never double-notifies.
alter table public.fixtures add column if not exists notified_at timestamptz;
