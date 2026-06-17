alter table public.participants add column if not exists left_at timestamptz;

create or replace function public.leave_room(leaving_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room_id uuid;
  next_host_id uuid;
begin
  select room_id
    into target_room_id
    from public.participants
    where id = leaving_participant_id;

  if target_room_id is null then
    return;
  end if;

  update public.participants
    set left_at = now(), is_host = false
    where id = leaving_participant_id;

  if not exists (
    select 1
      from public.participants
      where room_id = target_room_id
        and left_at is null
  ) then
    delete from public.rooms where id = target_room_id;
    return;
  end if;

  if not exists (
    select 1
      from public.participants
      where room_id = target_room_id
        and left_at is null
        and is_host
  ) then
    select id
      into next_host_id
      from public.participants
      where room_id = target_room_id
        and left_at is null
      order by created_at
      limit 1;

    update public.participants
      set is_host = (id = next_host_id)
      where room_id = target_room_id
        and left_at is null;

    update public.rooms
      set host_participant_id = next_host_id
      where id = target_room_id;
  end if;
end;
$$;

grant execute on function public.leave_room(uuid) to anon, authenticated;
