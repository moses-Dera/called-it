-- Encrypted wallet backup: the ciphertext of the recovery phrase, encrypted on the device before upload.
-- The server never sees the plaintext phrase. A user restoring on a new device signs in, downloads their
-- ciphertext, and decrypts locally with their passkey or passphrase.

create table if not exists public.wallet_backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  network text not null default 'mainnet',
  ciphertext text not null,
  iv text not null,
  salt text not null,
  kdf text not null default 'argon2id',
  backup_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallet_backups enable row level security;

create policy "own_backup_select" on public.wallet_backups for select using (auth.uid() = user_id);
create policy "own_backup_insert" on public.wallet_backups for insert with check (auth.uid() = user_id);
create policy "own_backup_update" on public.wallet_backups for update using (auth.uid() = user_id);
create policy "own_backup_delete" on public.wallet_backups for delete using (auth.uid() = user_id);

-- Save or update the encrypted backup.
create or replace function public.save_wallet_backup(
  p_network text, p_ciphertext text, p_iv text, p_salt text, p_kdf text default 'argon2id'
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.wallet_backups (user_id, network, ciphertext, iv, salt, kdf, updated_at)
  values (auth.uid(), p_network, p_ciphertext, p_iv, p_salt, p_kdf, now())
  on conflict (user_id) do update set
    network = excluded.network, ciphertext = excluded.ciphertext, iv = excluded.iv,
    salt = excluded.salt, kdf = excluded.kdf, updated_at = now();
  return true;
end $$;
revoke all on function public.save_wallet_backup(text, text, text, text, text) from public, anon;
grant execute on function public.save_wallet_backup(text, text, text, text, text) to authenticated;

-- Mark the backup as verified (the user proved they wrote down the words).
create or replace function public.verify_wallet_backup()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update public.wallet_backups set backup_verified = true, updated_at = now() where user_id = auth.uid();
  return found;
end $$;
revoke all on function public.verify_wallet_backup() from public, anon;
grant execute on function public.verify_wallet_backup() to authenticated;

-- Get the encrypted backup for restore.
create or replace function public.get_wallet_backup()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'network', wb.network, 'ciphertext', wb.ciphertext, 'iv', wb.iv,
    'salt', wb.salt, 'kdf', wb.kdf, 'backup_verified', wb.backup_verified
  ) from public.wallet_backups wb where wb.user_id = auth.uid()
$$;
revoke all on function public.get_wallet_backup() from public, anon;
grant execute on function public.get_wallet_backup() to authenticated;
