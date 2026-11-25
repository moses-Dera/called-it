-- Public app settings the admin can change without a redeploy (for now: the prize-fund wallet).
create table if not exists public.app_settings (
  key        text primary key check (key in ('fund_address')),
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings are public" on public.app_settings;
create policy "settings are public" on public.app_settings for select to anon, authenticated using (true);

-- Set or clear a setting. The fund address must be a shielded Zcash address (unified or Sapling).
create or replace function public.admin_set_setting(p_key text, p_value text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text := trim(coalesce(p_value, ''));
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_key <> 'fund_address' then raise exception 'unknown setting'; end if;
  if v = '' then delete from public.app_settings where key = p_key; return true; end if;
  if v !~ '^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{70,80})$' then
    raise exception 'that is not a shielded Zcash address (it should start with u1 or zs1)';
  end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;
revoke all on function public.admin_set_setting(text, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;
