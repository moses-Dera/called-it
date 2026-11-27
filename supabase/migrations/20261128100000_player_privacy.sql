-- Privacy by default for players. Contest prizes stay public (the pot and each place's prize); what is protected
-- is the person: their totals, stats and findability. Wallet addresses are already never public.
--   * A player's public page (/@username) shows only username, name, avatar and bio unless they turn on
--     "Show my stats" (points, calls, contest wins).
--   * Total ZEC received is shown to the player only, never to anyone else.
--   * "Hide me from name search": the player is found only by their exact @username.

alter table public.profiles add column if not exists show_stats boolean not null default false;
alter table public.profiles add column if not exists searchable boolean not null default true;

-- Change your privacy settings.
create or replace function public.set_privacy(p_show_stats boolean, p_searchable boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.profiles (id, show_stats, searchable) values (auth.uid(), coalesce(p_show_stats, false), coalesce(p_searchable, true))
  on conflict (id) do update set show_stats = coalesce(p_show_stats, false), searchable = coalesce(p_searchable, true);
  return true;
end $$;
revoke all on function public.set_privacy(boolean, boolean) from public, anon;
grant execute on function public.set_privacy(boolean, boolean) to authenticated;

create or replace function public.my_privacy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('show_stats', coalesce(p.show_stats, false), 'searchable', coalesce(p.searchable, true))
  from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.my_privacy() from public, anon;
grant execute on function public.my_privacy() to authenticated;

-- The public player card. Stats only when the player allows it (or it's their own card); ZEC received only to
-- the player themselves; never the wallet address.
create or replace function public.player_card(p_handle text)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  with p as (
    select p.id, p.handle, coalesce(nullif(p.name, ''), p.handle) as name, p.avatar, p.bio, p.public_record,
      p.show_stats, p.id = auth.uid() as me,
      (select u.created_at from auth.users u where u.id = p.id) as joined
    from public.profiles p where p.handle = lower(regexp_replace(trim(coalesce(p_handle, '')), '^@', ''))
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'handle', p.handle, 'name', p.name, 'avatar', coalesce(p.avatar, 1), 'bio', p.bio, 'joined', p.joined,
    'tipster', p.public_record, 'me', p.me, 'stats_public', p.show_stats,
    'points', case when p.show_stats or p.me then (select coalesce(sum(r.points), 0) from public.rewards r where r.user_id = p.id and r.verified) end,
    'calls', case when p.show_stats or p.me then (select count(*) from public.seals s where s.user_id = p.id and s.game = 'classic') end,
    'contests_won', case when p.show_stats or p.me then (select count(*) from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
                     where c.status = 'closed' and w->>'user_id' = p.id::text) end,
    'zec_received', case when p.me then (select coalesce(sum((w->>'zec')::numeric), 0) from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
                     where c.status = 'closed' and w->>'user_id' = p.id::text and w->>'status' = 'paid') end
  ) end
  from p
$$;
grant execute on function public.player_card(text) to anon, authenticated;

-- Find players. Name matches only for players who allow it; an exact @username always resolves.
create or replace function public.search_players(p_query text)
returns table (handle text, name text, avatar int)
language sql stable security definer set search_path = public as $$
  with q as (select lower(regexp_replace(trim(coalesce(p_query, '')), '^@', '')) as t)
  select p.handle, coalesce(nullif(p.name, ''), p.handle), coalesce(p.avatar, 1)
  from public.profiles p, q
  where length(q.t) >= 2 and p.handle is not null
    and (p.handle = q.t
         or (p.searchable and (p.handle like replace(replace(q.t, '%', ''), '_', '\_') || '%'
                               or p.name ilike '%' || replace(q.t, '%', '') || '%')))
  order by (p.handle = q.t) desc, (p.handle like q.t || '%') desc, p.handle
  limit 10
$$;
grant execute on function public.search_players(text) to anon, authenticated;
