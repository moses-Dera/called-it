-- Called It: ranked points no longer turn into ZEC automatically; ZEC comes only from contest prizes.
-- Also: an encrypted backup of sealed moves, so a move sealed on one device can be revealed on another.
-- Applied with `npx supabase db push --remote`.

-- ---------- Points are score only ----------
alter table public.rewards drop constraint if exists rewards_points_check;
alter table public.rewards add constraint rewards_points_check check (points > 0 or (verified and points = 0 and zec > 0));

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
            total, 0, now(), true, s.round)
    on conflict do nothing;
  end if;
  return jsonb_build_object('status', 'scored', 'points', total, 'exact', exact, 'result', result_ok,
                            'final', f.home_goals || '-' || f.away_goals, 'id', 'v_' || s.id);
end $$;

-- ---------- Encrypted move backup ----------
-- Each device encrypts a seal's move and salt with a key derived from the player's passphrase
-- (PBKDF2 + AES-GCM in the browser). The server stores only ciphertext and cannot read it.
create table if not exists public.vault_meta (
  user_id uuid primary key references auth.users on delete cascade,
  salt text not null,            -- PBKDF2 salt (not secret)
  check_iv text not null,        -- encrypts a known phrase, to tell a wrong passphrase apart
  check_data text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.seal_vault (
  user_id uuid not null references auth.users on delete cascade,
  seal_id text not null,
  iv text not null,
  data text not null check (char_length(data) <= 8000),
  created_at timestamptz not null default now(),
  primary key (user_id, seal_id)
);
alter table public.vault_meta enable row level security;
alter table public.seal_vault enable row level security;
drop policy if exists "own vault meta" on public.vault_meta;
create policy "own vault meta" on public.vault_meta for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own sealed moves" on public.seal_vault;
create policy "own sealed moves" on public.seal_vault for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
