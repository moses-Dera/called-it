-- Fixes from review.
-- 1. Only tips sealed after a record went public count. Before that, seals could still be deleted,
--    so losers could be removed before going public. (Settlement in lib/tipsters.ts applies the same rule.)
-- 2. The delete guard no longer blocks deleting a whole account: cascades from auth.users run inside
--    another trigger, while a player deleting a seal runs at trigger depth 1.

create or replace function public.seals_no_delete_for_tipsters() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() = 1 and old.game in ('classic', 'tip')
     and exists (select 1 from public.profiles where id = old.user_id and public_since is not null) then
    raise exception 'tips on a public record cannot be deleted';
  end if;
  return old;
end $$;

-- Everything a public profile page shows. Returns null for unknown or private handles.
create or replace function public.tipster_profile(p_handle text)
returns jsonb language sql stable security definer set search_path = public as $$
  with p as (
    select id, handle, coalesce(nullif(name, ''), handle) as name, avatar, bio, public_since
    from public.profiles where handle = lower(p_handle) and public_record
  ),
  r as (
    select t.*, f.home, f.away, f.kickoff, f.home_goals, f.away_goals, s.commitment, s.root, s.height
    from public.tip_results t
    join p on p.id = t.user_id
    join public.fixtures f on f.id = t.fixture_id
    left join public.seals s on s.user_id = t.user_id and s.id = t.seal_id
  ),
  pending as (
    -- Sealed before kickoff, not settled yet: show that a tip exists, never what it is.
    select distinct on (s.round) s.round, s.received_at, f.home, f.away, f.kickoff
    from public.seals s
    join p on p.id = s.user_id
    join public.fixtures f on f.id = s.round
    where s.game in ('classic', 'tip') and s.received_at >= p.public_since and s.received_at < f.kickoff and f.home_goals is null
      and not exists (select 1 from public.tip_results t where t.user_id = s.user_id and t.fixture_id = s.round)
    order by s.round, s.received_at
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'handle', (select handle from p),
    'name', (select name from p),
    'avatar', (select avatar from p),
    'bio', (select bio from p),
    'public_since', (select public_since from p),
    'followers', (select count(*) from public.follows fo join p on p.id = fo.tipster),
    'following', exists (select 1 from public.follows fo join p on p.id = fo.tipster where fo.follower = auth.uid()),
    'is_me', exists (select 1 from p where p.id = auth.uid()),
    'settled', (select count(*) from r),
    'won', (select count(*) from r where outcome = 'won'),
    'exact', (select count(*) from r where exact),
    'form', coalesce((select jsonb_agg(outcome order by kickoff) from (select outcome, kickoff from r order by kickoff desc limit 10) x), '[]'::jsonb),
    'tips', coalesce((select jsonb_agg(jsonb_build_object(
        'fixture_id', fixture_id, 'home', home, 'away', away, 'kickoff', kickoff,
        'home_goals', home_goals, 'away_goals', away_goals, 'pick', pick, 'outcome', outcome,
        'exact', exact, 'reason', reason, 'received_at', received_at,
        'commitment', commitment, 'root', root, 'height', height) order by kickoff desc)
      from (select * from r order by kickoff desc limit 50) y), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'home', home, 'away', away, 'kickoff', kickoff, 'received_at', received_at) order by kickoff)
      from pending), '[]'::jsonb)
  ) end
$$;
grant execute on function public.tipster_profile(text) to anon, authenticated;
