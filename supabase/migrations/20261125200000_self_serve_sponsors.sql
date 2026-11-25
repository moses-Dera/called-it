-- Self-serve sponsors: anyone signed in can start sponsoring and run contests at once, with no request
-- or approval. Safeguards: contests show whether their prize is funded, unfunded contests never auto-settle,
-- each sponsor runs at most 5 open contests at a time, and the admin can block a sponsor and hide any contest.

alter table public.sponsors add column if not exists blocked boolean not null default false;

create or replace function public.is_sponsor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sponsors where user_id = auth.uid() and not blocked)
$$;

-- Start sponsoring (or rename the sponsor profile). Blocked sponsors can't come back on the same account.
create or replace function public.become_sponsor(p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n text := trim(coalesce(p_name, ''));
begin
  if uid is null then raise exception 'sign in first'; end if;
  if char_length(n) not between 2 and 80 then raise exception 'use a brand or community name of 2 to 80 characters'; end if;
  if exists (select 1 from public.sponsors where user_id = uid and blocked) then raise exception 'this sponsor account was blocked by Called It'; end if;
  insert into public.sponsors (user_id, name) values (uid, n) on conflict (user_id) do update set name = excluded.name;
  return true;
end $$;
revoke all on function public.become_sponsor(text) from public, anon;
grant execute on function public.become_sponsor(text) to authenticated;

create or replace function public.sponsor_save_contest(
  p_id text, p_title text, p_fixtures text[], p_prize numeric, p_structure text, p_custom_shares numeric[],
  p_entry_deadline timestamptz, p_opens_at timestamptz, p_description text, p_logo text, p_color text, p_url text
) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); sname text; c public.contests; joined boolean;
  logo text := nullif(trim(coalesce(p_logo, '')), ''); color text := nullif(trim(coalesce(p_color, '')), ''); url text := nullif(trim(coalesce(p_url, '')), '');
begin
  select name into sname from public.sponsors where user_id = uid and not blocked;
  if sname is null then raise exception 'start sponsoring first (or this sponsor account was blocked)'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the contest a title'; end if;
  if coalesce(array_length(p_fixtures, 1), 0) = 0 then raise exception 'pick at least one match'; end if;
  if coalesce(p_prize, -1) < 0 or p_prize > 100000 then raise exception 'the prize must be between 0 and 100000 ZEC'; end if;
  if logo is not null and logo !~ '^https://' then raise exception 'the logo must be an https:// link'; end if;
  if url is not null and url !~ '^https://' then raise exception 'the website must be an https:// link'; end if;
  if color is not null and color !~ '^#[0-9a-fA-F]{3,8}$' then raise exception 'the colour must look like #ffb547'; end if;
  -- Shares are divided by their total at payout, so a negative or zero share would inflate the others.
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
  -- Anyone can sponsor, so cap open contests per sponsor to keep the contest list free of spam.
  if not found and (select count(*) from public.contests where owner_id = uid and status = 'open') >= 5 then
    raise exception 'you can run up to 5 open contests at a time; one must finish first';
  end if;

  if joined then
    if c.fixture_ids is distinct from p_fixtures or c.prize_zec <> p_prize or c.prize_structure is distinct from p_structure
       or c.custom_shares is distinct from p_custom_shares or c.entry_deadline is distinct from p_entry_deadline then
      raise exception 'players have joined, so the matches, prize and deadline are locked';
    end if;
  elsif exists (select 1 from unnest(p_fixtures) f where f not in (select id from public.fixtures where kickoff > now())) then
    raise exception 'every match must exist and not have kicked off yet';
  end if;

  insert into public.contests (id, title, sponsor, prize_zec, fixture_ids, sponsor_logo, sponsor_color, sponsor_url,
    prize_structure, entry_deadline, description, custom_shares, owner_id, opens_at)
  values (p_id, trim(p_title), sname, p_prize, p_fixtures, logo, color, url,
    coalesce(p_structure, 'top3'), p_entry_deadline, nullif(trim(coalesce(p_description, '')), ''), p_custom_shares, uid, p_opens_at)
  on conflict (id) do update set
    title = excluded.title, sponsor = excluded.sponsor, prize_zec = excluded.prize_zec, fixture_ids = excluded.fixture_ids,
    sponsor_logo = excluded.sponsor_logo, sponsor_color = excluded.sponsor_color, sponsor_url = excluded.sponsor_url,
    prize_structure = excluded.prize_structure, entry_deadline = excluded.entry_deadline, description = excluded.description,
    custom_shares = excluded.custom_shares,
    opens_at = case when joined then public.contests.opens_at else excluded.opens_at end;
  return p_id;
end $$;

create or replace function public.sponsor_dashboard()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.sponsors where user_id = auth.uid() and not blocked) then null else jsonb_build_object(
    'name', (select name from public.sponsors where user_id = auth.uid()),
    'contests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'status', c.status, 'paused', c.paused, 'hidden', c.hidden, 'opens_at', c.opens_at,
        'prize_zec', c.prize_zec, 'prize_structure', c.prize_structure, 'custom_shares', c.custom_shares,
        'entry_deadline', c.entry_deadline, 'description', c.description, 'sponsor_logo', c.sponsor_logo,
        'sponsor_color', c.sponsor_color, 'sponsor_url', c.sponsor_url, 'fixture_ids', c.fixture_ids, 'winners', c.winners,
        'created_at', c.created_at, 'funded_zec', c.funded_zec,
        'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
        'matches', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', f.id, 'home', f.home, 'away', f.away, 'kickoff', f.kickoff, 'home_goals', f.home_goals, 'away_goals', f.away_goals,
            'sealed', (select count(distinct s.user_id) from public.seals s join public.contest_entries e on e.user_id = s.user_id and e.contest_id = c.id
                       where s.round = f.id and s.game = 'classic' and s.received_at < f.kickoff)) order by f.kickoff), '[]'::jsonb)
          from public.fixtures f where f.id = any (c.fixture_ids))
      ) order by c.created_at desc) from public.contests c where c.owner_id = auth.uid()), '[]'::jsonb)
  ) end
$$;

-- Admin: block or unblock a sponsor by email (blocking keeps the row, so they can't re-register).
create or replace function public.admin_set_sponsor(p_email text, p_name text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no account with that email'; end if;
  insert into public.sponsors (user_id, name, blocked) values (uid, coalesce(nullif(trim(p_name), ''), 'Sponsor'), not p_on)
  on conflict (user_id) do update set blocked = not p_on, name = coalesce(nullif(trim(p_name), ''), public.sponsors.name);
  return p_on;
end $$;

drop function if exists public.admin_sponsors();
create or replace function public.admin_sponsors()
returns table (email text, name text, contests bigint, added_at timestamptz, blocked boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query select u.email::text, s.name, (select count(*) from public.contests c where c.owner_id = s.user_id), s.added_at, s.blocked
    from public.sponsors s join auth.users u on u.id = s.user_id order by s.blocked, s.added_at desc;
end $$;
revoke all on function public.admin_sponsors() from public, anon;
grant execute on function public.admin_sponsors() to authenticated;
