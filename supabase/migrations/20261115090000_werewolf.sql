-- Called It: real-player Werewolf (Phase 3). Applied with `npx supabase db push --remote`.
--
-- 5-8 players. At the start the server deals roles (1 seer, 1 wolf, or 2 wolves from 7 players, the rest
-- villagers) and publishes a seal of the whole deal: sha256("calledit:ww|" || deal || "|" || salt).
-- Each player can only read their own role (wolves also see each other; the seer sees what they found).
-- Night: every living player seals an action (villagers seal "sleep", so activity reveals nothing);
-- wolves pick a victim, the seer inspects someone. Day: everyone alive seals a vote. Roles of the dead
-- are announced. The village wins when no wolves are left; wolves win when they equal the rest.
-- At the end the deal and its salt are published so every device can check the seal.

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog', 'werewolf'));

create table if not exists public.room_roles (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('wolf', 'seer', 'villager')),
  seen jsonb not null default '[]'::jsonb,
  primary key (room_id, user_id)
);
create table if not exists public.room_secrets (
  room_id uuid primary key references public.rooms on delete cascade,
  deal text not null,
  salt text not null
);
alter table public.room_roles enable row level security;   -- no policies: only through functions
alter table public.room_secrets enable row level security;

-- Who acts this round. Werewolf: every living player (day and night alike).
create or replace function public.room_participants(p_room uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select rp.user_id from public.room_players rp join public.rooms r on r.id = rp.room_id
  where rp.room_id = p_room and rp.state = 'joined'
    and not (r.game = 'closest' and rp.user_id = r.host)
    and (r.game <> 'werewolf' or r.status = 'lobby' or rp.user_id::text in (select jsonb_array_elements_text(coalesce(r.result -> 'alive', '[]'::jsonb))))
$$;

create or replace function public.create_room(p_game text, p_title text, p_options jsonb, p_invite uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; cap int;
begin
  if uid is null then raise exception 'sign in to play with friends'; end if;
  if p_game not in ('arcade', 'vote', 'closest', 'capsule', 'bluff', 'fog', 'werewolf') then raise exception 'unknown game'; end if;
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

create or replace function public.start_room(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.rooms; n int; wolves int; deal text; salt text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start'; end if;
  if r.status <> 'lobby' then raise exception 'already started'; end if;
  select count(*) into n from public.room_participants(p_room);
  if r.game in ('arcade', 'fog') and n <> 2 then raise exception 'this game needs exactly two players'; end if;
  if r.game in ('vote', 'closest', 'bluff') and n < 2 then raise exception 'wait for at least two players'; end if;
  if r.game = 'capsule' and n < 1 then raise exception 'nobody to seal'; end if;
  if r.game = 'werewolf' and (n < 5 or n > 8) then raise exception 'Werewolf needs 5 to 8 players (you have %)', n; end if;
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
    result = case r.game when 'bluff' then jsonb_build_object('scores', '{}'::jsonb, 'history', '[]'::jsonb)
                         when 'fog' then jsonb_build_object('turns', '[]'::jsonb) else null end,
    updated_at = now() where id = p_room;
end $$;

-- Your role (and, for wolves, the pack; for the seer, what you have found).
create or replace function public.my_role(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', me.role, 'seen', me.seen,
    'pack', case when me.role = 'wolf' then (select jsonb_agg(public.room_name(user_id)) from public.room_roles where room_id = p_room and role = 'wolf' and user_id <> auth.uid()) end)
  from public.room_roles me where me.room_id = p_room and me.user_id = auth.uid()
$$;
revoke all on function public.my_role(uuid) from public, anon;
grant execute on function public.my_role(uuid) to authenticated;

-- Resolve a werewolf night or day, then check for a winner.
create or replace function public.werewolf_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; res jsonb; alive jsonb; victim uuid; seer uuid; seer_pick uuid; wolves_left int; others_left int; team text; entry jsonb;
begin
  select * into r from public.rooms where id = p_room for update;
  res := r.result; alive := res -> 'alive';
  if res ->> 'phase' = 'night' then
    -- Most-chosen wolf target dies (ties: the first by id). No wolf reveal: nobody dies.
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
    -- Day vote: a single top choice is voted out; a tie (or only skips) means nobody.
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
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
      select user_id, 'room_' || r.id || '_ww', 'Werewolf win (' || team || ') · room ' || r.code, 30, 0, now(), true, 'room:' || r.id || ':ww'
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
revoke all on function public.werewolf_settle(uuid) from public, anon, authenticated;

create or replace function public.reveal_move(p_room uuid, p_player text, p_move text, p_salt text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.rooms; s public.room_seals; pending int; num numeric; c int[]; my_role text; target_role text;
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
  if r.game = 'werewolf' then
    select role into my_role from public.room_roles where room_id = p_room and user_id = auth.uid();
    if p_move not in ('sleep', 'skip') then
      if not (r.result -> 'alive') ? p_move then raise exception 'pick a living player'; end if;
      select role into target_role from public.room_roles where room_id = p_room and user_id = p_move::uuid;
    end if;
    if r.result ->> 'phase' = 'night' then
      if my_role = 'villager' and p_move <> 'sleep' then raise exception 'villagers sleep at night'; end if;
      if my_role = 'wolf' and (p_move = 'sleep' or target_role = 'wolf') then raise exception 'wolves pick a villager to attack'; end if;
      if my_role = 'seer' and (p_move = auth.uid()::text) then raise exception 'inspect someone else'; end if;
    elsif p_move = 'sleep' then raise exception 'vote for a player, or skip';
    end if;
  end if;
  update public.room_seals set move = p_move, revealed_at = now() where room_id = p_room and round = r.round and user_id = auth.uid();
  select count(*) into pending from public.room_seals where room_id = p_room and round = r.round and move is null;
  if pending > 0 then perform public.touch_room(p_room);
  elsif r.game = 'werewolf' then perform public.werewolf_settle(p_room);
  else perform public.room_settle(p_room);
  end if;
end $$;

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
  elsif r.game = 'werewolf' then
    perform public.werewolf_settle(p_room);
  else
    perform public.room_settle(p_room);
  end if;
end $$;
