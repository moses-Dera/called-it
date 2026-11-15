-- Called It: step timers, automatic timeouts, adjustable length, and a daily cap on friend-game points.
-- Applied with `npx supabase db push --remote`.
--
-- Every step (sealing, revealing, reporting) gets a deadline: options.timer minutes (default 10; time
-- capsules wait for their opening date). After it, any player's app may settle the step; whoever did not
-- act loses that round. Hosts choose the timer, Bluff Vault rounds (3/5/7) and Fog of War turns (4/6/8).

-- ---------- Deadlines, set automatically whenever a room changes step ----------
create or replace function public.rooms_deadline() returns trigger language plpgsql as $$
declare mins int := least(greatest(coalesce((new.options ->> 'timer')::int, 10), 1), 1440);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.round is not distinct from old.round then return new; end if;
  new.reveal_by := case
    when new.game = 'capsule' and new.status = 'sealing' then (new.options ->> 'opens')::timestamptz
    when new.game = 'capsule' and new.status = 'revealing' then (new.options ->> 'opens')::timestamptz + interval '7 days'
    when new.status in ('sealing', 'revealing', 'report') then now() + make_interval(mins => mins)
    else null end;
  return new;
end $$;
drop trigger if exists rooms_deadline on public.rooms;
create trigger rooms_deadline before insert or update on public.rooms for each row execute function public.rooms_deadline();

-- ---------- Adjustable length and timer (host's choices win over defaults, within limits) ----------
create or replace function public.create_room(p_game text, p_title text, p_options jsonb, p_invite uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; cap int; opts jsonb := coalesce(p_options, '{}'::jsonb);
begin
  if uid is null then raise exception 'sign in to play with friends'; end if;
  if p_game not in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog', 'werewolf') then raise exception 'unknown game'; end if;
  cap := case p_game when 'arcade' then 1 when 'fog' then 1 when 'bluff' then 5 else 7 end;
  if coalesce(array_length(p_invite, 1), 0) > cap then raise exception 'too many invites for this game (max %)', cap; end if;
  if p_game = 'vote' and jsonb_array_length(coalesce(opts -> 'choices', '[]'::jsonb)) < 2 then raise exception 'add at least two choices'; end if;
  if p_game in ('vote', 'closest') and coalesce(trim(p_title), '') = '' then raise exception 'write the question'; end if;
  if p_game = 'capsule' and (opts ->> 'opens') is null then raise exception 'pick the opening date'; end if;
  if (opts ->> 'timer') is not null and (opts ->> 'timer')::int not in (2, 5, 10, 30, 60) then raise exception 'timer must be 2, 5, 10, 30 or 60 minutes'; end if;
  if p_game = 'bluff' then
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

-- ---------- Timeouts: any player may settle a step once its deadline has passed ----------
create or replace function public.force_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; lazy uuid; other uuid; placed int; pending int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or not public.is_room_member(p_room) then raise exception 'not in this room'; end if;
  if r.status not in ('sealing', 'revealing', 'report') then return; end if;
  if r.reveal_by is null or now() < r.reveal_by then raise exception 'players can still act until %', r.reveal_by; end if;

  if r.status = 'sealing' then
    if r.game = 'fog' and r.round = 0 then
      -- Someone never hid their units: the player who did wins (nobody did: no winner).
      select count(*) into placed from public.room_seals where room_id = p_room and round = 0;
      select user_id into other from public.room_seals where room_id = p_room and round = 0 limit 1;
      if placed = 1 then
        insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
        values (other, 'room_' || r.id || '_fog', 'Fog of War win (forfeit) · room ' || r.code, 40, 0, now(), true, 'room:' || r.id || ':fog')
        on conflict do nothing;
      end if;
      update public.rooms set status = 'done', updated_at = now(), result = coalesce(r.result, '{}'::jsonb) || jsonb_build_object('final', true,
        'winner', case when placed = 1 then other end, 'winner_name', case when placed = 1 then public.room_name(other) end,
        'liars', jsonb_build_array('a player who did not place their units in time')) where id = p_room;
      return;
    end if;
    -- Players who didn't seal sit this round out; the rest move on to revealing.
    update public.rooms set status = 'revealing', updated_at = now() where id = p_room;
    select count(*) into pending from public.room_seals where room_id = p_room and round = r.round and move is null;
    if pending = 0 then
      if r.game = 'werewolf' then perform public.werewolf_settle(p_room); else perform public.room_settle(p_room); end if;
    end if;
    return;
  end if;

  if r.status = 'report' then
    select user_id into lazy from public.room_seals where room_id = p_room and round = r.round and claim is null limit 1;
    select p into other from public.room_participants(p_room) p where p <> lazy limit 1;
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (other, 'room_' || r.id || '_fog', 'Fog of War win (forfeit) · room ' || r.code, 40, 0, now(), true, 'room:' || r.id || ':fog')
    on conflict do nothing;
    update public.rooms set status = 'done', updated_at = now(), result = r.result || jsonb_build_object('final', true, 'winner', other,
      'winner_name', public.room_name(other), 'liars', jsonb_build_array(public.room_name(lazy) || ' (did not report in time)')) where id = p_room;
  elsif r.game = 'werewolf' then
    perform public.werewolf_settle(p_room);
  else
    perform public.room_settle(p_room);
  end if;
end $$;

-- ---------- At most 100 ranked points a day from games with friends ----------
create or replace function public.rewards_room_cap() returns trigger language plpgsql as $$
declare today int;
begin
  if new.id not like 'room_%' or not new.verified then return new; end if;
  select coalesce(sum(points), 0) into today from public.rewards
    where user_id = new.user_id and id like 'room_%' and verified and at >= date_trunc('day', now());
  if today >= 100 then return null; end if;          -- daily cap reached: the win still shows, no points
  new.points := least(new.points, 100 - today);
  return new;
end $$;
drop trigger if exists rewards_room_cap on public.rewards;
create trigger rewards_room_cap before insert on public.rewards for each row execute function public.rewards_room_cap();

-- Rooms I'm in that need my device: open steps (for background reveal and report).
create or replace function public.my_open_rooms() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.rooms r join public.room_players rp on rp.room_id = r.id and rp.user_id = auth.uid() and rp.state = 'joined'
  where r.status in ('sealing', 'revealing', 'report') and r.updated_at > now() - interval '7 days'
$$;
revoke all on function public.my_open_rooms() from public, anon;
grant execute on function public.my_open_rooms() to authenticated;
