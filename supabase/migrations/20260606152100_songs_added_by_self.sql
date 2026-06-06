-- songs.added_by an den aufrufenden User binden — Konsistenz zu
-- nominations_insert_self und votes_insert_self. Bisher prüfte
-- songs_insert_authenticated nur `(select auth.uid()) is not null`, sodass ein
-- authentifizierter Client per direktem PostgREST-Insert ein beliebiges added_by
-- setzen konnte (Attributions-/Integritätslücke, vom Code-Assessment gefunden).
drop policy "songs_insert_authenticated" on public.songs;
create policy "songs_insert_authenticated"
  on public.songs for insert
  to authenticated
  with check (added_by = (select auth.uid()));
