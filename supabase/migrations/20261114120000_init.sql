-- Called It: cloud account tables. Applied with `npx supabase db push --remote`.
-- Each signed-in player can read and write only their own rows.
-- A seal row holds the commitment (hash) and its proof. The move and salt are never stored here.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '' check (char_length(name) <= 24),
  avatar int not null default 1 check (avatar between 1 and 8),
  address text not null default '',
  player text not null default '',
  withdrawn numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.seals (
  user_id uuid not null references auth.users on delete cascade,
  id text not null,
  game text not null,
  round text not null,
  label text not null,
  commitment text not null check (commitment ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz not null,
  status text not null default 'sealed' check (status in ('sealed', 'onchain')),
  root text, proof jsonb, txid text, height int,
  mode text check (mode in ('testnet', 'simulated')),
  revealed boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.rewards (
  user_id uuid not null references auth.users on delete cascade,
  id text not null,
  label text not null,
  points int not null check (points > 0),
  zec numeric not null,
  at timestamptz not null,
  primary key (user_id, id)
);

alter table public.profiles enable row level security;
alter table public.seals enable row level security;
alter table public.rewards enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "own seals" on public.seals;
create policy "own seals" on public.seals for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own rewards" on public.rewards;
create policy "own rewards" on public.rewards for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
