-- Enforce game player limits and contest entry rules when accepting an invite (matching join_room).

create or replace function public.answer_invite(p_room uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.rooms; n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or not exists (select 1 from public.room_players where room_id = p_room and user_id = auth.uid() and state = 'invited') then
    raise exception 'no invite to answer';
  end if;
  if p_accept then
    if r.status <> 'lobby' then raise exception 'this game has already started'; end if;
    if r.contest_id is not null and not exists (select 1 from public.contest_entries where contest_id = r.contest_id and user_id = auth.uid()) then
      raise exception 'this game is part of a contest: join the contest first';
    end if;
    select count(*) into n from public.room_players where room_id = p_room and state = 'joined';
    if n >= (case r.game when 'arcade' then 2 when 'fog' then 2 when 'bluff' then 6 else 8 end) then
      raise exception 'this game is full';
    end if;
    update public.room_players set state = 'joined', joined_at = now() where room_id = p_room and user_id = auth.uid();
  else
    delete from public.room_players where room_id = p_room and user_id = auth.uid();
  end if;
  perform public.touch_room(p_room);
end $$;
