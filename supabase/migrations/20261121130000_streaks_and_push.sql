-- Called It: daily streaks, push notification subscriptions, contest referrals.
-- Applied with `npx supabase db push --remote`.

-- ---------- Push notification subscriptions ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subs" on public.push_subscriptions;
create policy "own push subs" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- Contest referrals ----------
alter table public.contest_entries add column if not exists referrer uuid references auth.users on delete set null;

-- Upgrade join_contest to accept optional referrer
create or replace function public.join_contest(p_id text, p_referrer uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests;
begin
  if auth.uid() is null then raise exception 'sign in to join a contest'; end if;
  select * into c from public.contests where id = p_id;
  if not found then raise exception 'unknown contest'; end if;
  if c.status = 'closed' then raise exception 'this contest is closed'; end if;
  if c.entry_deadline is not null and now() > c.entry_deadline then
    raise exception 'entry deadline has passed';
  end if;
  insert into public.contest_entries (contest_id, user_id, referrer)
  values (p_id, auth.uid(), case when p_referrer = auth.uid() then null else p_referrer end)
  on conflict do nothing;
  return jsonb_build_object('joined', true, 'contest', c.title);
end $$;
revoke all on function public.join_contest(text, uuid) from public, anon;
grant execute on function public.join_contest(text, uuid) to authenticated;

-- ---------- Player stats v2: add daily streak ----------
create or replace function public.player_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  streak int := 0;
  d date;
  prev date;
begin
  -- Count consecutive days (ending today or yesterday) with at least one seal
  for d in
    select distinct date(sealed_at at time zone 'UTC') as day
    from public.seals where user_id = uid
    order by day desc
  loop
    if prev is null then
      if d < current_date - 1 then exit; end if;
      streak := 1; prev := d;
    elsif prev - d = 1 then
      streak := streak + 1; prev := d;
    else
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'called_it', (select count(*) from public.rewards where user_id = uid and verified and points >= 50),
    'total_seals', (select count(*) from public.seals where user_id = uid),
    'total_ranked', (select coalesce(sum(points), 0) from public.rewards where user_id = uid and verified),
    'exact_scores', (select count(*) from public.rewards where user_id = uid and verified and points >= 50),
    'early_birds', (select count(*) from public.rewards where user_id = uid and verified and label like '%x2%'),
    'streak', streak
  );
end $$;
grant execute on function public.player_stats() to anon, authenticated;
