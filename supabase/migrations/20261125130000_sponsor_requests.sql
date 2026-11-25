-- Sponsor requests: brands ask to sponsor a contest; admins see them in the Contests tab.
create table if not exists public.sponsor_requests (
  id          bigint generated always as identity primary key,
  brand       text not null check (char_length(brand) between 2 and 80),
  contact     text not null check (char_length(contact) between 3 and 120),
  budget_zec  numeric check (budget_zec is null or (budget_zec > 0 and budget_zec < 100000)),
  matches     text not null default '' check (char_length(matches) <= 300),
  message     text not null default '' check (char_length(message) <= 1000),
  status      text not null default 'new' check (status in ('new', 'handled')),
  user_id     uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.sponsor_requests enable row level security;
-- No policies: written through submit_sponsor_request(), read through admin functions.

create or replace function public.submit_sponsor_request(p_brand text, p_contact text, p_budget numeric, p_matches text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  -- A light brake on spam: at most 20 new requests an hour across the whole site.
  if (select count(*) from public.sponsor_requests where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many requests right now. Please try again in an hour.';
  end if;
  insert into public.sponsor_requests (brand, contact, budget_zec, matches, message, user_id)
  values (trim(p_brand), trim(p_contact), p_budget, trim(coalesce(p_matches, '')), trim(coalesce(p_message, '')), auth.uid());
  return true;
end $$;
grant execute on function public.submit_sponsor_request(text, text, numeric, text, text) to anon, authenticated;

create or replace function public.admin_sponsor_requests()
returns setof public.sponsor_requests language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query select * from public.sponsor_requests order by (status = 'new') desc, created_at desc limit 100;
end $$;
revoke all on function public.admin_sponsor_requests() from public, anon;
grant execute on function public.admin_sponsor_requests() to authenticated;

create or replace function public.admin_mark_sponsor_request(p_id bigint, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.sponsor_requests set status = p_status where id = p_id;
  return found;
end $$;
revoke all on function public.admin_mark_sponsor_request(bigint, text) from public, anon;
grant execute on function public.admin_mark_sponsor_request(bigint, text) to authenticated;
