-- Fixes found in the 26 Nov audit.

-- 1. Seal sync. 20261114120000_init.sql was edited after it had been applied, to allow mode 'bitcoin';
--    production never got that change, so every Bitcoin-timestamped seal was rejected on sync.
alter table public.seals drop constraint if exists seals_mode_check;
alter table public.seals add constraint seals_mode_check check (mode in ('bitcoin', 'simulated', 'testnet'));

-- 2. Admin overview. Two versions existed (no arguments, and paginated with defaults), so a call with no
--    arguments was ambiguous and the admin Overview failed to load. Keep the paginated one.
drop function if exists public.admin_overview();

-- 3. A contest closes only when every one of its matches has a final result. Closing early ranked nobody
--    and hid the sponsor's funding panel. Cron auto-settle already waits; this also guards the admin button.
create or replace function public.contests_close_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'open' and new.status = 'closed'
     and exists (select 1 from unnest(new.fixture_ids) fid
                 left join public.fixtures f on f.id = fid
                 where f.id is null or f.home_goals is null) then
    raise exception 'this contest still has matches without a final result; it closes after the last one';
  end if;
  return new;
end $$;
drop trigger if exists contests_close_guard on public.contests;
create trigger contests_close_guard before update on public.contests
  for each row execute function public.contests_close_guard();

-- 4. Reopen a contest that closed with no winners (nothing was credited, so nothing needs undoing).
create or replace function public.admin_reopen_contest(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c public.contests;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into c from public.contests where id = p_id for update;
  if not found then raise exception 'unknown contest'; end if;
  if c.status <> 'closed' then raise exception 'this contest is already open'; end if;
  if coalesce(jsonb_array_length(c.winners), 0) > 0 then
    raise exception 'this contest has winners, so it cannot be reopened';
  end if;
  update public.contests set status = 'open', winners = null where id = p_id;
  return true;
end $$;
revoke all on function public.admin_reopen_contest(text) from public, anon;
grant execute on function public.admin_reopen_contest(text) to authenticated;
