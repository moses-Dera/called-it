-- Called It: real-player Bluff Vault and Fog of War (Phase 2). Applied with `npx supabase db push --remote`.
--
-- Bluff Vault (2-6 players, 5 rounds): no dealer to trust. Everyone holds the same seven cards
-- (2, 4, 6, 8, 10, Steal, Shield) and seals one per round; each card can be used once. Shield beats
-- Steal, Steal beats every number, otherwise the highest number wins (a lone Shield counts as 0).
-- Round winners split 10 chips; most chips after 5 rounds wins.
--
-- Fog of War (2 players, 6 turns, 6x6 grid): each player seals where their 5 units stand (round 0).
-- Each turn both seal up to 3 targets; once revealed, each device reports the hits it took. At the end
-- both placements open and the server re-checks every report; a player caught lying loses.

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog'));
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check check (status in ('lobby', 'sealing', 'revealing', 'report', 'answer', 'done'));
alter table public.room_seals add column if not exists claim int[];

create or replace function public.cells(p text) returns int[]
language sql immutable as $$
  select coalesce(array_agg(x::int order by x::int), '{}') from unnest(string_to_array(nullif(p, ''), ',')) x
$$;

create or replace function public.create_room(p_game text, p_title text, p_options jsonb, p_invite uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; cap int;
begin
  if uid is null then raise exception 'sign in to play with friends'; end if;
  if p_game not in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog') then raise exception 'unknown game'; end if;
  cap := case p_game when 'arcade' then 1 when 'fog' then 1 when 'bluff' then 5 else 7 end;
  if coalesce(array_length(p_invite, 1), 0) > cap then raise exception 'too many invites for this game (max %)', cap; end if;
  if p_game = 'vote' and jsonb_array_length(coalesce(p_options -> 'choices', '[]'::jsonb)) < 2 then raise exception 'add at least two choices'; end if;
  if p_game in ('vote', 'closest') and coalesce(trim(p_title), '') = '' then raise exception 'write the question'; end if;
  if p_game = 'capsule' and (p_options ->> 'opens') is null then raise exception 'pick the opening date'; end if;
  insert into public.rooms (game, host, title, options) values (p_game, uid, coalesce(trim(p_title), ''),
    coalesce(p_options, '{}'::jsonb) || case p_game when 'bluff' then '{"rounds": 5}'::jsonb when 'fog' then '{"turns": 6}'::jsonb else '{}'::jsonb end)
  returning * into r;
  insert into public.room_players (room_id, user_id, state) values (r.id, uid, 'joined');
  insert into public.room_players (room_id, user_id, state)
    select r.id, i, 'invited' from unnest(coalesce(p_invite, '{}')) i where i <> uid and i in (select id from public.profiles)
    on conflict do nothing;
  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;

create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  if auth.uid() is null then raise exception 'sign in to join'; end if;
  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'no room with that code'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = auth.uid() and state = 'joined') then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
  select count(*) into n from public.room_players where room_id = r.id and state = 'joined';
  if n >= (case r.game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end) then raise exception 'this game is full'; end if;
  insert into public.room_players (room_id, user_id, state) values (r.id, auth.uid(), 'joined')
  on conflict (room_id, user_id) do update set state = 'joined', joined_at = now();
  perform public.touch_room(r.id);
  return r.id;
end $$;

create or replace function public.start_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start'; end if;
  if r.status <> 'lobby' then raise exception 'already started'; end if;
  select count(*) into n from public.room_participants(p_room);
  if r.game in ('arcade', 'fog') and n <> 2 then raise exception 'this game needs exactly two players'; end if;
  if r.game in ('vote', 'closest', 'bluff') and n < 2 then raise exception 'wait for at least two players'; end if;
  if r.game = 'capsule' and n < 1 then raise exception 'nobody to seal'; end if;
  delete from public.room_players where room_id = p_room and state = 'invited';
  update public.rooms set status = 'sealing', round = case when r.game = 'fog' then 0 else 1 end,
    result = case r.game when 'bluff' then jsonb_build_object('scores', '{}'::jsonb, 'history', '[]'::jsonb)
                         when 'fog' then jsonb_build_object('turns', '[]'::jsonb) else null end,
    updated_at = now() where id = p_room;
end $$;

create or replace function public.seal_move(p_room uuid, p_commitment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; total int; sealed int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'sealing' then raise exception 'not sealing right now'; end if;
  if auth.uid() not in (select public.room_participants(p_room)) then raise exception 'you are not playing in this room'; end if;
  insert into public.room_seals (room_id, round, user_id, commitment) values (p_room, r.round, auth.uid(), p_commitment);
  select count(*) into total from public.room_participants(p_room);
  select count(*) into sealed from public.room_seals where room_id = p_room and round = r.round;
  if sealed < total then perform public.touch_room(p_room); return; end if;
  if r.game = 'fog' and r.round = 0 then
    -- Placements stay sealed until the end of the game; go straight to turn 1.
    update public.rooms set round = 1, status = 'sealing', updated_at = now() where id = p_room;
  else
    update public.rooms set status = 'revealing',
      reveal_by = case when r.game = 'capsule' then (r.options ->> 'opens')::timestamptz + interval '7 days' else now() + interval '10 minutes' end,
      updated_at = now() where id = p_room;
  end if;
end $$;

-- Bluff Vault: who wins a round of cards.
create or replace function public.bluff_winners(p_room uuid, p_round int) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare has_steal boolean; has_shield boolean; best int;
begin
  select bool_or(move = 'Steal'), bool_or(move = 'Shield') into has_steal, has_shield
    from public.room_seals where room_id = p_room and round = p_round and move is not null;
  if has_steal and has_shield then
    return array(select user_id from public.room_seals where room_id = p_room and round = p_round and move = 'Shield');
  elsif has_steal then
    return array(select user_id from public.room_seals where room_id = p_room and round = p_round and move = 'Steal');
  end if;
  select max(case when move = 'Shield' then 0 else move::int end) into best
    from public.room_seals where room_id = p_room and round = p_round and move is not null;
  return array(select user_id from public.room_seals where room_id = p_room and round = p_round and move is not null
               and (case when move = 'Shield' then 0 else move::int end) = best);
end $$;

-- Fog of War: verify every report against the opened placements and decide the game.
create or replace function public.fog_finish(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; a uuid; b uuid; liar uuid[] := '{}'; place_a int[]; place_b int[];
        ta int[]; tb int[]; ca int[]; cb int[]; ha int := 0; hb int := 0; winner uuid; i int; nturns int;
begin
  select * into r from public.rooms where id = p_room;
  select min(user_id::text)::uuid, max(user_id::text)::uuid into a, b from public.room_participants(p_room) user_id;
  select public.cells(move) into place_a from public.room_seals where room_id = p_room and round = 0 and user_id = a;
  select public.cells(move) into place_b from public.room_seals where room_id = p_room and round = 0 and user_id = b;
  if place_a is null then liar := liar || a; end if;            -- never opened the placement: forfeits
  if place_b is null then liar := liar || b; end if;
  select coalesce(max(round), 0) into nturns from public.room_seals where room_id = p_room and round > 0;
  for i in 1..nturns loop
    select public.cells(move), claim into ta, ca from public.room_seals where room_id = p_room and round = i and user_id = a;
    select public.cells(move), claim into tb, cb from public.room_seals where room_id = p_room and round = i and user_id = b;
    -- a's claim = hits a took = b's targets on a's units, and the other way round.
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
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (winner, 'room_' || r.id || '_fog', 'Fog of War win · room ' || r.code, 40, 0, now(), true, 'room:' || r.id || ':fog')
    on conflict do nothing;
  end if;
  update public.rooms set status = 'done', updated_at = now(), result = coalesce(r.result, '{}'::jsonb) || jsonb_build_object(
    'final', true, 'winner', winner, 'winner_name', case when winner is null then null else public.room_name(winner) end,
    'hits', jsonb_build_object(a::text, ha, b::text, hb),
    'placements', jsonb_build_object(a::text, to_jsonb(place_a), b::text, to_jsonb(place_b)),
    'liars', to_jsonb(array(select public.room_name(x) from unnest(liar) x)))
  where id = p_room;
end $$;

-- Settle a round from the revealed moves. Anyone who did not reveal forfeits that round.
create or replace function public.room_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; moves jsonb; a record; b record; winner uuid; tally jsonb; top jsonb; w uuid[]; scores jsonb; best numeric; targets jsonb;
begin
  select * into r from public.rooms where id = p_room for update;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', public.room_name(user_id), 'move', move) order by revealed_at), '[]'::jsonb)
    into moves from public.room_seals where room_id = p_room and round = r.round and move is not null;

  if r.game = 'arcade' then
    select user_id, move into a from public.room_seals where room_id = p_room and round = r.round and move is not null order by user_id limit 1;
    select user_id, move into b from public.room_seals where room_id = p_room and round = r.round and move is not null and user_id <> a.user_id limit 1;
    if a.user_id is not null and b.user_id is null then winner := a.user_id;
    elsif a.user_id is not null and a.move <> b.move then
      winner := case when (a.move, b.move) in (('Rock', 'Scissors'), ('Paper', 'Rock'), ('Scissors', 'Paper')) then a.user_id else b.user_id end;
    end if;
    if winner is not null then
      insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
      values (winner, 'room_' || r.id || '_' || r.round, 'Rock Paper Scissors win · room ' || r.code, 18, 0, now(), true, 'room:' || r.id || ':' || r.round)
      on conflict do nothing;
    end if;
    update public.rooms set status = 'done', result = jsonb_build_object('moves', moves, 'winner', winner, 'winner_name', case when winner is null then null else public.room_name(winner) end), updated_at = now() where id = p_room;

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
      insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        select x, 'room_' || r.id || '_bluff', 'Bluff Vault win · room ' || r.code, 30, 0, now(), true, 'room:' || r.id || ':bluff'
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
revoke all on function public.room_settle(uuid) from public, anon, authenticated;
revoke all on function public.fog_finish(uuid) from public, anon, authenticated;
revoke all on function public.bluff_winners(uuid, int) from public, anon, authenticated;

create or replace function public.reveal_move(p_room uuid, p_player text, p_move text, p_salt text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.rooms; s public.room_seals; pending int; num numeric; c int[];
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'revealing' then raise exception 'not revealing right now'; end if;
  if r.game = 'capsule' and now() < (r.options ->> 'opens')::timestamptz then raise exception 'this capsule opens on %', r.options ->> 'opens'; end if;
  select * into s from public.room_seals where room_id = p_room and round = r.round and user_id = auth.uid();
  if not found then raise exception 'you did not seal this round'; end if;
  if s.move is not null then return; end if;
  if encode(digest(convert_to('calledit:v1|' || p_player || '|room:' || r.id || ':' || r.round || '|' || p_move || '|' || p_salt, 'UTF8'), 'sha256'), 'hex') <> s.commitment then
    raise exception 'the revealed move does not match your seal';
  end if;
  if r.game = 'arcade' and p_move not in ('Rock', 'Paper', 'Scissors') then raise exception 'invalid move'; end if;
  if r.game = 'vote' and not (r.options -> 'choices') ? p_move then raise exception 'invalid choice'; end if;
  if r.game = 'closest' then begin num := p_move::numeric; exception when others then raise exception 'invalid guess'; end; end if;
  if r.game = 'capsule' and char_length(p_move) > 600 then raise exception 'message too long'; end if;
  if r.game = 'bluff' then
    if p_move not in ('2', '4', '6', '8', '10', 'Steal', 'Shield') then raise exception 'invalid card'; end if;
    if exists (select 1 from public.room_seals where room_id = p_room and user_id = auth.uid() and round < r.round and move = p_move) then raise exception 'you already played that card'; end if;
  end if;
  if r.game = 'fog' then
    begin c := public.cells(p_move); exception when others then raise exception 'invalid cells'; end;
    if exists (select 1 from unnest(c) x where x < 0 or x > 35) or cardinality(c) <> cardinality(array(select distinct unnest(c))) then raise exception 'invalid cells'; end if;
    if r.round = 0 and cardinality(c) <> 5 then raise exception 'place exactly five units'; end if;
    if r.round > 0 and (cardinality(c) < 1 or cardinality(c) > 3) then raise exception 'pick one to three targets'; end if;
  end if;
  update public.room_seals set move = p_move, revealed_at = now() where room_id = p_room and round = r.round and user_id = auth.uid();
  select count(*) into pending from public.room_seals where room_id = p_room and round = r.round and move is null;
  if pending = 0 then perform public.room_settle(p_room); else perform public.touch_room(p_room); end if;
end $$;

-- Fog of War: report the hits your units took this turn (checked against your placement at the end).
create or replace function public.report_hits(p_room uuid, p_hits int[]) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; opp_targets int[]; missing int; total_a int; total_b int; a uuid; b uuid;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'fog' or r.status <> 'report' then raise exception 'not reporting right now'; end if;
  if auth.uid() not in (select public.room_participants(p_room)) then raise exception 'you are not playing in this room'; end if;
  select public.cells(move) into opp_targets from public.room_seals where room_id = p_room and round = r.round and user_id <> auth.uid();
  if exists (select 1 from unnest(coalesce(p_hits, '{}')) x where not x = any(coalesce(opp_targets, '{}'))) then raise exception 'you can only report cells your opponent targeted'; end if;
  update public.room_seals set claim = coalesce(array(select distinct x from unnest(p_hits) x order by x), '{}')
    where room_id = p_room and round = r.round and user_id = auth.uid();
  select count(*) into missing from public.room_seals where room_id = p_room and round = r.round and claim is null;
  if missing > 0 then perform public.touch_room(p_room); return; end if;
  -- Both reported: record the turn, and stop early if someone has lost all five units.
  select min(user_id::text)::uuid, max(user_id::text)::uuid into a, b from public.room_participants(p_room) user_id;
  select coalesce(sum(cardinality(claim)), 0) into total_a from public.room_seals where room_id = p_room and round > 0 and user_id = a;
  select coalesce(sum(cardinality(claim)), 0) into total_b from public.room_seals where room_id = p_room and round > 0 and user_id = b;
  r.result := jsonb_set(r.result, array['turns', (jsonb_array_length(r.result -> 'turns') - 1)::text, 'hits'],
    (select jsonb_object_agg(user_id::text, to_jsonb(claim)) from public.room_seals where room_id = p_room and round = r.round));
  if r.round >= coalesce((r.options ->> 'turns')::int, 6) or total_a >= 5 or total_b >= 5 then
    update public.rooms set round = 0, status = 'revealing', reveal_by = now() + interval '10 minutes', result = r.result, updated_at = now() where id = p_room;
  else
    update public.rooms set round = r.round + 1, status = 'sealing', reveal_by = null, result = r.result, updated_at = now() where id = p_room;
  end if;
end $$;

-- Host closes a stalled step after its deadline: whoever didn't act forfeits.
create or replace function public.force_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; lazy uuid; other uuid;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.host <> auth.uid() then raise exception 'only the host can do that'; end if;
  if r.status not in ('revealing', 'report') then raise exception 'nothing to settle'; end if;
  if now() < r.reveal_by then raise exception 'players can still act until %', r.reveal_by; end if;
  if r.status = 'report' then
    select user_id into lazy from public.room_seals where room_id = p_room and round = r.round and claim is null limit 1;
    select p into other from public.room_participants(p_room) p where p <> lazy limit 1;
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (other, 'room_' || r.id || '_fog', 'Fog of War win (forfeit) · room ' || r.code, 40, 0, now(), true, 'room:' || r.id || ':fog')
    on conflict do nothing;
    update public.rooms set status = 'done', updated_at = now(), result = r.result || jsonb_build_object('final', true, 'winner', other,
      'winner_name', public.room_name(other), 'liars', jsonb_build_array(public.room_name(lazy) || ' (did not report)')) where id = p_room;
  else
    perform public.room_settle(p_room);
  end if;
end $$;

-- room_state also tells each player whether they have reported this turn.
create or replace function public.room_state(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.rooms;
begin
  if not public.is_room_member(p_room) then raise exception 'not in this room'; end if;
  select * into r from public.rooms where id = p_room;
  return jsonb_build_object(
    'id', r.id, 'code', r.code, 'game', r.game, 'title', r.title, 'options', r.options, 'status', r.status,
    'round', r.round, 'answer', r.answer, 'result', r.result, 'reveal_by', r.reveal_by, 'updated_at', r.updated_at,
    'host', r.host, 'host_name', public.room_name(r.host), 'me', auth.uid(), 'is_host', r.host = auth.uid(),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'name', public.room_name(p.user_id), 'avatar', coalesce(pr.avatar, 1), 'state', p.state,
        'plays', p.user_id in (select public.room_participants(p_room)),
        'sealed', s.user_id is not null, 'revealed', s.move is not null, 'reported', s.claim is not null,
        'move', case when p.user_id = auth.uid() or r.status in ('answer', 'done', 'report') then s.move end
      ) order by p.joined_at), '[]'::jsonb)
      from public.room_players p
      left join public.profiles pr on pr.id = p.user_id
      left join public.room_seals s on s.room_id = p.room_id and s.round = r.round and s.user_id = p.user_id
      where p.room_id = p_room)
  );
end $$;

revoke all on function public.report_hits(uuid, int[]) from public, anon;
grant execute on function public.report_hits(uuid, int[]) to authenticated;
