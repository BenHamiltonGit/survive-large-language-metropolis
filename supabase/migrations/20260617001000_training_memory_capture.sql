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

alter table public.ai_training_examples enable row level security;

drop policy if exists "prototype ai training examples all" on public.ai_training_examples;
create policy "prototype ai training examples all" on public.ai_training_examples for all using (true) with check (true);
