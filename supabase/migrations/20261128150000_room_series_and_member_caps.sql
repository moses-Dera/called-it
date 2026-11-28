-- Configurable multi-round series for Rock Paper Scissors (default 3, auto-advancing, most wins wins)
-- and configurable room member limits clamped to each game's permitted range.

create or replace function public.room_max_players(p_game text, p_options jsonb) returns int
language plpgsql immutable as $$
declare
  hard_cap int := case p_game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end;
  hard_min int := case p_game when 'werewolf' then 5 when 'capsule' then 1 when 'closest' then 3 else 2 end;
  req int := nullif(p_options ->> 'max_players', '')::int;
begin
  if req is null then return hard_cap; end if;
  return least(greatest(req, hard_min), hard_cap);
end $$;

create or replace function public.create_room(p_game text, p_title text, p_options jsonb, p_invite uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
  opts jsonb := coalesce(p_options, '{}'::jsonb);
  hard_cap int;
  hard_min int;
  max_p int;
  cap int;
begin
  if uid is null then raise exception 'sign in to play with friends'; end if;
  if p_game not in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog', 'werewolf') then raise exception 'unknown game'; end if;

  hard_cap := case p_game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end;
  hard_min := case p_game when 'werewolf' then 5 when 'capsule' then 1 when 'closest' then 3 else 2 end;
  max_p := coalesce(nullif(opts ->> 'max_players', '')::int, hard_cap);
  if max_p < hard_min or max_p > hard_cap then
    raise exception 'room size for this game must be between % and %', hard_min, hard_cap;
  end if;
  opts := opts || jsonb_build_object('max_players', max_p);

  cap := max_p - 1;
  if coalesce(array_length(p_invite, 1), 0) > cap then raise exception 'too many invites for this room (max %)', cap; end if;
  if p_game = 'vote' and jsonb_array_length(coalesce(opts -> 'choices', '[]'::jsonb)) < 2 then raise exception 'add at least two choices'; end if;
  if p_game in ('vote', 'closest') and coalesce(trim(p_title), '') = '' then raise exception 'write the question'; end if;
  if p_game = 'capsule' and (opts ->> 'opens') is null then raise exception 'pick the opening date'; end if;
  if (opts ->> 'timer') is not null and (opts ->> 'timer')::int not in (2, 5, 10, 30, 60) then raise exception 'timer must be 2, 5, 10, 30 or 60 minutes'; end if;

  if p_game = 'arcade' then
    opts := jsonb_build_object('rounds', coalesce((opts ->> 'rounds')::int, 3)) || (opts - 'rounds');
    if (opts ->> 'rounds')::int < 3 or (opts ->> 'rounds')::int > 15 then raise exception 'Rock Paper Scissors plays 3 to 15 rounds'; end if;
  elsif p_game = 'bluff' then
    opts := jsonb_build_object('rounds', coalesce((opts ->> 'rounds')::int, 5)) || (opts - 'rounds');
    if (opts ->> 'rounds')::int not in (3, 5, 7) then raise exception 'Bluff Vault plays 3, 5 or 7 rounds'; end if;
  elsif p_game = 'fog' then
    opts := jsonb_build_object('turns', coalesce((opts ->> 'turns')::int, 6)) || (opts - 'turns');
    if (opts ->> 'turns')::int not in (4, 6, 8) then raise exception 'Fog of War plays 4, 6 or 8 turns'; end if;
  end if;

  insert into public.rooms (game, host, title, options) values (p_game, uid, coalesce(trim(p_title), ''), opts) returning * into r;
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
  select * into r from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = auth.uid() and state = 'joined') then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
  if r.contest_id is not null and not exists (select 1 from public.contest_entries where contest_id = r.contest_id and user_id = auth.uid()) then
    raise exception 'this game is part of a contest: join the contest first';
  end if;
  select count(*) into n from public.room_players where room_id = r.id and state = 'joined';
  if n >= public.room_max_players(r.game, r.options) then raise exception 'this game is full'; end if;
  insert into public.room_players (room_id, user_id, state) values (r.id, auth.uid(), 'joined')
  on conflict (room_id, user_id) do update set state = 'joined', joined_at = now();
  perform public.touch_room(r.id);
  return r.id;
end $$;

create or replace function public.answer_invite(p_room uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or not exists (select 1 from public.room_players where room_id = p_room and user_id = auth.uid() and state = 'invited') then
    raise exception 'no invite to answer';
  end if;
  if p_accept then
    if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
    if r.contest_id is not null and not exists (select 1 from public.contest_entries where contest_id = r.contest_id and user_id = auth.uid()) then
      raise exception 'this game is part of a contest: join the contest first';
    end if;
    select count(*) into n from public.room_players where room_id = p_room and state = 'joined';
    if n >= public.room_max_players(r.game, r.options) then
      raise exception 'this game is full';
    end if;
    update public.room_players set state = 'joined', joined_at = now() where room_id = p_room and user_id = auth.uid();
  else
    delete from public.room_players where room_id = p_room and user_id = auth.uid();
  end if;
  perform public.touch_room(p_room);
end $$;

create or replace function public.start_room(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.rooms; n int; wolves int; deal text; salt text; max_p int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start'; end if;
  if r.status <> 'lobby' then raise exception 'already started'; end if;
  select count(*) into n from public.room_participants(p_room);
  max_p := public.room_max_players(r.game, r.options);
  if r.game in ('arcade', 'fog') and n <> 2 then raise exception 'this game needs exactly two players'; end if;
  if r.game in ('vote', 'closest', 'bluff') and n < 2 then raise exception 'wait for at least two players'; end if;
  if r.game = 'capsule' and n < 1 then raise exception 'nobody to seal'; end if;
  if r.game = 'werewolf' and (n < 5 or n > max_p) then raise exception 'Werewolf needs 5 to % players (you have %)', max_p, n; end if;
  delete from public.room_players where room_id = p_room and state = 'invited';

  if r.game = 'werewolf' then
    wolves := case when n >= 7 then 2 else 1 end;
    insert into public.room_roles (room_id, user_id, role)
      select p_room, u, case when k <= wolves then 'wolf' when k = wolves + 1 then 'seer' else 'villager' end
      from (select u, row_number() over (order by gen_random_uuid()) k from public.room_participants(p_room) u) d;
    select string_agg(user_id::text || ':' || role, ',' order by user_id::text) into deal from public.room_roles where room_id = p_room;
    salt := encode(gen_random_bytes(16), 'hex');
    insert into public.room_secrets (room_id, deal, salt) values (p_room, deal, salt);
    update public.rooms set status = 'sealing', round = 1, updated_at = now(), result = jsonb_build_object(
      'phase', 'night', 'day', 1, 'wolves', wolves, 'log', '[]'::jsonb,
      'alive', (select jsonb_agg(u::text) from public.room_participants(p_room) u),
      'deal_hash', encode(digest(convert_to('calledit:ww|' || deal || '|' || salt, 'UTF8'), 'sha256'), 'hex'))
    where id = p_room;
    return;
  end if;

  update public.rooms set status = 'sealing', round = case when r.game = 'fog' then 0 else 1 end,
    result = case r.game when 'arcade' then jsonb_build_object('scores', '{}'::jsonb, 'history', '[]'::jsonb)
                         when 'bluff' then jsonb_build_object('scores', '{}'::jsonb, 'history', '[]'::jsonb)
                         when 'fog' then jsonb_build_object('turns', '[]'::jsonb) else null end,
    updated_at = now() where id = p_room;
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
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (winner, 'room_' || r.id || '_' || r.round, 'Rock Paper Scissors match win · room ' || r.code, 18, 0, now(), true, 'room:' || r.id || ':' || r.round)
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

create or replace function public.next_round(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start another round'; end if;
  if r.status <> 'done' or r.game not in ('arcade', 'vote') then raise exception 'no next round for this game'; end if;
  update public.rooms set round = round + 1, status = 'sealing',
    result = case when r.game = 'arcade' then jsonb_build_object('scores', '{}'::jsonb, 'history', '[]'::jsonb) else null end,
    reveal_by = null, updated_at = now() where id = p_room;
end $$;
