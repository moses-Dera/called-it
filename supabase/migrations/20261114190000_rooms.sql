-- Called It: real multiplayer rooms (Phase 1: Arcade, Secret Vote, Closest Wins, Time Capsule).
-- Applied with `npx supabase db push --remote`.
--
-- Flow: create a room and invite players (or share its code) -> host starts -> everyone seals a move
-- (only the hash reaches the server) -> once all have sealed, each device reveals its move and salt ->
-- the server re-hashes every move against its seal and settles the round.
-- Moves are never readable before the round is settled: players read rooms through room_state(), which
-- hides them; the room_seals table has no read policy at all. Live updates come from the `rooms` row
-- (bumped on every change), which holds no secrets.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  game text not null check (game in ('arcade', 'vote', 'closest', 'capsule')),
  host uuid not null references auth.users on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  options jsonb not null default '{}'::jsonb,
  status text not null default 'lobby' check (status in ('lobby', 'sealing', 'revealing', 'answer', 'done')),
  round int not null default 1,
  answer numeric,
  result jsonb,
  reveal_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.room_players (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table if not exists public.room_seals (
  room_id uuid not null references public.rooms on delete cascade,
  round int not null,
  user_id uuid not null references auth.users on delete cascade,
  commitment text not null check (commitment ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz not null default now(),
  move text,
  revealed_at timestamptz,
  primary key (room_id, round, user_id)
);
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_seals enable row level security; -- no policies: only through functions

create or replace function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.room_players where room_id = p_room and user_id = auth.uid())
$$;
grant execute on function public.is_room_member(uuid) to authenticated;

drop policy if exists "members read rooms" on public.rooms;
create policy "members read rooms" on public.rooms for select to authenticated using (public.is_room_member(id));

do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------- helpers ----------
create or replace function public.room_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select name from public.profiles where id = p_user), ''), 'Player')
$$;

-- Who plays this room's rounds: everyone joined, except the host in Closest Wins (the referee).
create or replace function public.room_participants(p_room uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select rp.user_id from public.room_players rp join public.rooms r on r.id = rp.room_id
  where rp.room_id = p_room and rp.state = 'joined' and not (r.game = 'closest' and rp.user_id = r.host)
$$;

create or replace function public.touch_room(p_room uuid) returns void
language sql security definer set search_path = public as $$
  update public.rooms set updated_at = now() where id = p_room
$$;

-- ---------- players directory ----------
create or replace function public.list_players(p_search text default null)
returns table (id uuid, name text, avatar int)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.name, ''), 'Player'), p.avatar from public.profiles p
  where p.id <> auth.uid() and (coalesce(p_search, '') = '' or p.name ilike '%' || p_search || '%')
  order by p.name nulls last limit 40
$$;
revoke all on function public.list_players(text) from public, anon;
grant execute on function public.list_players(text) to authenticated;

-- ---------- create, invite, join ----------
create or replace function public.create_room(p_game text, p_title text, p_options jsonb, p_invite uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rooms; cap int;
begin
  if uid is null then raise exception 'sign in to play with friends'; end if;
  if p_game not in ('arcade', 'vote', 'closest', 'capsule') then raise exception 'unknown game'; end if;
  cap := case when p_game = 'arcade' then 1 else 7 end;
  if coalesce(array_length(p_invite, 1), 0) > cap then raise exception 'too many invites for this game (max %)', cap; end if;
  if p_game = 'vote' and jsonb_array_length(coalesce(p_options -> 'choices', '[]'::jsonb)) < 2 then raise exception 'add at least two choices'; end if;
  if p_game in ('vote', 'closest') and coalesce(trim(p_title), '') = '' then raise exception 'write the question'; end if;
  if p_game = 'capsule' and (p_options ->> 'opens') is null then raise exception 'pick the opening date'; end if;
  insert into public.rooms (game, host, title, options) values (p_game, uid, coalesce(trim(p_title), ''), coalesce(p_options, '{}'::jsonb)) returning * into r;
  insert into public.room_players (room_id, user_id, state) values (r.id, uid, 'joined');
  insert into public.room_players (room_id, user_id, state)
    select r.id, i, 'invited' from unnest(coalesce(p_invite, '{}')) i where i <> uid and i in (select id from public.profiles)
    on conflict do nothing;
  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;

create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if auth.uid() is null then raise exception 'sign in to join'; end if;
  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'no room with that code'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = auth.uid() and state = 'joined') then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
  if r.game = 'arcade' and (select count(*) from public.room_players where room_id = r.id and state = 'joined') >= 2 then raise exception 'this game is full'; end if;
  if (select count(*) from public.room_players where room_id = r.id and state = 'joined') >= 8 then raise exception 'this room is full'; end if;
  insert into public.room_players (room_id, user_id, state) values (r.id, auth.uid(), 'joined')
  on conflict (room_id, user_id) do update set state = 'joined', joined_at = now();
  perform public.touch_room(r.id);
  return r.id;
end $$;

create or replace function public.answer_invite(p_room uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found or not exists (select 1 from public.room_players where room_id = p_room and user_id = auth.uid() and state = 'invited') then
    raise exception 'no invite to answer';
  end if;
  if p_accept then
    if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
    update public.room_players set state = 'joined', joined_at = now() where room_id = p_room and user_id = auth.uid();
  else
    delete from public.room_players where room_id = p_room and user_id = auth.uid();
  end if;
  perform public.touch_room(p_room);
end $$;

create or replace function public.my_rooms() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]'::jsonb) from (
    select r.id, r.code, r.game, r.title, r.status, r.updated_at, rp.state as my_state, r.host = auth.uid() as is_host,
           public.room_name(r.host) as host_name,
           (select count(*) from public.room_players p where p.room_id = r.id and p.state = 'joined') as players
    from public.rooms r join public.room_players rp on rp.room_id = r.id and rp.user_id = auth.uid()
    order by r.updated_at desc limit 40) x
$$;

-- ---------- the round ----------
create or replace function public.start_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start'; end if;
  if r.status <> 'lobby' then raise exception 'already started'; end if;
  select count(*) into n from public.room_participants(p_room);
  if r.game = 'arcade' and n <> 2 then raise exception 'Rock Paper Scissors needs exactly two players'; end if;
  if r.game in ('vote', 'closest') and n < 2 then raise exception 'wait for at least two players'; end if;
  if r.game = 'capsule' and n < 1 then raise exception 'nobody to seal'; end if;
  delete from public.room_players where room_id = p_room and state = 'invited';
  update public.rooms set status = 'sealing', updated_at = now() where id = p_room;
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
  if sealed >= total then
    update public.rooms set status = 'revealing',
      reveal_by = case when r.game = 'capsule' then (r.options ->> 'opens')::timestamptz + interval '7 days' else now() + interval '10 minutes' end,
      updated_at = now() where id = p_room;
  else
    perform public.touch_room(p_room);
  end if;
end $$;

-- Settle a round from the revealed moves. Anyone who did not reveal forfeits.
create or replace function public.room_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; moves jsonb; a record; b record; winner uuid; tally jsonb; top jsonb;
begin
  select * into r from public.rooms where id = p_room for update;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', public.room_name(user_id), 'move', move) order by revealed_at), '[]'::jsonb)
    into moves from public.room_seals where room_id = p_room and round = r.round and move is not null;

  if r.game = 'arcade' then
    select user_id, move into a from public.room_seals where room_id = p_room and round = r.round and move is not null order by user_id limit 1;
    select user_id, move into b from public.room_seals where room_id = p_room and round = r.round and move is not null and user_id <> a.user_id limit 1;
    if a.user_id is not null and b.user_id is null then winner := a.user_id;          -- the other player forfeited
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

  else -- capsule
    update public.rooms set status = 'done', result = jsonb_build_object('messages', moves), updated_at = now() where id = p_room;
  end if;
end $$;
revoke all on function public.room_settle(uuid) from public, anon, authenticated;

create or replace function public.reveal_move(p_room uuid, p_player text, p_move text, p_salt text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r public.rooms; s public.room_seals; pending int; num numeric;
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
  if r.game = 'closest' then
    begin num := p_move::numeric; exception when others then raise exception 'invalid guess'; end;
  end if;
  if r.game = 'capsule' and char_length(p_move) > 600 then raise exception 'message too long'; end if;
  update public.room_seals set move = p_move, revealed_at = now() where room_id = p_room and round = r.round and user_id = auth.uid();
  select count(*) into pending from public.room_seals where room_id = p_room and round = r.round and move is null;
  if pending = 0 then perform public.room_settle(p_room); else perform public.touch_room(p_room); end if;
end $$;

-- Host closes a round after the reveal deadline: players who never revealed forfeit.
create or replace function public.force_settle(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.host <> auth.uid() then raise exception 'only the host can do that'; end if;
  if r.status <> 'revealing' then raise exception 'nothing to settle'; end if;
  if now() < r.reveal_by then raise exception 'players can still reveal until %', r.reveal_by; end if;
  perform public.room_settle(p_room);
end $$;

-- Closest Wins: the host (referee) enters the true answer once the guesses are open.
create or replace function public.set_room_answer(p_room uuid, p_answer numeric) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; best numeric; winners jsonb;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can enter the answer'; end if;
  if r.status <> 'answer' then raise exception 'not waiting for an answer'; end if;
  select min(abs(move::numeric - p_answer)) into best from public.room_seals where room_id = p_room and round = r.round and move is not null;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', public.room_name(user_id), 'move', move)), '[]'::jsonb) into winners
    from public.room_seals where room_id = p_room and round = r.round and move is not null and abs(move::numeric - p_answer) = best;
  insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    select user_id, 'room_' || r.id || '_' || r.round, 'Closest Wins · room ' || r.code, 40, 0, now(), true, 'room:' || r.id || ':' || r.round
    from public.room_seals where room_id = p_room and round = r.round and move is not null and abs(move::numeric - p_answer) = best
    on conflict do nothing;
  update public.rooms set status = 'done', answer = p_answer,
    result = coalesce(r.result, '{}'::jsonb) || jsonb_build_object('answer', p_answer, 'winners', winners), updated_at = now()
  where id = p_room;
end $$;

-- Rock Paper Scissors and Secret Vote can go again with the same players.
create or replace function public.next_round(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host <> auth.uid() then raise exception 'only the host can start another round'; end if;
  if r.status <> 'done' or r.game not in ('arcade', 'vote') then raise exception 'no next round for this game'; end if;
  update public.rooms set round = round + 1, status = 'sealing', result = null, reveal_by = null, updated_at = now() where id = p_room;
end $$;

-- Everything a member may see. Moves stay hidden until the round is settled (your own is always shown).
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
        'sealed', s.user_id is not null, 'revealed', s.move is not null,
        'move', case when p.user_id = auth.uid() or r.status in ('answer', 'done') then s.move end
      ) order by p.joined_at), '[]'::jsonb)
      from public.room_players p
      left join public.profiles pr on pr.id = p.user_id
      left join public.room_seals s on s.room_id = p.room_id and s.round = r.round and s.user_id = p.user_id
      where p.room_id = p_room)
  );
end $$;

do $$ declare f text; begin
  foreach f in array array['create_room(text, text, jsonb, uuid[])', 'join_room(text)', 'answer_invite(uuid, boolean)', 'my_rooms()',
    'start_room(uuid)', 'seal_move(uuid, text)', 'reveal_move(uuid, text, text, text)', 'force_settle(uuid)',
    'set_room_answer(uuid, numeric)', 'next_round(uuid)', 'room_state(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.room_name(uuid) from public, anon;
revoke all on function public.room_participants(uuid) from public, anon;
revoke all on function public.touch_room(uuid) from public, anon, authenticated;
