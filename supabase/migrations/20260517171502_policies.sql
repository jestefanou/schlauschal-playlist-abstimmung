-- Row-Level-Security: alles dichtmachen, dann selektiv öffnen.
-- Konvention: SELECT ist meist offen für alle authenticated, Mutationen sind restriktiv.

alter table public.profiles enable row level security;
alter table public.admin_bootstrap_emails enable row level security;
alter table public.invite_codes enable row level security;
alter table public.playlists enable row level security;
alter table public.cycles enable row level security;
alter table public.songs enable row level security;
alter table public.song_nominations enable row level security;
alter table public.votes enable row level security;
alter table public.cycle_winners enable row level security;

-- ============================================================================
-- Helper: prüft, ob der aufrufende User Admin ist.
-- SECURITY DEFINER, damit der Check auch ohne SELECT-Recht auf profiles funktioniert
-- und nicht in RLS-Rekursion läuft.
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ============================================================================
-- profiles
-- ============================================================================
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_admin_all"
  on public.profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- admin_bootstrap_emails — Admin-only
-- ============================================================================
create policy "admin_emails_admin_all"
  on public.admin_bootstrap_emails for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- invite_codes — Admin-only (Verbrauch erfolgt via Service Role im Auth-Flow)
-- ============================================================================
create policy "invite_codes_admin_all"
  on public.invite_codes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- playlists
-- ============================================================================
create policy "playlists_select_authenticated"
  on public.playlists for select
  to authenticated
  using (true);

create policy "playlists_admin_all"
  on public.playlists for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- cycles — schreiben nur Admin / Service Role
-- ============================================================================
create policy "cycles_select_authenticated"
  on public.cycles for select
  to authenticated
  using (true);

create policy "cycles_admin_all"
  on public.cycles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- songs — jeder authentifizierte darf Songs hinzufügen
-- ============================================================================
create policy "songs_select_authenticated"
  on public.songs for select
  to authenticated
  using (true);

create policy "songs_insert_authenticated"
  on public.songs for insert
  to authenticated
  with check (auth.uid() is not null);

create policy "songs_delete_admin"
  on public.songs for delete
  to authenticated
  using (public.is_admin());

-- ============================================================================
-- song_nominations — User darf nur in eigene Nominierung in offenen Cycles
-- ============================================================================
create policy "nominations_select_authenticated"
  on public.song_nominations for select
  to authenticated
  using (true);

create policy "nominations_insert_self"
  on public.song_nominations for insert
  to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from public.cycles c
      where c.id = cycle_id and c.status = 'open'
    )
  );

create policy "nominations_delete_self_or_admin"
  on public.song_nominations for delete
  to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

-- ============================================================================
-- votes — eigene Stimme nur in offenen Cycles, Budget-Check via Trigger
-- ============================================================================
create policy "votes_select_authenticated"
  on public.votes for select
  to authenticated
  using (true);

create policy "votes_insert_self"
  on public.votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.song_nominations sn
      join public.cycles c on c.id = sn.cycle_id
      where sn.id = nomination_id and c.status = 'open'
    )
  );

create policy "votes_delete_self"
  on public.votes for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- cycle_winners — Schreiben nur Admin / Service Role
-- ============================================================================
create policy "winners_select_authenticated"
  on public.cycle_winners for select
  to authenticated
  using (true);

create policy "winners_admin_all"
  on public.cycle_winners for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
