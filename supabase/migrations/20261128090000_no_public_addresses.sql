-- Wallet addresses never appear in public contest results.
-- Sponsor contests already stripped them on close (contests_sponsor_close). Contests created the old admin way
-- (owner_id null) still stored each winner's address in the public winners list. Strip them on every close,
-- and remove any already stored. The payout tool for those legacy contests reads the address from the winner's
-- profile at payment time instead (sponsor_payees does the same for sponsor contests).

create or replace function public.contests_strip_addresses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.winners is not null and exists (select 1 from jsonb_array_elements(new.winners) w where w ? 'address') then
    new.winners := (select coalesce(jsonb_agg(x - 'address' order by (x->>'rank')::int), '[]'::jsonb)
                    from jsonb_array_elements(new.winners) x);
  end if;
  return new;
end $$;
drop trigger if exists contests_strip_addresses on public.contests;
-- Name sorts after contests_sponsor_close, so it runs last.
create trigger contests_strip_addresses before insert or update on public.contests
  for each row execute function public.contests_strip_addresses();

update public.contests set winners = winners
where winners is not null and exists (select 1 from jsonb_array_elements(winners) w where w ? 'address');
