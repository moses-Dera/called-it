-- Usernames for everyone: every account gets an @username (like x.com/username), a public player card at
-- /@username, and can be found by username or name. A username is not a public tipster record: that stays
-- opt-in (public_record) as before.

-- Give the signed-in account a username if it has none, made from its name plus digits. Returns the username.
create or replace function public.ensure_username()
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h text; base text; tries int := 0;
begin
  if uid is null then return null; end if;
  select handle into h from public.profiles where id = uid;
  if h is not null then return h; end if;
  select left(regexp_replace(lower(coalesce(nullif(name, ''), 'player')), '[^a-z0-9_]', '', 'g'), 14) into base from public.profiles where id = uid;
  if coalesce(length(base), 0) < 3 then base := 'player'; end if;
  loop
    h := base || (1000 + floor(random() * 9000))::int;
    exit when not exists (select 1 from public.profiles where handle = h);
    tries := tries + 1;
    if tries > 20 then h := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6); exit; end if;
  end loop;
  perform set_config('calledit.tipster', 'on', true);
  insert into public.profiles (id, handle) values (uid, h)
  on conflict (id) do update set handle = coalesce(public.profiles.handle, excluded.handle);
  return (select handle from public.profiles where id = uid);
end $$;
revoke all on function public.ensure_username() from public, anon;
grant execute on function public.ensure_username() to authenticated;

-- Change your username.
create or replace function public.set_username(p_handle text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h text := lower(trim(coalesce(p_handle, '')));
begin
  if uid is null then raise exception 'sign in first'; end if;
  h := regexp_replace(h, '^@', '');
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'a username is 3 to 20 letters, numbers or underscores'; end if;
  if exists (select 1 from public.profiles where handle = h and id <> uid) then raise exception 'that username is taken'; end if;
  perform set_config('calledit.tipster', 'on', true);
  insert into public.profiles (id, handle) values (uid, h) on conflict (id) do update set handle = excluded.handle;
  return h;
end $$;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- A public player card. Never includes the wallet address.
create or replace function public.player_card(p_handle text)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  with p as (
    select p.id, p.handle, coalesce(nullif(p.name, ''), p.handle) as name, p.avatar, p.bio, p.public_record,
      (select u.created_at from auth.users u where u.id = p.id) as joined
    from public.profiles p where p.handle = lower(regexp_replace(trim(coalesce(p_handle, '')), '^@', ''))
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'handle', p.handle, 'name', p.name, 'avatar', coalesce(p.avatar, 1), 'bio', p.bio, 'joined', p.joined,
    'tipster', p.public_record,
    'points', (select coalesce(sum(r.points), 0) from public.rewards r where r.user_id = p.id and r.verified),
    'calls', (select count(*) from public.seals s where s.user_id = p.id and s.game = 'classic'),
    'contests_won', (select count(*) from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
                     where c.status = 'closed' and w->>'user_id' = p.id::text),
    'zec_received', (select coalesce(sum((w->>'zec')::numeric), 0) from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
                     where c.status = 'closed' and w->>'user_id' = p.id::text and w->>'status' = 'paid'),
    'me', p.id = auth.uid()
  ) end
  from p
$$;
grant execute on function public.player_card(text) to anon, authenticated;

-- Find players by username or name.
create or replace function public.search_players(p_query text)
returns table (handle text, name text, avatar int)
language sql stable security definer set search_path = public as $$
  with q as (select lower(regexp_replace(trim(coalesce(p_query, '')), '^@', '')) as t)
  select p.handle, coalesce(nullif(p.name, ''), p.handle), coalesce(p.avatar, 1)
  from public.profiles p, q
  where length(q.t) >= 2 and p.handle is not null
    and (p.handle like replace(replace(q.t, '%', ''), '_', '\_') || '%' or p.name ilike '%' || replace(q.t, '%', '') || '%')
  order by (p.handle = q.t) desc, (p.handle like q.t || '%') desc, p.handle
  limit 10
$$;
grant execute on function public.search_players(text) to anon, authenticated;
