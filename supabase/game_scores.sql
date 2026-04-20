-- Run in Supabase: SQL Editor → New query → paste → Run
-- Stores every finished run; app shows global top 5 and player rank (1 + count of strictly higher scores).

create table if not exists public.game_scores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_name text not null,
  score integer not null,
  constraint game_scores_player_name_len check (char_length(trim(player_name)) between 1 and 24),
  constraint game_scores_score_range check (score >= 0 and score <= 2000000000)
);

create index if not exists game_scores_by_score on public.game_scores (score desc, created_at asc);

alter table public.game_scores enable row level security;

drop policy if exists "game_scores_select_public" on public.game_scores;
create policy "game_scores_select_public"
  on public.game_scores for select
  to anon, authenticated
  using (true);

drop policy if exists "game_scores_insert_public" on public.game_scores;
create policy "game_scores_insert_public"
  on public.game_scores for insert
  to anon, authenticated
  with check (
    char_length(trim(player_name)) between 1 and 24
    and score >= 0 and score <= 2000000000
  );
