create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_participant_id uuid,
  status text not null default 'lobby',
  settings jsonb not null default '{"aiCount":2,"roundCount":3,"roundSeconds":60,"charLimit":160}'::jsonb,
  game_number integer not null default 0,
  next_game_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  display_name text not null,
  is_host boolean not null default false,
  total_points integer not null default 0,
  wins integer not null default 0,
  last_points integer not null default 0,
  left_at timestamptz,
  created_at timestamptz not null default now()
);

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

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_number integer not null,
  status text not null default 'playing',
  round_number integer not null default 1,
  round_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.seats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  kind text not null,
  mimic_participant_id uuid references public.participants(id) on delete set null,
  alias text not null,
  icon text not null,
  color text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  round_number integer not null,
  from_seat_id uuid not null references public.seats(id) on delete cascade,
  to_seat_id uuid references public.seats(id) on delete cascade,
  channel text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guesses (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  guesses jsonb not null,
  points integer,
  created_at timestamptz not null default now(),
  unique(game_id, participant_id)
);

create table if not exists public.player_memories (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  body text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_memories_message_id_key'
  ) then
    alter table public.player_memories
      add constraint player_memories_message_id_key unique (message_id);
  end if;
end;
$$;

create table if not exists public.ai_observability (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  seat_id uuid references public.seats(id) on delete cascade,
  provider text not null,
  model text not null,
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_training_examples (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  seat_id uuid references public.seats(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  mimic_participant_id uuid references public.participants(id) on delete set null,
  trigger_message_id uuid references public.messages(id) on delete set null,
  provider text not null,
  model text not null,
  channel text not null,
  prompt text not null,
  raw_response text not null,
  final_message text not null,
  intent text,
  risk_flags text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.match_player_memories(
  query_embedding vector(1536),
  target_participant_id uuid,
  match_count int default 8
)
returns table (
  id uuid,
  body text,
  similarity float
)
language sql
stable
as $$
  select
    player_memories.id,
    player_memories.body,
    1 - (player_memories.embedding <=> query_embedding) as similarity
  from public.player_memories
  where player_memories.participant_id = target_participant_id
    and player_memories.embedding is not null
  order by player_memories.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.games enable row level security;
alter table public.seats enable row level security;
alter table public.messages enable row level security;
alter table public.guesses enable row level security;
alter table public.player_memories enable row level security;
alter table public.ai_observability enable row level security;
alter table public.ai_training_examples enable row level security;

drop policy if exists "prototype rooms all" on public.rooms;
drop policy if exists "prototype participants all" on public.participants;
drop policy if exists "prototype games all" on public.games;
drop policy if exists "prototype seats all" on public.seats;
drop policy if exists "prototype messages all" on public.messages;
drop policy if exists "prototype guesses all" on public.guesses;
drop policy if exists "prototype player memories all" on public.player_memories;
drop policy if exists "prototype ai observability all" on public.ai_observability;
drop policy if exists "prototype ai training examples all" on public.ai_training_examples;

create policy "prototype rooms all" on public.rooms for all using (true) with check (true);
create policy "prototype participants all" on public.participants for all using (true) with check (true);
create policy "prototype games all" on public.games for all using (true) with check (true);
create policy "prototype seats all" on public.seats for all using (true) with check (true);
create policy "prototype messages all" on public.messages for all using (true) with check (true);
create policy "prototype guesses all" on public.guesses for all using (true) with check (true);
create policy "prototype player memories all" on public.player_memories for all using (true) with check (true);
create policy "prototype ai observability all" on public.ai_observability for all using (true) with check (true);
create policy "prototype ai training examples all" on public.ai_training_examples for all using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on function public.match_player_memories(vector, uuid, int) to anon, authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'rooms',
    'participants',
    'games',
    'seats',
    'messages',
    'guesses'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
