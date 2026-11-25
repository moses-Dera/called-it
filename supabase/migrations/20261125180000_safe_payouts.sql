-- Payouts can't go out twice.
-- 1. Claim before sending: a payout moves requested -> sending in one atomic step, so two payout runs
--    (a double click, or the CLI and GitHub Actions together) can't both send it. A run that fails before
--    sending puts it back; anything unclear stays 'sending' for the admin to check, and is never re-sent.
-- 2. One money trail: a contest prize is credited to the winner's balance. Paying it directly now records a
--    paid withdrawal of that amount, so the same prize can't also be withdrawn from the Vault.

alter table public.withdrawals drop constraint if exists withdrawals_status_check;
alter table public.withdrawals add constraint withdrawals_status_check check (status in ('requested', 'sending', 'paid', 'rejected'));
alter table public.withdrawals add column if not exists claimed_at timestamptz;

-- Callable by the payout tool (service role) and by the admin.
create or replace function public.payout_guard() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'admin only'; end if;
end $$;
revoke all on function public.payout_guard() from public, anon, authenticated;

-- ---------- Withdrawals ----------
create or replace function public.payout_claim_withdrawal(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.payout_guard();
  update public.withdrawals set status = 'sending', claimed_at = now() where id = p_id and status = 'requested';
  return found;
end $$;

create or replace function public.payout_finish_withdrawal(p_id uuid, p_txid text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.payout_guard();
  update public.withdrawals set status = 'paid', txid = nullif(trim(coalesce(p_txid, '')), '') where id = p_id and status = 'sending';
  return found;
end $$;

-- Only for a send that certainly did not go out.
create or replace function public.payout_release_withdrawal(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.payout_guard();
  update public.withdrawals set status = 'requested', claimed_at = null where id = p_id and status = 'sending';
  return found;
end $$;

-- The admin settles a stuck 'sending' payout after checking the wallet, or rejects/reopens a request.
create or replace function public.admin_mark_withdrawal(p_id uuid, p_status text, p_txid text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('requested', 'paid', 'rejected') then raise exception 'bad status'; end if;
  update public.withdrawals set status = p_status, txid = coalesce(nullif(trim(p_txid), ''), txid),
    claimed_at = case when p_status = 'requested' then null else claimed_at end
  where id = p_id;
end $$;

-- ---------- Contest winners (stored in contests.winners) ----------
create or replace function public.set_winner_status(p_contest_id text, p_rank int, p_from text[], p_to text, p_txid text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contests; item jsonb; w jsonb := '[]'::jsonb; hit jsonb;
begin
  select * into c from public.contests where id = p_contest_id for update;
  if not found then raise exception 'unknown contest'; end if;
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

-- Record a direct prize payment against the winner's balance, so it can't be withdrawn again.
create or replace function public.record_prize_paid(item jsonb, p_txid text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if item->>'user_id' is not null and coalesce((item->>'zec')::numeric, 0) > 0 then
    insert into public.withdrawals (user_id, address, amount, status, txid)
    values ((item->>'user_id')::uuid, coalesce(nullif(item->>'address', ''), 'direct prize payment'), (item->>'zec')::numeric, 'paid', p_txid);
  end if;
end $$;
revoke all on function public.record_prize_paid(jsonb, text) from public, anon, authenticated;

create or replace function public.payout_claim_winner(p_contest_id text, p_rank int)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests; item jsonb; uid uuid; earned numeric; taken numeric;
begin
  perform public.payout_guard();
  select * into c from public.contests where id = p_contest_id;
  select x into item from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where (x->>'rank')::int = p_rank;
  if item is null then raise exception 'no winner at rank %', p_rank; end if;
  uid := (item->>'user_id')::uuid;
  if uid is not null then
    perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));
    -- The prize sits in the winner's balance. Pay it directly only if it is still there and not
    -- already on its way through a withdrawal request.
    if exists (select 1 from public.withdrawals where user_id = uid and status in ('requested', 'sending')) then
      raise exception 'winner #% has a withdrawal request waiting; pay that instead', p_rank;
    end if;
    select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
    select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
    if earned - taken < coalesce((item->>'zec')::numeric, 0) - 0.00000001 then
      raise exception 'winner #% has already withdrawn this prize', p_rank;
    end if;
  end if;
  return public.set_winner_status(p_contest_id, p_rank, array['pending'], 'sending') is not null;
end $$;

create or replace function public.payout_finish_winner(p_contest_id text, p_rank int, p_txid text)
returns boolean language plpgsql security definer set search_path = public as $$
declare item jsonb;
begin
  perform public.payout_guard();
  item := public.set_winner_status(p_contest_id, p_rank, array['sending'], 'paid', coalesce(nullif(trim(p_txid), ''), 'paid'));
  if item is null then return false; end if;
  perform public.record_prize_paid(item, nullif(trim(p_txid), ''));
  return true;
end $$;

create or replace function public.payout_release_winner(p_contest_id text, p_rank int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.payout_guard();
  return public.set_winner_status(p_contest_id, p_rank, array['sending'], 'pending') is not null;
end $$;

-- Manual "Mark paid" from the admin: same money trail, and it no longer marks unrelated withdrawals paid.
create or replace function public.admin_mark_contest_winner_paid(p_contest_id text, p_rank int, p_txid text default null)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; c public.contests; cur jsonb;
begin
  perform public.payout_guard();
  select * into c from public.contests where id = p_contest_id;
  select x into cur from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where (x->>'rank')::int = p_rank;
  -- A prize not yet claimed by a payout run gets the same checks as the payout tool.
  if coalesce(cur->>'status', 'pending') = 'pending' and cur->>'user_id' is not null
     and exists (select 1 from public.withdrawals where user_id = (cur->>'user_id')::uuid and status in ('requested', 'sending')) then
    raise exception 'winner #% has a withdrawal request waiting; pay that instead', p_rank;
  end if;
  item := public.set_winner_status(p_contest_id, p_rank, array['pending', 'sending'], 'paid', coalesce(nullif(trim(p_txid), ''), 'paid_manually'));
  if item is null then raise exception 'winner #% is not waiting for payment', p_rank; end if;
  perform public.record_prize_paid(item, nullif(trim(p_txid), ''));
end $$;

do $$ declare f text; begin
  foreach f in array array['payout_claim_withdrawal(uuid)', 'payout_finish_withdrawal(uuid, text)', 'payout_release_withdrawal(uuid)',
    'payout_claim_winner(text, int)', 'payout_finish_winner(text, int, text)', 'payout_release_winner(text, int)',
    'admin_mark_contest_winner_paid(text, int, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
