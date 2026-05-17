-- Trigger-Funktionen für automatische Logik:
-- 1. handle_new_user           -> legt Profil bei auth.users INSERT an
-- 2. prevent_admin_change      -> blockt is_admin-Änderungen durch Non-Admins
-- 3. check_vote_budget         -> Stimmen-Budget pro (user, cycle) erzwingen
-- 4. set_cycle_defaults        -> winners_count aus Playlist-Defaults füllen
-- 5. prevent_master_cycles     -> Master-Playlist darf keine Cycles haben

-- ============================================================================
-- 1. handle_new_user
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    exists (select 1 from public.admin_bootstrap_emails where email = new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. prevent_unauthorized_admin_change
-- ============================================================================
create or replace function public.prevent_unauthorized_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if not public.is_admin() then
      raise exception 'Nur Admins können is_admin ändern';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_admin_escalation
  before update on public.profiles
  for each row execute function public.prevent_unauthorized_admin_change();

-- ============================================================================
-- 3. check_vote_budget
--    Race-Window besteht (kein Lock), für Laufclub-Größe akzeptabel.
-- ============================================================================
create or replace function public.check_vote_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_budget integer;
  v_count integer;
begin
  select sn.cycle_id, p.vote_budget_per_cycle
    into v_cycle_id, v_budget
  from public.song_nominations sn
  join public.cycles c on c.id = sn.cycle_id
  join public.playlists p on p.id = c.playlist_id
  where sn.id = new.nomination_id;

  select count(*)
    into v_count
  from public.votes v
  join public.song_nominations sn on sn.id = v.nomination_id
  where sn.cycle_id = v_cycle_id and v.user_id = new.user_id;

  if v_count >= v_budget then
    raise exception 'Stimmen-Budget für diesen Cycle erschöpft (max % Stimmen)', v_budget;
  end if;

  return new;
end;
$$;

create trigger votes_budget_check
  before insert on public.votes
  for each row execute function public.check_vote_budget();

-- ============================================================================
-- 4. set_cycle_defaults
--    Füllt winners_count aus playlists.default_winners_count
--    (oder initial_winners_count bei is_initial), falls beim Insert nicht gesetzt.
-- ============================================================================
create or replace function public.set_cycle_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default integer;
  v_initial integer;
begin
  if new.winners_count is null then
    select default_winners_count, initial_winners_count
      into v_default, v_initial
    from public.playlists
    where id = new.playlist_id;

    new.winners_count := case
      when new.is_initial then v_initial
      else v_default
    end;
  end if;
  return new;
end;
$$;

create trigger cycles_set_defaults
  before insert on public.cycles
  for each row execute function public.set_cycle_defaults();

-- ============================================================================
-- 5. prevent_master_cycles
--    Master-Playlist hat keinen Wettbewerb — Cycles werden hier blockiert.
-- ============================================================================
create or replace function public.prevent_master_cycles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.playlists
    where id = new.playlist_id and is_master
  ) then
    raise exception 'Master-Playlists haben keine Cycles';
  end if;
  return new;
end;
$$;

create trigger cycles_prevent_master
  before insert on public.cycles
  for each row execute function public.prevent_master_cycles();
