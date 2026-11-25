-- The Zcash network setting: mainnet (real ZEC, the default) or testnet for a practice run.
-- Address checks for the prize wallet and for withdrawals follow it.
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('fund_address', 'network'));

-- The network the app runs on; mainnet unless the admin switched to testnet.
create or replace function public.app_network() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'network'), 'mainnet')
$$;
grant execute on function public.app_network() to anon, authenticated, service_role;

-- A shielded address of the given network: unified (u1 / utest1) or Sapling (zs1 / ztestsapling1), Bech32 characters.
create or replace function public.is_shielded_for(p_address text, p_network text) returns boolean language sql immutable as $$
  select case when p_network = 'testnet'
    then p_address ~ '^(utest1[02-9ac-hj-np-z]{100,}|ztestsapling1[02-9ac-hj-np-z]{70,80})$'
    else p_address ~ '^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{70,80})$' end
$$;
grant execute on function public.is_shielded_for(text, text) to anon, authenticated, service_role;

-- Set or clear a setting. The fund address must be a shielded address on the current network.
-- Switching network clears the fund address, since an address only works on its own network.
create or replace function public.admin_set_setting(p_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_value, ''));
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
  else
    raise exception 'unknown setting';
  end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;
revoke all on function public.admin_set_setting(text, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;

-- Withdrawals: shielded addresses on the app's network only, one request at a time per player.
create or replace function public.request_withdrawal(p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  addr text := trim(coalesce(p_address, ''));
  earned numeric;
  taken numeric;
  available numeric;
  w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  -- A shielded address on the network the app runs on (mainnet unless the admin chose testnet).
  if not public.is_shielded_for(addr, public.app_network()) then
    raise exception 'use a % shielded Zcash address', public.app_network();
  end if;

  -- Serialise this player's requests so two at once cannot both spend the same balance.
  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  available := earned - taken;

  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', available);
  end if;

  insert into public.withdrawals (user_id, address, amount)
  values (uid, addr, available)
  returning * into w;

  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'id', w.id);
end $$;
revoke all on function public.request_withdrawal(text) from public, anon;
grant execute on function public.request_withdrawal(text) to authenticated;
