-- DB-Lint-Findings beheben (Performance + Security).
--
-- 1. RLS-Initplan: auth.uid() in Subquery wrappen → einmalige Init-Plan-
--    Evaluation pro Statement statt pro Row.
-- 2. Multiple permissive policies: FOR ALL admin-Policies in
--    INSERT/UPDATE/DELETE aufsplitten. SELECT wird vom *_select_authenticated
--    bereits abgedeckt, doppelte Policy-Evaluation entfällt.
-- 3. SECURITY DEFINER Trigger-Funktionen: REVOKE EXECUTE von anon &
--    authenticated. Trigger feuern unabhängig von EXECUTE-Grants; der
--    /rest/v1/rpc-Aufruf bleibt damit zu. is_admin() bleibt für authenticated
--    ausführbar — wird von RLS-Policies aufgerufen.
-- 4. GraphQL/PostgREST-Sichtbarkeit: anon kommt an keine public-Tabelle ran;
--    admin_bootstrap_emails + invite_codes auch für authenticated unsichtbar
--    (Zugriff läuft eh über Service-Role-Client).

-- ============================================================================
-- 1. & 2. RLS-Policies neu aufsetzen
-- ============================================================================

-- profiles: update_own + admin_all zusammenführen, init-plan wrap
drop policy "profiles_update_own" on public.profiles;
drop policy "profiles_admin_all" on public.profiles;

create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id or public.is_admin())
  with check ((select auth.uid()) = id or public.is_admin());

create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy "profiles_delete_admin"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- songs: init-plan wrap
drop policy "songs_insert_authenticated" on public.songs;
create policy "songs_insert_authenticated"
  on public.songs for insert
  to authenticated
  with check ((select auth.uid()) is not null);

-- song_nominations: init-plan wraps
drop policy "nominations_insert_self" on public.song_nominations;
create policy "nominations_insert_self"
  on public.song_nominations for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and exists (
      select 1 from public.cycles c
      where c.id = cycle_id and c.status = 'open'
    )
  );

drop policy "nominations_delete_self_or_admin" on public.song_nominations;
create policy "nominations_delete_self_or_admin"
  on public.song_nominations for delete
  to authenticated
  using (submitted_by = (select auth.uid()) or public.is_admin());

-- votes: init-plan wraps
drop policy "votes_insert_self" on public.votes;
create policy "votes_insert_self"
  on public.votes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.song_nominations sn
      join public.cycles c on c.id = sn.cycle_id
      where sn.id = nomination_id and c.status = 'open'
    )
  );

drop policy "votes_delete_self" on public.votes;
create policy "votes_delete_self"
  on public.votes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- playlists: admin_all aufsplitten (SELECT bleibt _select_authenticated)
drop policy "playlists_admin_all" on public.playlists;

create policy "playlists_insert_admin"
  on public.playlists for insert
  to authenticated
  with check (public.is_admin());

create policy "playlists_update_admin"
  on public.playlists for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "playlists_delete_admin"
  on public.playlists for delete
  to authenticated
  using (public.is_admin());

-- cycles
drop policy "cycles_admin_all" on public.cycles;

create policy "cycles_insert_admin"
  on public.cycles for insert
  to authenticated
  with check (public.is_admin());

create policy "cycles_update_admin"
  on public.cycles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "cycles_delete_admin"
  on public.cycles for delete
  to authenticated
  using (public.is_admin());

-- cycle_winners
drop policy "winners_admin_all" on public.cycle_winners;

create policy "winners_insert_admin"
  on public.cycle_winners for insert
  to authenticated
  with check (public.is_admin());

create policy "winners_update_admin"
  on public.cycle_winners for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "winners_delete_admin"
  on public.cycle_winners for delete
  to authenticated
  using (public.is_admin());

-- ============================================================================
-- 3. SECURITY DEFINER Funktionen: REVOKE EXECUTE für Trigger-only
-- ============================================================================

revoke execute on function public.check_vote_budget() from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.prevent_master_cycles() from anon, authenticated;
revoke execute on function public.prevent_unauthorized_admin_change() from anon, authenticated;
revoke execute on function public.set_cycle_defaults() from anon, authenticated;

revoke execute on function public.is_admin() from anon;

-- ============================================================================
-- 4. GraphQL/PostgREST-Sichtbarkeit härten
-- ============================================================================

revoke all on public.admin_bootstrap_emails from anon, authenticated;
revoke all on public.invite_codes from anon, authenticated;

revoke select on public.profiles from anon;
revoke select on public.playlists from anon;
revoke select on public.cycles from anon;
revoke select on public.songs from anon;
revoke select on public.song_nominations from anon;
revoke select on public.votes from anon;
revoke select on public.cycle_winners from anon;
