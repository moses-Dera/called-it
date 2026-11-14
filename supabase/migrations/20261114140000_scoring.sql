-- Called It: fixtures, server-verified scoring, public leaderboard and withdrawal requests.
-- Applied with `npx supabase db push --remote`.
--
-- Trust model:
--   * Points a browser reports (games against bots) stay "practice" points: verified = false.
--   * Only claim_classic() can create verified points. It re-hashes the revealed move, checks the
--     seal reached the server before kickoff, and scores against the official result in `fixtures`.
--   * The leaderboard and withdrawals only count verified points.

-- ---------- Fixtures (public, read-only to players) ----------
create table if not exists public.fixtures (
  id text primary key,
  home text not null,
  away text not null,
  kickoff timestamptz not null,
  home_goals int check (home_goals >= 0),
  away_goals int check (away_goals >= 0),
  check ((home_goals is null) = (away_goals is null))
);
alter table public.fixtures enable row level security;
drop policy if exists "fixtures are public" on public.fixtures;
create policy "fixtures are public" on public.fixtures for select to anon, authenticated using (true);

insert into public.fixtures (id, home, away, kickoff) values
  ('reds-blues-2026-11-21', 'Reds', 'Blues', '2026-11-21 17:30:00+00'),
  ('lagos-derby-2026-11-22', 'Lagos Reds', 'Lagos Blues', '2026-11-22 16:00:00+00')
on conflict (id) do nothing;

-- ---------- Seals: server receive time, and nothing important can be rewritten ----------
alter table public.seals add column if not exists received_at timestamptz not null default now();

create or replace function public.seals_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.received_at := now();          -- the server's clock, not the browser's
    new.revealed := false;             -- only claim_classic() marks a seal revealed
  else
    new.commitment := old.commitment;  -- a sealed hash can never be swapped after the fact
    new.round := old.round;
    new.game := old.game;
    new.sealed_at := old.sealed_at;
    new.received_at := old.received_at;
    new.revealed := old.revealed or new.revealed and current_setting('calledit.claiming', true) = 'on';
  end if;
  return new;
end $$;
drop trigger if exists seals_guard on public.seals;
create trigger seals_guard before insert or update on public.seals for each row execute function public.seals_guard();

-- ---------- Rewards: browsers may only write practice (unverified) rows ----------
alter table public.rewards add column if not exists verified boolean not null default false;
alter table public.rewards add column if not exists round text;
create unique index if not exists rewards_one_verified_per_round on public.rewards (user_id, round) where verified;

drop policy if exists "own rewards" on public.rewards;
drop policy if exists "read own rewards" on public.rewards;
drop policy if exists "insert own practice rewards" on public.rewards;
drop policy if exists "update own practice rewards" on public.rewards;
drop policy if exists "delete own practice rewards" on public.rewards;
create policy "read own rewards" on public.rewards for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "insert own practice rewards" on public.rewards for insert to authenticated
  with check ((select auth.uid()) = user_id and not verified);
create policy "update own practice rewards" on public.rewards for update to authenticated
  using ((select auth.uid()) = user_id and not verified) with check ((select auth.uid()) = user_id and not verified);
create policy "delete own practice rewards" on public.rewards for delete to authenticated
  using ((select auth.uid()) = user_id and not verified);

-- ---------- Verified scoring for Classic Call ----------
create or replace function public.claim_classic(p_seal_id text, p_player text, p_move text, p_salt text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  s public.seals;
  f public.fixtures;
  h int; a int; result_ok boolean; exact boolean; base int; total int;
begin
  if uid is null then raise exception 'sign in to claim points'; end if;
  select * into s from public.seals where user_id = uid and id = p_seal_id;
  if not found then raise exception 'seal not found on the server (was it synced before kickoff?)'; end if;
  if s.game <> 'classic' then raise exception 'only Classic Call seals can be claimed'; end if;

  if encode(digest(convert_to('calledit:v1|' || p_player || '|' || s.round || '|' || p_move || '|' || p_salt, 'UTF8'), 'sha256'), 'hex') <> s.commitment then
    raise exception 'the revealed move does not match the sealed hash';
  end if;

  select * into f from public.fixtures where id = s.round;
  if not found then raise exception 'unknown fixture'; end if;
  if s.received_at >= f.kickoff then
    return jsonb_build_object('status', 'late', 'message', 'This seal reached the server after kickoff, so it cannot earn ranked points.');
  end if;
  if f.home_goals is null then
    return jsonb_build_object('status', 'pending', 'message', 'Waiting for the official full-time result.');
  end if;

  h := split_part(split_part(p_move, '|', 1), '-', 1)::int;
  a := split_part(split_part(p_move, '|', 1), '-', 2)::int;
  result_ok := sign(h - a) = sign(f.home_goals - f.away_goals);
  exact := h = f.home_goals and a = f.away_goals;
  base := (case when result_ok then 10 else 0 end) + (case when exact then 40 else 0 end);
  total := base * (case when f.kickoff - s.received_at > interval '24 hours' then 2 else 1 end);

  perform set_config('calledit.claiming', 'on', true);
  update public.seals set revealed = true where user_id = uid and id = s.id;
  if total > 0 then
    insert into public.rewards (user_id, id, label, points, zec, at, verified, round)
    values (uid, 'v_' || s.id, f.home || ' ' || f.home_goals || ' – ' || f.away_goals || ' ' || f.away || ' · Classic Call (verified)',
            total, total / 100000.0, now(), true, s.round)
    on conflict do nothing;
  end if;
  return jsonb_build_object('status', 'scored', 'points', total, 'exact', exact, 'result', result_ok,
                            'final', f.home_goals || '-' || f.away_goals, 'id', 'v_' || s.id);
end $$;
revoke all on function public.claim_classic(text, text, text, text) from public, anon;
grant execute on function public.claim_classic(text, text, text, text) to authenticated;

-- ---------- Public leaderboard (verified points only) ----------
create or replace function public.leaderboard(p_period text default 'week')
returns table (rank bigint, name text, avatar int, points bigint, me boolean)
language sql stable security definer set search_path = public as $$
  select rank() over (order by sum(r.points) desc), coalesce(nullif(p.name, ''), 'Player'), coalesce(p.avatar, 1),
         sum(r.points)::bigint, r.user_id = auth.uid()
  from public.rewards r left join public.profiles p on p.id = r.user_id
  where r.verified and (p_period = 'all' or r.at >= date_trunc('week', now()))
  group by r.user_id, p.name, p.avatar
  order by 4 desc
  limit 50
$$;
grant execute on function public.leaderboard(text) to anon, authenticated;

-- ---------- Withdrawal requests (paid manually or by the payout script) ----------
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  address text not null,
  amount numeric not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  txid text,
  created_at timestamptz not null default now()
);
alter table public.withdrawals enable row level security;
drop policy if exists "read own withdrawals" on public.withdrawals;
create policy "read own withdrawals" on public.withdrawals for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.request_withdrawal(p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); earned numeric; taken numeric; available numeric; w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  if p_address !~ '^utest1[a-z0-9]{20,}$' then raise exception 'use a testnet unified address (utest1…)'; end if;
  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  available := earned - taken;
  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', available);
  end if;
  insert into public.withdrawals (user_id, address, amount) values (uid, p_address, available) returning * into w;
  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'id', w.id);
end $$;
revoke all on function public.request_withdrawal(text) from public, anon;
grant execute on function public.request_withdrawal(text) to authenticated;
