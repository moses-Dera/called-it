-- Werewolf: the pack is returned with player ids (names alone can repeat).
create or replace function public.my_role(p_room uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', me.role, 'seen', me.seen,
    'pack', case when me.role = 'wolf' then (select jsonb_agg(jsonb_build_object('id', user_id, 'name', public.room_name(user_id)))
                                             from public.room_roles where room_id = p_room and role = 'wolf' and user_id <> auth.uid()) end)
  from public.room_roles me where me.room_id = p_room and me.user_id = auth.uid()
$$;
