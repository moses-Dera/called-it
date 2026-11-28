-- Platform payout fee (basis points: e.g. 500 = 5%) configurable by the admin.
-- Deducted when a player requests a withdrawal; the net amount is queued for payout
-- and the retained fee stays in the platform prize wallet.

alter table public.withdrawals
  add column if not exists fee_amount numeric not null default 0;

alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check
  check (key in ('fund_address', 'network', 'point_zec', 'general_game_zec', 'platform_fee_bps'));

create or replace function public.admin_set_setting(p_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_value, '')); num numeric; bps int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_key = 'network' then
    if v not in ('mainnet', 'testnet') then raise exception 'network must be mainnet or testnet'; end if;
    if v <> public.app_network() then delete from public.app_settings where key = 'fund_address'; end if;
  elsif p_key = 'fund_address' then
    if v = '' then delete from public.app_settings where key = p_key; return true; end if;
    if not public.is_shielded_for(v, public.app_network()) then
      raise exception 'that is not a % shielded Zcash address', public.app_network();
    end if;
  elsif p_key = 'point_zec' then
    begin num := v::numeric; exception when others then raise exception 'enter a numeric ZEC amount per point'; end;
    if num < 0 or num > 0.01 then raise exception 'ZEC per point must be between 0 and 0.01'; end if;
    v := num::text;
  elsif p_key = 'general_game_zec' then
    if v not in ('true', 'false') then raise exception 'general_game_zec must be true or false'; end if;
  elsif p_key = 'platform_fee_bps' then
    begin bps := v::int; exception when others then raise exception 'platform fee must be a whole number of basis points (0 to 2500)'; end;
    if bps < 0 or bps > 2500 then raise exception 'platform fee must be between 0%% and 25%% (0 to 2500 bps)'; end if;
    v := bps::text;
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;

create or replace function public.send_tip(p_to uuid, p_amount numeric, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  earned numeric;
  taken numeric;
  tipped_out numeric;
  available numeric;
  to_name text;
  t public.tips;
begin
  if uid is null then raise exception 'sign in to send a tip'; end if;
  if p_to is null or p_to = uid then raise exception 'cannot tip yourself'; end if;
  if p_amount is null or p_amount < 0.0001 then raise exception 'minimum tip is 0.0001 ZEC'; end if;
  if p_amount > 10 then raise exception 'maximum tip is 10 ZEC'; end if;

  select name into to_name from public.profiles where id = p_to;
  if to_name is null then raise exception 'player not found'; end if;

  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount + coalesce(fee_amount, 0)), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
  available := earned - taken - tipped_out;

  if available < p_amount then
    raise exception 'insufficient ZEC balance (available: %)', round(greatest(available, 0), 4);
  end if;

  insert into public.tips (from_user, to_user, amount, message)
  values (uid, p_to, p_amount, nullif(left(trim(coalesce(p_message, '')), 140), ''))
  returning * into t;

  insert into public.rewards (user_id, source, label, points, zec, verified)
  values (p_to, 'tip', 'Tip from player', 0, p_amount, true);

  return jsonb_build_object('status', 'sent', 'amount', p_amount, 'to', to_name, 'tip_id', t.id);
end $$;

create or replace function public.request_withdrawal(p_address text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  addr text := trim(coalesce(p_address, ''));
  earned numeric;
  taken numeric;
  tipped_out numeric;
  available numeric;
  fee_bps int;
  fee numeric;
  net numeric;
  w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  if not public.is_shielded_for(addr, public.app_network()) then
    raise exception 'use a % shielded Zcash address', public.app_network();
  end if;

  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount + coalesce(fee_amount, 0)), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
  available := earned - taken - tipped_out;

  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', greatest(available, 0));
  end if;

  select coalesce(nullif(value, '')::int, 0) into fee_bps from public.app_settings where key = 'platform_fee_bps';
  fee_bps := coalesce(fee_bps, 0);
  fee := round((available * fee_bps / 10000.0)::numeric, 8);
  net := greatest(available - fee, 0);

  insert into public.withdrawals (user_id, address, amount, fee_amount)
  values (uid, addr, net, fee)
  returning * into w;

  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'fee', w.fee_amount, 'id', w.id);
end $$;

create or replace function public.payout_claim_winner(p_contest_id text, p_rank int)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests; item jsonb; uid uuid; earned numeric; taken numeric; tipped_out numeric;
begin
  perform public.payout_guard();
  select * into c from public.contests where id = p_contest_id;
  select x into item from jsonb_array_elements(coalesce(c.winners, '[]'::jsonb)) x where (x->>'rank')::int = p_rank;
  if item is null then raise exception 'no winner at rank %', p_rank; end if;
  uid := (item->>'user_id')::uuid;
  if uid is not null then
    perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));
    if exists (select 1 from public.withdrawals where user_id = uid and status in ('requested', 'sending')) then
      raise exception 'winner #% has a withdrawal request waiting; pay that instead', p_rank;
    end if;
    select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
    select coalesce(sum(amount + coalesce(fee_amount, 0)), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
    select coalesce(sum(amount), 0) into tipped_out from public.tips where from_user = uid;
    if earned - taken - tipped_out < coalesce((item->>'zec')::numeric, 0) - 0.00000001 then
      raise exception 'winner #% has already withdrawn or tipped this prize', p_rank;
    end if;
  end if;
  return public.set_winner_status(p_contest_id, p_rank, array['pending'], 'sending') is not null;
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'wallets_created', (select count(distinct user_id) from public.wallet_backups),
    'verified_backups', (select count(distinct user_id) from public.wallet_backups where backup_verified),
    'seals', (select count(*) from public.seals),
    'ranked_points', (select coalesce(sum(points), 0) from public.rewards where verified),
    'requested_zec', (select coalesce(sum(amount), 0) from public.withdrawals where status = 'requested'),
    'total_fees', (select coalesce(sum(fee_amount), 0) from public.withdrawals where status <> 'rejected'),
    'withdrawals', (select coalesce(jsonb_agg(w order by w.created_at desc), '[]'::jsonb) from (
        select w.id, w.address, w.amount, w.status, w.txid, w.created_at, coalesce(nullif(p.name, ''), 'Player') as name
        from public.withdrawals w left join public.profiles p on p.id = w.user_id
        order by w.created_at desc limit 50) w)
  );
end $$;
