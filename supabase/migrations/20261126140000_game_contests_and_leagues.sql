-- Game contests, leagues, and one way to run contests.
--
-- 1. Leagues: every imported match records its league, so match lists can be grouped instead of dumped.
-- 2. Game contests: a contest is either football predictions (as before) or one multiplayer game played in
--    rooms opened from the contest. Wins between entrants count from the contest's start until ends_at.
--    Only games with a winner that nobody controls count: Rock Paper Scissors, Bluff Vault, Fog of War, Werewolf.
--    To stop two friends farming wins off each other, a player's 2 best games against the same opponents count.
-- 3. One ranking function (contest_scores) feeds the leaderboard and the close, for both kinds.

-- ---------- 1. Leagues ----------
alter table public.fixtures add column if not exists league text;
create index if not exists fixtures_league_kickoff on public.fixtures (league, kickoff);

-- ---------- 2. Game contests ----------
alter table public.contests add column if not exists game text not null default 'football';
alter table public.contests drop constraint if exists contests_game_check;
alter table public.contests add constraint contests_game_check check (game in ('football', 'arcade', 'bluff', 'fog', 'werewolf'));
alter table public.contests add column if not exists ends_at timestamptz;
alter table public.contests drop constraint if exists contests_game_shape;
alter table public.contests add constraint contests_game_shape check (game = 'football' or ends_at is not null);

alter table public.rooms add column if not exists contest_id text references public.contests (id) on delete set null;
create index if not exists rooms_contest on public.rooms (contest_id) where contest_id is not null;

-- ---------- 3. Scores ----------
create or replace function public.contest_scores(p_id text)
returns table (user_id uuid, points bigint)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.contests where id = p_id),
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
    group by r.user_id, rm.id
  ),
  capped as (
    select user_id, pts, row_number() over (partition by user_id, others order by pts desc) as n from per_room
  )
  select user_id, pts from football
  union all
  select user_id, sum(pts)::bigint from capped where n <= 2 group by user_id
$$;
revoke all on function public.contest_scores(text) from public, anon, authenticated;

-- An old one-argument version made calls with only p_id ambiguous.
drop function if exists public.contest_leaderboard(text);
drop function if exists public.contest_leaderboard(text, int, int);
create or replace function public.contest_leaderboard(p_id text, p_limit int default 50, p_offset int default 0)
returns table (rank bigint, name text, avatar int, points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by s.points desc), coalesce(nullif(p.name, ''), 'Player'), coalesce(p.avatar, 1), s.points, s.user_id = auth.uid()
  from public.contest_scores(p_id) s left join public.profiles p on p.id = s.user_id
  where s.points > 0
  order by s.points desc
  limit least(p_limit, 100) offset greatest(p_offset, 0)
$$;
grant execute on function public.contest_leaderboard(text, int, int) to anon, authenticated;

-- ---------- Closing ----------
create or replace function public.contests_close_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    if new.game <> 'football' then
      if now() < new.ends_at then raise exception 'this contest runs until %; it closes then', new.ends_at; end if;
    elsif exists (select 1 from unnest(new.fixture_ids) fid left join public.fixtures f on f.id = fid
                  where f.id is null or f.home_goals is null) then
      raise exception 'this contest still has matches without a final result; it closes after the last one';
    end if;
  end if;
  return new;
end $$;

create or replace function public.admin_close_contest(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contests; w jsonb := '[]'::jsonb; shares numeric[]; rec record;
  n int; total numeric := 0; i int := 0; each_share numeric; cnt int;
begin
  if auth.uid() is not null then perform public.require_admin(); end if;
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then return c.winners; end if;

  shares := case c.prize_structure
    when 'top3' then array[0.50, 0.30, 0.20]
    when 'top5' then array[0.40, 0.25, 0.15, 0.10, 0.10]
    when 'top10' then array[0.25, 0.15, 0.12, 0.10, 0.08, 0.07, 0.06, 0.06, 0.06, 0.05]
    when 'top20' then array[0.20, 0.12, 0.10, 0.08, 0.06, 0.05, 0.05, 0.05, 0.04, 0.04, 0.03, 0.03, 0.03, 0.03, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01]
    when 'custom' then c.custom_shares
    when 'equal_split' then array_fill(1.0::numeric, array[coalesce(c.custom_shares[1]::int, 5)])
  end;

  if c.prize_structure = 'all_correct' then
    -- Everyone with at least one exact score (football only) shares the prize equally.
    select count(*) into cnt from public.contest_scores(c.id) s
      where exists (select 1 from public.rewards r where r.user_id = s.user_id and r.verified and r.points >= 50 and r.round = any (c.fixture_ids));
    each_share := case when cnt > 0 then round(c.prize_zec / cnt, 8) else 0 end;
    for rec in select s.user_id, s.points from public.contest_scores(c.id) s
      where exists (select 1 from public.rewards r where r.user_id = s.user_id and r.verified and r.points >= 50 and r.round = any (c.fixture_ids))
      order by s.points desc
    loop
      i := i + 1;
      w := w || public.contest_winner(c, rec.user_id, rec.points, i, each_share);
    end loop;
  elsif c.prize_structure = 'random_draw' then
    select s.user_id, s.points into rec from public.contest_scores(c.id) s where s.points > 0 order by random() limit 1;
    if found then w := w || public.contest_winner(c, rec.user_id, rec.points, 1, c.prize_zec); end if;
  elsif shares is not null then
    select least(count(*), array_length(shares, 1)) into n from public.contest_scores(c.id) s where s.points > 0;
    for k in 1..coalesce(n, 0) loop total := total + shares[k]; end loop;
    for rec in select s.user_id, s.points from public.contest_scores(c.id) s where s.points > 0 order by s.points desc limit n loop
      i := i + 1;
      each_share := case when total > 0 then round(c.prize_zec * shares[i] / total, 8) else 0 end;
      w := w || public.contest_winner(c, rec.user_id, rec.points, i, each_share);
    end loop;
  end if;

  update public.contests set status = 'closed', winners = w where id = p_id;
  return w;
end $$;
revoke all on function public.admin_close_contest(text) from public, anon;
grant execute on function public.admin_close_contest(text) to authenticated, service_role;

-- One winner entry. Contests Called It ran before sponsors paid directly still credit the Vault balance.
create or replace function public.contest_winner(c public.contests, p_user uuid, p_points bigint, p_rank int, p_zec numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text; addr text;
begin
  select coalesce(nullif(name, ''), 'Player'), coalesce(address, '') into nm, addr from public.profiles where id = p_user;
  if c.owner_id is null and c.prize_zec > 0 and p_zec > 0 then
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (p_user, 'prize_' || c.id || '_' || p_rank, 'Prize · ' || c.title || ' · #' || p_rank, 0, p_zec, now(), true, 'contest:' || c.id)
    on conflict do nothing;
  end if;
  return jsonb_build_object('rank', p_rank, 'name', coalesce(nm, 'Player'), 'points', p_points, 'user_id', p_user,
    'address', coalesce(addr, ''), 'zec', p_zec, 'status', 'pending', 'txid', null);
end $$;
revoke all on function public.contest_winner(public.contests, uuid, bigint, int, numeric) from public, anon, authenticated;

-- ---------- Sponsor contest form ----------
drop function if exists public.sponsor_save_contest(text, text, text[], numeric, text, numeric[], timestamptz, timestamptz, text, text, text, text);
create or replace function public.sponsor_save_contest(
  p_id text, p_title text, p_fixtures text[], p_prize numeric, p_structure text, p_custom_shares numeric[],
  p_entry_deadline timestamptz, p_opens_at timestamptz, p_description text, p_logo text, p_color text, p_url text,
  p_game text default 'football', p_ends_at timestamptz default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); sname text; c public.contests; joined boolean; g text := coalesce(p_game, 'football');
  fx text[] := case when coalesce(p_game, 'football') = 'football' then p_fixtures else '{}'::text[] end;
  ends timestamptz := case when coalesce(p_game, 'football') = 'football' then null else p_ends_at end;
  logo text := nullif(trim(coalesce(p_logo, '')), ''); color text := nullif(trim(coalesce(p_color, '')), ''); url text := nullif(trim(coalesce(p_url, '')), '');
begin
  select name into sname from public.sponsors where user_id = uid and not blocked;
  if sname is null then raise exception 'start sponsoring first (or this sponsor account was blocked)'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the contest a title'; end if;
  if g not in ('football', 'arcade', 'bluff', 'fog', 'werewolf') then raise exception 'pick a game'; end if;
  if g = 'football' and coalesce(array_length(fx, 1), 0) = 0 then raise exception 'pick at least one match'; end if;
  if g <> 'football' and (ends is null or ends < coalesce(p_opens_at, now()) + interval '30 minutes' or ends > now() + interval '31 days') then
    raise exception 'a game contest must end between 30 minutes after it opens and 31 days from now';
  end if;
  if g <> 'football' and p_structure = 'all_correct' then raise exception 'exact-score splits are only for football'; end if;
  if coalesce(p_prize, -1) < 0 or p_prize > 100000 then raise exception 'the prize must be between 0 and 100000 ZEC'; end if;
  if logo is not null and logo !~ '^https://' then raise exception 'the logo must be an https:// link'; end if;
  if url is not null and url !~ '^https://' then raise exception 'the website must be an https:// link'; end if;
  if color is not null and color !~ '^#[0-9a-fA-F]{3,8}$' then raise exception 'the colour must look like #ffb547'; end if;
  if p_structure = 'custom' and (coalesce(array_length(p_custom_shares, 1), 0) not between 1 and 20
      or exists (select 1 from unnest(p_custom_shares) x where x is null or x <= 0 or x > 100)) then
    raise exception 'custom shares must be 1 to 20 percentages, each above 0';
  elsif p_structure = 'equal_split' and (coalesce(array_length(p_custom_shares, 1), 0) <> 1
      or p_custom_shares[1] is null or p_custom_shares[1] <> trunc(p_custom_shares[1]) or p_custom_shares[1] not between 1 and 100) then
    raise exception 'equal split needs a number of winners from 1 to 100';
  elsif coalesce(p_structure, 'top3') not in ('custom', 'equal_split') and p_custom_shares is not null then
    raise exception 'shares are only used with the custom or equal split prize';
  end if;

  select * into c from public.contests where id = p_id;
  if found and c.owner_id is distinct from uid then raise exception 'that contest name is taken, try another title'; end if;
  if found and c.status = 'closed' then raise exception 'finished contests cannot be changed'; end if;
  joined := found and exists (select 1 from public.contest_entries where contest_id = p_id);
  if not found and (select count(*) from public.contests where owner_id = uid and status = 'open') >= 5 then
    raise exception 'you can run up to 5 open contests at a time; one must finish first';
  end if;

  if joined then
    if c.fixture_ids is distinct from fx or c.prize_zec <> p_prize or c.prize_structure is distinct from p_structure
       or c.custom_shares is distinct from p_custom_shares or c.entry_deadline is distinct from p_entry_deadline
       or c.game is distinct from g or c.ends_at is distinct from ends then
      raise exception 'players have joined, so the game, matches, prize and deadlines are locked';
    end if;
  elsif g = 'football' and exists (select 1 from unnest(fx) f where f not in (select id from public.fixtures where kickoff > now())) then
    raise exception 'every match must exist and not have kicked off yet';
  end if;

  insert into public.contests (id, title, sponsor, prize_zec, fixture_ids, sponsor_logo, sponsor_color, sponsor_url,
    prize_structure, entry_deadline, description, custom_shares, owner_id, opens_at, game, ends_at)
  values (p_id, trim(p_title), sname, p_prize, fx, logo, color, url,
    coalesce(p_structure, 'top3'), p_entry_deadline, nullif(trim(coalesce(p_description, '')), ''), p_custom_shares, uid, p_opens_at, g, ends)
  on conflict (id) do update set
    title = excluded.title, sponsor = excluded.sponsor, prize_zec = excluded.prize_zec, fixture_ids = excluded.fixture_ids,
    sponsor_logo = excluded.sponsor_logo, sponsor_color = excluded.sponsor_color, sponsor_url = excluded.sponsor_url,
    prize_structure = excluded.prize_structure, entry_deadline = excluded.entry_deadline, description = excluded.description,
    custom_shares = excluded.custom_shares, game = excluded.game, ends_at = excluded.ends_at,
    opens_at = case when joined then public.contests.opens_at else excluded.opens_at end;
  return p_id;
end $$;
revoke all on function public.sponsor_save_contest(text, text, text[], numeric, text, numeric[], timestamptz, timestamptz, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.sponsor_save_contest(text, text, text[], numeric, text, numeric[], timestamptz, timestamptz, text, text, text, text, text, timestamptz) to authenticated;

-- ---------- Contest rooms ----------
-- An entrant opens a room for the contest's game; other entrants join it from the contest page.
create or replace function public.create_contest_room(p_contest text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.contests; r public.rooms;
begin
  if uid is null then raise exception 'sign in to play'; end if;
  select * into c from public.contests where id = p_contest;
  if not found or c.game = 'football' then raise exception 'this contest has no game rooms'; end if;
  if c.status <> 'open' or now() > c.ends_at then raise exception 'this contest has finished'; end if;
  if c.opens_at is not null and now() < c.opens_at then raise exception 'this contest has not opened yet'; end if;
  if not exists (select 1 from public.contest_entries where contest_id = c.id and user_id = uid) then raise exception 'join the contest first'; end if;
  insert into public.rooms (game, host, title, options, contest_id)
  values (c.game, uid, left(c.title, 120),
    case c.game when 'bluff' then '{"rounds": 5}'::jsonb when 'fog' then '{"turns": 6}'::jsonb else '{}'::jsonb end, c.id)
  returning * into r;
  insert into public.room_players (room_id, user_id, state) values (r.id, uid, 'joined');
  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;
revoke all on function public.create_contest_room(text) from public, anon;
grant execute on function public.create_contest_room(text) to authenticated;

-- Rooms of a contest still waiting for players, so entrants can find a game.
create or replace function public.contest_rooms(p_contest text)
returns table (code text, host_name text, players bigint, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.code, public.room_name(r.host), (select count(*) from public.room_players p where p.room_id = r.id and p.state = 'joined'), r.created_at
  from public.rooms r where r.contest_id = p_contest and r.status = 'lobby' and r.created_at > now() - interval '1 day'
  order by r.created_at desc limit 20
$$;
grant execute on function public.contest_rooms(text) to authenticated;

-- Contest rooms are for entrants only.
create or replace function public.join_room(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  if auth.uid() is null then raise exception 'sign in to join'; end if;
  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'no room with that code'; end if;
  if exists (select 1 from public.room_players where room_id = r.id and user_id = auth.uid() and state = 'joined') then return r.id; end if;
  if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
  if r.contest_id is not null and not exists (select 1 from public.contest_entries where contest_id = r.contest_id and user_id = auth.uid()) then
    raise exception 'this game is part of a contest: join the contest first';
  end if;
  select count(*) into n from public.room_players where room_id = r.id and state = 'joined';
  if n >= (case r.game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end) then raise exception 'this game is full'; end if;
  insert into public.room_players (room_id, user_id, state) values (r.id, auth.uid(), 'joined')
  on conflict (room_id, user_id) do update set state = 'joined', joined_at = now();
  perform public.touch_room(r.id);
  return r.id;
end $$;

-- ---------- Sponsor dashboard: adds the game and end time ----------
create or replace function public.sponsor_dashboard()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.sponsors where user_id = auth.uid() and not blocked) then null else jsonb_build_object(
    'name', (select name from public.sponsors where user_id = auth.uid()),
    'limit_zec', public.sponsor_limit(auth.uid()),
    'owed_zec', public.sponsor_owed(auth.uid()),
    'contests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'status', c.status, 'paused', c.paused, 'hidden', c.hidden, 'opens_at', c.opens_at,
        'prize_zec', c.prize_zec, 'prize_structure', c.prize_structure, 'custom_shares', c.custom_shares,
        'entry_deadline', c.entry_deadline, 'description', c.description, 'sponsor_logo', c.sponsor_logo,
        'sponsor_color', c.sponsor_color, 'sponsor_url', c.sponsor_url, 'fixture_ids', c.fixture_ids, 'winners', c.winners,
        'created_at', c.created_at, 'funded_zec', c.funded_zec, 'pay_by', c.pay_by, 'game', c.game, 'ends_at', c.ends_at,
        'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
        'games_played', (select count(*) from public.rooms r where r.contest_id = c.id and r.status = 'done'),
        'matches', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', f.id, 'home', f.home, 'away', f.away, 'kickoff', f.kickoff, 'home_goals', f.home_goals, 'away_goals', f.away_goals,
            'sealed', (select count(distinct s.user_id) from public.seals s join public.contest_entries e on e.user_id = s.user_id and e.contest_id = c.id
                       where s.round = f.id and s.game = 'classic' and s.received_at < f.kickoff)) order by f.kickoff), '[]'::jsonb)
          from public.fixtures f where f.id = any (c.fixture_ids))
      ) order by c.created_at desc) from public.contests c where c.owner_id = auth.uid()), '[]'::jsonb)
  ) end
$$;

-- ---------- Admin: add or import a match, with its league ----------
drop function if exists public.admin_upsert_fixture(text, text, text, timestamptz);
create or replace function public.admin_upsert_fixture(p_id text, p_home text, p_away text, p_kickoff timestamptz, p_league text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_id !~ '^[a-z0-9-]{3,64}$' then raise exception 'fixture id: 3-64 lowercase letters, digits or dashes'; end if;
  if coalesce(trim(p_home), '') = '' or coalesce(trim(p_away), '') = '' then raise exception 'both team names are required'; end if;
  insert into public.fixtures (id, home, away, kickoff, league) values (p_id, trim(p_home), trim(p_away), p_kickoff, nullif(trim(coalesce(p_league, '')), ''))
  on conflict (id) do update set home = excluded.home, away = excluded.away, kickoff = excluded.kickoff,
    league = coalesce(excluded.league, public.fixtures.league);
end $$;
revoke all on function public.admin_upsert_fixture(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_upsert_fixture(text, text, text, timestamptz, text) to authenticated;
