-- Sponsors pay their winners directly. Called It never holds a sponsor's prize money.
--
-- How a sponsor contest settles:
--   1. When its last match ends the contest closes and ranks the winners (as before), but the prize is NOT
--      credited to the winners' Called It balances. Instead each winner is owed the prize by the sponsor.
--   2. The sponsor has 72 hours (pay_by) to send each winner their ZEC from their own wallet, then marks it sent.
--   3. The winner confirms "I got it" (status paid) or "Not received" (status disputed).
-- Safeguards, all automatic:
--   * New sponsors can promise at most 0.5 ZEC in total; every ZEC their winners confirm raises the limit.
--   * A sponsor with unpaid winners past the deadline can't start another contest.
--   * Every sponsor's track record (contests, paid, unpaid) is public.
-- Winner statuses for sponsor contests: pending -> sent -> paid, or sent -> disputed -> sent again.

alter table public.contests add column if not exists pay_by timestamptz;

-- ---------- Settling a sponsor contest ----------
-- Runs after contests_close_guard (triggers fire in name order). Removes the balance credit the close made,
-- strips addresses (winners are public), and starts the 72-hour payment window.
create or replace function public.contests_sponsor_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'open' and new.status = 'closed' and new.owner_id is not null then
    delete from public.rewards where round = 'contest:' || new.id;
    new.winners := (select coalesce(jsonb_agg((x - 'address') || jsonb_build_object('status', 'pending')
                     order by (x->>'rank')::int), '[]'::jsonb)
                    from jsonb_array_elements(coalesce(new.winners, '[]'::jsonb)) x);
    new.pay_by := now() + interval '72 hours';
  end if;
  return new;
end $$;
drop trigger if exists contests_sponsor_close on public.contests;
create trigger contests_sponsor_close before update on public.contests
  for each row execute function public.contests_sponsor_close();

-- The Called It payout tools only pay contests Called It runs.
create or replace function public.set_winner_status(p_contest_id text, p_rank int, p_from text[], p_to text, p_txid text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests; item jsonb; w jsonb := '[]'::jsonb; hit jsonb;
begin
  select * into c from public.contests where id = p_contest_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.owner_id is not null then raise exception 'the sponsor pays this contest''s winners directly'; end if;
  for item in select * from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) loop
    if (item->>'rank')::int = p_rank and coalesce(item->>'status', 'pending') = any (p_from) then
      item := jsonb_set(item, '{status}', to_jsonb(p_to));
      if p_txid is not null then item := jsonb_set(item, '{txid}', to_jsonb(p_txid)); end if;
      hit := item;
    end if;
    w := w || item;
  end loop;
  if hit is not null then update public.contests set winners = w where id = p_contest_id; end if;
  return hit;
end $$;
revoke all on function public.set_winner_status(text, int, text[], text, text) from public, anon, authenticated;

-- ---------- Track record and limits ----------
-- ZEC a sponsor still owes: winners of their closed contests not yet confirmed paid.
create or replace function public.sponsor_owed(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum((w->>'zec')::numeric), 0)
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
  where c.owner_id = p_owner and c.status = 'closed' and coalesce(w->>'status', 'pending') <> 'paid'
$$;

create or replace function public.sponsor_paid_total(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum((w->>'zec')::numeric), 0)
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
  where c.owner_id = p_owner and c.status = 'closed' and w->>'status' = 'paid'
$$;

-- How much a sponsor may promise across open contests and unpaid winners.
create or replace function public.sponsor_limit(p_owner uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select 0.5 + public.sponsor_paid_total(p_owner)
$$;
revoke all on function public.sponsor_owed(uuid), public.sponsor_paid_total(uuid), public.sponsor_limit(uuid) from public, anon, authenticated;

-- Public track record of every sponsor, shown on their contests.
create or replace function public.sponsor_records()
returns table (owner_id uuid, contests bigint, paid_contests bigint, overdue_contests bigint, paid_zec numeric)
language sql stable security definer set search_path = public as $$
  select c.owner_id,
    count(*) filter (where c.status = 'closed' and coalesce(jsonb_array_length(c.winners), 0) > 0),
    count(*) filter (where c.status = 'closed' and coalesce(jsonb_array_length(c.winners), 0) > 0
                       and not exists (select 1 from jsonb_array_elements(c.winners) w where coalesce(w->>'status', 'pending') <> 'paid')),
    count(*) filter (where c.status = 'closed' and c.pay_by < now()
                       and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where coalesce(w->>'status', 'pending') <> 'paid')),
    public.sponsor_paid_total(c.owner_id)
  from public.contests c where c.owner_id is not null group by c.owner_id
$$;
grant execute on function public.sponsor_records() to anon, authenticated;

-- Enforced on every sponsor contest save, so it holds however the contest is created.
create or replace function public.contests_sponsor_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare late text; promised numeric; lim numeric;
begin
  if new.owner_id is null or new.status <> 'open' or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.prize_zec = old.prize_zec then return new; end if;
  if tg_op = 'INSERT' then
    select title into late from public.contests c
    where c.owner_id = new.owner_id and c.status = 'closed' and c.pay_by < now()
      and exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w where coalesce(w->>'status', 'pending') <> 'paid')
    limit 1;
    if late is not null then
      raise exception 'winners of "%" are still waiting to be paid. Pay them before starting another contest', late;
    end if;
  end if;
  select coalesce(sum(prize_zec), 0) into promised from public.contests
  where owner_id = new.owner_id and status = 'open' and id <> new.id;
  promised := promised + public.sponsor_owed(new.owner_id) + new.prize_zec;
  lim := public.sponsor_limit(new.owner_id);
  if promised > lim then
    raise exception 'your prize limit is % ZEC in total (open prizes plus unpaid winners). It grows by every ZEC your winners confirm they received', lim;
  end if;
  return new;
end $$;
drop trigger if exists contests_sponsor_limits on public.contests;
create trigger contests_sponsor_limits before insert or update on public.contests
  for each row execute function public.contests_sponsor_limits();

-- ---------- Paying ----------
-- Write one winner's new status (and txid) into a sponsor contest.
create or replace function public.sponsor_set_winner(p_contest_id text, p_rank int, p_from text[], p_to text, p_txid text)
returns boolean language plpgsql security definer set search_path = public as $$
declare w jsonb; hit boolean := false;
begin
  select coalesce(jsonb_agg(case when (x->>'rank')::int = p_rank and coalesce(x->>'status', 'pending') = any (p_from)
      then x || jsonb_build_object('status', p_to) || case when p_txid is null then '{}'::jsonb else jsonb_build_object('txid', p_txid) end
      else x end order by (x->>'rank')::int), '[]'::jsonb),
    bool_or((x->>'rank')::int = p_rank and coalesce(x->>'status', 'pending') = any (p_from))
  into w, hit
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where c.id = p_contest_id;
  if coalesce(hit, false) then update public.contests set winners = w where id = p_contest_id; end if;
  return coalesce(hit, false);
end $$;
revoke all on function public.sponsor_set_winner(text, int, text[], text, text) from public, anon, authenticated;

-- The sponsor's list of who to pay, with each winner's current shielded address on the app's network.
create or replace function public.sponsor_payees(p_contest_id text)
returns table (rank int, name text, zec numeric, status text, txid text, address text)
language plpgsql stable security definer set search_path = public as $$
declare c public.contests;
begin
  select * into c from public.contests where id = p_contest_id;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'not your contest'; end if;
  return query
    select (w->>'rank')::int, w->>'name', (w->>'zec')::numeric, coalesce(w->>'status', 'pending'), w->>'txid',
      case when public.is_shielded_for(coalesce(p.address, ''), public.app_network()) then p.address end
    from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
    left join public.profiles p on p.id = (w->>'user_id')::uuid
    order by 1;
end $$;
revoke all on function public.sponsor_payees(text) from public, anon;
grant execute on function public.sponsor_payees(text) to authenticated;

-- The sponsor marks a winner as sent, optionally with the transaction ID from their wallet.
create or replace function public.sponsor_mark_sent(p_contest_id text, p_rank int, p_txid text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests; t text := lower(nullif(trim(coalesce(p_txid, '')), ''));
begin
  select * into c from public.contests where id = p_contest_id for update;
  if not found or c.owner_id is distinct from auth.uid() then raise exception 'not your contest'; end if;
  if c.status <> 'closed' then raise exception 'pay winners after the contest closes'; end if;
  if t is not null and t !~ '^[0-9a-f]{64}$' then raise exception 'a transaction ID is 64 characters of 0-9 and a-f'; end if;
  if not public.sponsor_set_winner(p_contest_id, p_rank, array['pending', 'disputed'], 'sent', t) then
    raise exception 'winner #% is not waiting for payment', p_rank;
  end if;
  return true;
end $$;
revoke all on function public.sponsor_mark_sent(text, int, text) from public, anon;
grant execute on function public.sponsor_mark_sent(text, int, text) to authenticated;

-- The winner confirms the payment arrived, or reports it didn't.
create or replace function public.confirm_prize(p_contest_id text, p_rank int, p_received boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests; mine boolean;
begin
  select * into c from public.contests where id = p_contest_id for update;
  if not found or c.owner_id is null then raise exception 'unknown contest'; end if;
  select exists (select 1 from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
                 where (w->>'rank')::int = p_rank and w->>'user_id' = auth.uid()::text) into mine;
  if not mine then raise exception 'this prize is not yours'; end if;
  if p_received then
    if not public.sponsor_set_winner(p_contest_id, p_rank, array['pending', 'sent', 'disputed'], 'paid', null) then
      raise exception 'this prize is already confirmed';
    end if;
  elsif not public.sponsor_set_winner(p_contest_id, p_rank, array['sent'], 'disputed', null) then
    raise exception 'the sponsor has not marked this prize as sent yet';
  end if;
  return true;
end $$;
revoke all on function public.confirm_prize(text, int, boolean) from public, anon;
grant execute on function public.confirm_prize(text, int, boolean) to authenticated;

-- A player's prizes from sponsor contests, for the Vault.
create or replace function public.my_sponsor_prizes()
returns table (contest_id text, title text, sponsor text, rank int, zec numeric, status text, txid text, pay_by timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.sponsor, (w->>'rank')::int, (w->>'zec')::numeric, coalesce(w->>'status', 'pending'), w->>'txid', c.pay_by
  from public.contests c, jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) w
  where c.owner_id is not null and c.status = 'closed' and w->>'user_id' = auth.uid()::text and (w->>'zec')::numeric > 0
  order by c.pay_by desc nulls last
$$;
revoke all on function public.my_sponsor_prizes() from public, anon;
grant execute on function public.my_sponsor_prizes() to authenticated;

-- Sponsor dashboard: adds the payment deadline and the sponsor's prize limit; drops the old funding figure.
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
        'created_at', c.created_at, 'funded_zec', c.funded_zec, 'pay_by', c.pay_by,
        'entries', (select count(*) from public.contest_entries e where e.contest_id = c.id),
        'matches', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', f.id, 'home', f.home, 'away', f.away, 'kickoff', f.kickoff, 'home_goals', f.home_goals, 'away_goals', f.away_goals,
            'sealed', (select count(distinct s.user_id) from public.seals s join public.contest_entries e on e.user_id = s.user_id and e.contest_id = c.id
                       where s.round = f.id and s.game = 'classic' and s.received_at < f.kickoff)) order by f.kickoff), '[]'::jsonb)
          from public.fixtures f where f.id = any (c.fixture_ids))
      ) order by c.created_at desc) from public.contests c where c.owner_id = auth.uid()), '[]'::jsonb)
  ) end
$$;
