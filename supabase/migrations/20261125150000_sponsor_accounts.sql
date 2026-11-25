-- Sponsor accounts: a sponsor creates and runs their own contests, which go public at the time they choose.
-- The admin decides who is a sponsor and can hide any contest.

create table if not exists public.sponsors (
  user_id  uuid primary key references auth.users on delete cascade,
  name     text not null check (char_length(trim(name)) between 2 and 80),
  added_at timestamptz not null default now()
);
alter table public.sponsors enable row level security;
drop policy if exists "own sponsor row" on public.sponsors;
create policy "own sponsor row" on public.sponsors for select to authenticated using ((select auth.uid()) = user_id);

alter table public.contests
  add column if not exists owner_id uuid references auth.users on delete set null,
  add column if not exists opens_at timestamptz,
  add column if not exists paused   boolean not null default false,
  add column if not exists hidden   boolean not null default false,
  -- ZEC the admin has confirmed arriving for this contest's prizes (sent to the prize wallet with memo fund:<id>).
  add column if not exists funded_zec numeric not null default 0 check (funded_zec >= 0);
create index if not exists contests_owner on public.contests (owner_id);

-- The public sees a contest once it has opened and unless the admin hid it; owners and admins always see theirs.
drop policy if exists "contests are public" on public.contests;
create policy "contests are public" on public.contests for select to anon, authenticated
  using ((not hidden and (opens_at is null or opens_at <= now())) or owner_id = (select auth.uid()) or public.is_admin());

create or replace function public.is_sponsor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sponsors where user_id = auth.uid())
$$;
grant execute on function public.is_sponsor() to anon, authenticated;

-- Joining needs the contest to be open, visible and not paused.
create or replace function public.join_contest(p_id text, p_referrer uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests;
begin
  if auth.uid() is null then raise exception 'sign in to join a contest'; end if;
  select * into c from public.contests where id = p_id;
  if not found or c.hidden or (c.opens_at is not null and c.opens_at > now()) then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then raise exception 'this contest is closed'; end if;
  if c.paused then raise exception 'this contest is paused by its sponsor'; end if;
  if c.entry_deadline is not null and now() > c.entry_deadline then
    raise exception 'entry deadline has passed';
  end if;
  insert into public.contest_entries (contest_id, user_id, referrer)
  values (p_id, auth.uid(), case when p_referrer = auth.uid() then null else p_referrer end)
  on conflict do nothing;
  return jsonb_build_object('joined', true, 'contest', c.title);
end $$;

-- Create or edit the caller's own contest. Once players have joined, the matches and prizes are locked.
create or replace function public.sponsor_save_contest(
  p_id text, p_title text, p_fixtures text[], p_prize numeric, p_structure text, p_custom_shares numeric[],
  p_entry_deadline timestamptz, p_opens_at timestamptz, p_description text, p_logo text, p_color text, p_url text
) returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); sname text; c public.contests; joined boolean;
  logo text := nullif(trim(coalesce(p_logo, '')), ''); color text := nullif(trim(coalesce(p_color, '')), ''); url text := nullif(trim(coalesce(p_url, '')), '');
begin
  select name into sname from public.sponsors where user_id = uid;
  if sname is null then raise exception 'sponsors only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'give the contest a title'; end if;
  if coalesce(array_length(p_fixtures, 1), 0) = 0 then raise exception 'pick at least one match'; end if;
  if coalesce(p_prize, -1) < 0 or p_prize > 100000 then raise exception 'the prize must be between 0 and 100000 ZEC'; end if;
  if logo is not null and logo !~ '^https://' then raise exception 'the logo must be an https:// link'; end if;
  if url is not null and url !~ '^https://' then raise exception 'the website must be an https:// link'; end if;
  if color is not null and color !~ '^#[0-9a-fA-F]{3,8}$' then raise exception 'the colour must look like #ffb547'; end if;

  select * into c from public.contests where id = p_id;
  if found and c.owner_id is distinct from uid then raise exception 'that contest name is taken, try another title'; end if;
  if found and c.status = 'closed' then raise exception 'finished contests cannot be changed'; end if;
  joined := found and exists (select 1 from public.contest_entries where contest_id = p_id);

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
revoke all on function public.sponsor_save_contest(text, text, text[], numeric, text, numeric[], timestamptz, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.sponsor_save_contest(text, text, text[], numeric, text, numeric[], timestamptz, timestamptz, text, text, text, text) to authenticated;

-- Open now, pause or resume the caller's own contest.
create or replace function public.sponsor_control_contest(p_id text, p_action text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests;
begin
  select * into c from public.contests where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'not your contest'; end if;
  if c.status = 'closed' then raise exception 'this contest has finished'; end if;
  if p_action = 'open_now' then update public.contests set opens_at = now() where id = p_id and (opens_at is null or opens_at > now());
  elsif p_action = 'pause' then update public.contests set paused = true where id = p_id;
  elsif p_action = 'resume' then update public.contests set paused = false where id = p_id;
  else raise exception 'unknown action'; end if;
  return true;
end $$;
revoke all on function public.sponsor_control_contest(text, text) from public, anon;
grant execute on function public.sponsor_control_contest(text, text) to authenticated;

-- The sponsor dashboard: the caller's contests with live numbers. Null for anyone who is not a sponsor.
create or replace function public.sponsor_dashboard()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from public.sponsors where user_id = auth.uid()) then null else jsonb_build_object(
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
grant execute on function public.sponsor_dashboard() to authenticated;

-- Admin: grant or remove the sponsor role by the person's sign-in email, list sponsors, hide a contest.
create or replace function public.admin_set_sponsor(p_email text, p_name text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no account with that email yet; ask them to sign in to Called It once first'; end if;
  if p_on then
    insert into public.sponsors (user_id, name) values (uid, trim(p_name))
    on conflict (user_id) do update set name = excluded.name;
  else
    delete from public.sponsors where user_id = uid;
  end if;
  return p_on;
end $$;
revoke all on function public.admin_set_sponsor(text, text, boolean) from public, anon;
grant execute on function public.admin_set_sponsor(text, text, boolean) to authenticated;

create or replace function public.admin_sponsors()
returns table (email text, name text, contests bigint, added_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query select u.email::text, s.name, (select count(*) from public.contests c where c.owner_id = s.user_id), s.added_at
    from public.sponsors s join auth.users u on u.id = s.user_id order by s.added_at desc;
end $$;
revoke all on function public.admin_sponsors() from public, anon;
grant execute on function public.admin_sponsors() to authenticated;

-- Admin: record ZEC received for a contest's prizes. The ledger keeps each contest's money for that contest.
create or replace function public.admin_set_funded(p_id text, p_amount numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'the amount must be zero or more'; end if;
  update public.contests set funded_zec = p_amount where id = p_id;
  return found;
end $$;
revoke all on function public.admin_set_funded(text, numeric) from public, anon;
grant execute on function public.admin_set_funded(text, numeric) to authenticated;

create or replace function public.admin_hide_contest(p_id text, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.contests set hidden = p_hidden where id = p_id;
  return found;
end $$;
revoke all on function public.admin_hide_contest(text, boolean) from public, anon;
grant execute on function public.admin_hide_contest(text, boolean) to authenticated;
