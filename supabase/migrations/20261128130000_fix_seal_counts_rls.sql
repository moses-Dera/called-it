-- The seal_counts_inc trigger runs as the calling user, but seal_counts only has a SELECT policy.
-- Fix: make the trigger function SECURITY DEFINER so it can maintain the counter regardless of caller.

create or replace function public.seal_counts_inc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.game = 'classic' then
    insert into public.seal_counts (fixture_id, seal_count)
    values (new.round, 1)
    on conflict (fixture_id)
    do update set seal_count = public.seal_counts.seal_count + 1;
  end if;
  return new;
end $$;
