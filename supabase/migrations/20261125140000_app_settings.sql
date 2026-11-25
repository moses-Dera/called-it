-- Public app settings the admin can change without a redeploy: the prize-fund wallet and the Zcash network
-- (mainnet for real prizes, testnet for a practice run with test coins).
create table if not exists public.app_settings (
  key        text primary key check (key in ('fund_address', 'network')),
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings are public" on public.app_settings;
create policy "settings are public" on public.app_settings for select to anon, authenticated using (true);

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
