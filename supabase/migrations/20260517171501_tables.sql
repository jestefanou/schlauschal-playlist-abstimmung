-- Initial schema for Schlauchschal Playlist-Abstimmung
-- Tabellen, Constraints, Indizes. RLS-Policies und Trigger folgen in separaten Migrations.

-- ============================================================================
-- profiles (1:1 mit auth.users)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing User-Profil, 1:1 mit auth.users';

-- ============================================================================
-- admin_bootstrap_emails: Adressen, die beim ersten Login is_admin=true bekommen
-- ============================================================================
create table public.admin_bootstrap_emails (
  email text primary key
);

comment on table public.admin_bootstrap_emails is
  'Wird vom handle_new_user-Trigger geprüft: Mails in dieser Liste bekommen beim ersten Login Admin-Rechte.';

insert into public.admin_bootstrap_emails (email) values ('je.stefanou@gmail.com');

-- ============================================================================
-- invite_codes: einmalig nutzbare Codes
-- ============================================================================
create table public.invite_codes (
  code text primary key,
  note text,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz
);

create index invite_codes_unused on public.invite_codes (code) where used_at is null;

-- ============================================================================
-- playlists
-- ============================================================================
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  spotify_playlist_id text,
  is_master boolean not null default false,
  is_active boolean not null default true,
  vote_budget_per_cycle integer not null default 3 check (vote_budget_per_cycle > 0),
  default_winners_count integer not null default 3 check (default_winners_count > 0),
  initial_winners_count integer not null default 10 check (initial_winners_count > 0),
  cycle_start_dow integer check (cycle_start_dow between 0 and 6),
  cycle_start_time time,
  timezone text not null default 'Europe/Berlin',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Partial Unique Index: genau eine Playlist mit is_master=true
create unique index playlists_one_master on public.playlists ((is_master)) where is_master = true;

-- ============================================================================
-- cycles (Wochenzyklen pro Playlist)
-- ============================================================================
create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  winners_count integer not null check (winners_count > 0),
  status text not null default 'open' check (status in ('open', 'closed', 'pushed')),
  is_initial boolean not null default false,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (playlist_id, cycle_number),
  check (ends_at > starts_at)
);

create index cycles_open_per_playlist on public.cycles (playlist_id) where status = 'open';
create index cycles_playlist_status on public.cycles (playlist_id, status);

-- ============================================================================
-- songs (globaler dedupliziert Pool über spotify_track_id)
-- ============================================================================
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text not null unique,
  title text not null,
  artist text not null,
  album text,
  duration_ms integer,
  album_art_url text,
  preview_url text,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now()
);

-- ============================================================================
-- song_nominations (Song × Cycle, viele-zu-viele)
-- ============================================================================
create table public.song_nominations (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (cycle_id, song_id)
);

create index song_nominations_cycle on public.song_nominations (cycle_id);
create index song_nominations_submitted_by on public.song_nominations (submitted_by);

-- ============================================================================
-- votes (Stimmen-Budget-Check erfolgt im Trigger in der Funktions-Migration)
-- ============================================================================
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  nomination_id uuid not null references public.song_nominations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (nomination_id, user_id)
);

create index votes_nomination on public.votes (nomination_id);
create index votes_user on public.votes (user_id);

-- ============================================================================
-- cycle_winners (Top-N pro Cycle, plus Push-Tracking)
-- ============================================================================
create table public.cycle_winners (
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  rank integer not null check (rank > 0),
  vote_count integer not null check (vote_count >= 0),
  pushed_to_playlist_at timestamptz,
  pushed_to_master_at timestamptz,
  primary key (cycle_id, song_id),
  unique (cycle_id, rank)
);
