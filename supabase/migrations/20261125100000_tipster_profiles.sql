-- Verified tipster profiles: an opt-in public record of a player's Classic Calls.
-- The record is written only by the server (service role), after full time, from the reveal escrow,
-- so a tipster cannot hide a losing tip:
--   * one tip per match counts: the earliest seal the server received before kickoff
--   * a tip whose escrowed move is missing, arrived after kickoff, or does not match its seal counts as lost

alter table public.profiles
  add column if not exists handle text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  add column if not exists bio text not null default '' check (char_length(bio) <= 140),
  add column if not exists public_record boolean not null default false,
  add column if not exists public_since timestamptz;

create table if not exists public.tip_results (
  user_id     uuid not null references auth.users on delete cascade,
  fixture_id  text not null references public.fixtures on delete cascade,
  seal_id     text not null,
  received_at timestamptz not null,
  pick        text,                                   -- "2-1"; null when the move could not be revealed
  outcome     text not null check (outcome in ('won', 'lost')),
  exact       boolean not null default false,
  reason      text not null default 'revealed' check (reason in ('revealed', 'missing', 'late', 'mismatch')),
  settled_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);
create index if not exists tip_results_user_settled on public.tip_results (user_id, settled_at desc);
alter table public.tip_results enable row level security;
-- No policies: only the service role writes, and the public reads through tipster_profile().

-- Anyone who has ever had a public record cannot delete Classic Call seals: deleting a losing tip
-- before full time would otherwise keep it off the record.
create or replace function public.seals_no_delete_for_tipsters() returns trigger language plpgsql as $$
begin
  if old.game = 'classic' and exists (select 1 from public.profiles where id = old.user_id and public_since is not null) then
    raise exception 'tips on a public record cannot be deleted';
  end if;
  return old;
end $$;
drop trigger if exists seals_no_delete_for_tipsters on public.seals;
create trigger seals_no_delete_for_tipsters before delete on public.seals
  for each row execute function public.seals_no_delete_for_tipsters();

-- Players could delete their own profile row, which would clear public_since and reopen deletes.
-- They never need to: replace the catch-all policy with read, create and update only.
drop policy if exists "own profile" on public.profiles;
drop policy if exists "own profile read" on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- public_since only moves forward, and only set_tipster_profile changes the public fields.
create or replace function public.profiles_guard_public() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if current_setting('calledit.tipster', true) is distinct from 'on' then
      new.handle := null; new.public_record := false; new.public_since := null;
    end if;
    return new;
  end if;
  if current_setting('calledit.tipster', true) is distinct from 'on' then
    new.handle := old.handle;
    new.public_record := old.public_record;
    new.public_since := old.public_since;
  end if;
  if old.public_since is not null then new.public_since := old.public_since; end if;
  return new;
end $$;
drop trigger if exists profiles_guard_public on public.profiles;
create trigger profiles_guard_public before insert or update on public.profiles
  for each row execute function public.profiles_guard_public();

-- Claim a handle and turn the public record on or off.
create or replace function public.set_tipster_profile(p_handle text, p_bio text, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h text := lower(trim(p_handle));
begin
  if uid is null then raise exception 'sign in first'; end if;
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle must be 3-20 letters, numbers or underscores'; end if;
  if exists (select 1 from public.profiles where handle = h and id <> uid) then raise exception 'that handle is taken'; end if;
  perform set_config('calledit.tipster', 'on', true);
  insert into public.profiles (id, handle, bio, public_record, public_since)
  values (uid, h, left(coalesce(p_bio, ''), 140), p_public, case when p_public then now() end)
  on conflict (id) do update set
    handle = excluded.handle,
    bio = excluded.bio,
    public_record = p_public,
    public_since = case when p_public then coalesce(public.profiles.public_since, now()) else public.profiles.public_since end;
  return jsonb_build_object('handle', h, 'public', p_public);
end $$;
revoke all on function public.set_tipster_profile(text, text, boolean) from public, anon;
grant execute on function public.set_tipster_profile(text, text, boolean) to authenticated;

-- Everything a public profile page shows. Returns null for unknown or private handles.
create or replace function public.tipster_profile(p_handle text)
returns jsonb language sql stable security definer set search_path = public as $$
  with p as (
    select id, handle, coalesce(nullif(name, ''), handle) as name, avatar, bio, public_since
    from public.profiles where handle = lower(p_handle) and public_record
  ),
  r as (
    select t.*, f.home, f.away, f.kickoff, f.home_goals, f.away_goals, s.commitment, s.root, s.height
    from public.tip_results t
    join p on p.id = t.user_id
    join public.fixtures f on f.id = t.fixture_id
    left join public.seals s on s.user_id = t.user_id and s.id = t.seal_id
  ),
  pending as (
    -- Sealed before kickoff, not settled yet: show that a tip exists, never what it is.
    select distinct on (s.round) s.round, s.received_at, f.home, f.away, f.kickoff
    from public.seals s
    join p on p.id = s.user_id
    join public.fixtures f on f.id = s.round
    where s.game = 'classic' and s.received_at < f.kickoff and f.home_goals is null
      and not exists (select 1 from public.tip_results t where t.user_id = s.user_id and t.fixture_id = s.round)
    order by s.round, s.received_at
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'handle', (select handle from p),
    'name', (select name from p),
    'avatar', (select avatar from p),
    'bio', (select bio from p),
    'public_since', (select public_since from p),
    'settled', (select count(*) from r),
    'won', (select count(*) from r where outcome = 'won'),
    'exact', (select count(*) from r where exact),
    'form', coalesce((select jsonb_agg(outcome order by kickoff) from (select outcome, kickoff from r order by kickoff desc limit 10) x), '[]'::jsonb),
    'tips', coalesce((select jsonb_agg(jsonb_build_object(
        'fixture_id', fixture_id, 'home', home, 'away', away, 'kickoff', kickoff,
        'home_goals', home_goals, 'away_goals', away_goals, 'pick', pick, 'outcome', outcome,
        'exact', exact, 'reason', reason, 'received_at', received_at,
        'commitment', commitment, 'root', root, 'height', height) order by kickoff desc)
      from (select * from r order by kickoff desc limit 50) y), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'home', home, 'away', away, 'kickoff', kickoff, 'received_at', received_at) order by kickoff)
      from pending), '[]'::jsonb)
  ) end
$$;
grant execute on function public.tipster_profile(text) to anon, authenticated;
