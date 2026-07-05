-- pgTAP: RLS-Policies aus 20260517171502_policies.sql + 20260517223927_db_lints…sql
-- + Phasen-Policies aus 20260705154130_voting_phases.sql.
-- RLS greift NUR für die Rolle authenticated/anon (Superuser umgeht sie), darum hier
-- echter Rollenwechsel via tests.authenticate_as / clear_authentication.
-- Geseedet wird vorher als postgres (Superuser, RLS-bypass). IDs der Auth-User
-- liegen in Session-GUCs (test.*), weil ein authentifizierter User auth.users nicht
-- lesen darf. Feste UUIDs für Playlist/Cycle/Song/Nomination kontrollieren wir selbst.
-- Eine Transaktion, am Ende Rollback.

set search_path = extensions, tests, public;

begin;

-- ── Seed (als postgres) ──
select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('boss', 'je.stefanou@gmail.com'); -- Admin

select set_config('test.bob_id', tests.get_supabase_uid('bob')::text, true);

insert into public.playlists (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Playlist');

-- Cycle 1 (offen, kein voting_starts_at gesetzt): Trigger füllt starts_at + 4 Tage
-- -> Nominierungsphase. Cycle 2: geschlossen. Cycle 3: offen, Abstimmungsphase
-- (voting_starts_at gestern).
insert into public.cycles (id, playlist_id, cycle_number, starts_at, voting_starts_at, ends_at, winners_count, status) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1, now(), null, now() + interval '7 days', 3, 'open'),
  ('22222222-2222-2222-2222-222222222233', '11111111-1111-1111-1111-111111111111', 2, now() - interval '14 days', null, now() - interval '7 days', 3, 'closed'),
  ('22222222-2222-2222-2222-222222222244', '11111111-1111-1111-1111-111111111111', 3, now() - interval '5 days', now() - interval '1 day', now() + interval '2 days', 3, 'open');

insert into public.songs (id, spotify_track_id, title, artist) values
  ('33333333-3333-3333-3333-333333333331', 'spDel', 'Del', 'A'),
  ('33333333-3333-3333-3333-333333333332', 'spOpen', 'Open', 'A'),
  ('33333333-3333-3333-3333-333333333333', 'spClosed', 'Closed', 'A'),
  ('33333333-3333-3333-3333-333333333334', 'spNomC', 'NomC', 'A'),
  ('33333333-3333-3333-3333-333333333335', 'spVote', 'Vote', 'A'),
  ('33333333-3333-3333-3333-333333333336', 'spNomPhase', 'NomPhase', 'A'),
  ('33333333-3333-3333-3333-333333333337', 'spMineVoting', 'MineVoting', 'A');

insert into public.song_nominations (id, cycle_id, song_id, submitted_by) values
  -- im geschlossenen Cycle (für den Vote-Blocktest), von bob
  ('44444444-4444-4444-4444-444444444441', '22222222-2222-2222-2222-222222222233',
   '33333333-3333-3333-3333-333333333334', current_setting('test.bob_id')::uuid),
  -- im Abstimmungs-Cycle, von bob (alice stimmt dafür)
  ('44444444-4444-4444-4444-444444444442', '22222222-2222-2222-2222-222222222244',
   '33333333-3333-3333-3333-333333333335', current_setting('test.bob_id')::uuid),
  -- im Nominierungs-Cycle, von bob (Stimme dort muss blocken)
  ('44444444-4444-4444-4444-444444444443', '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333336', current_setting('test.bob_id')::uuid),
  -- im Abstimmungs-Cycle, von ALICE (Zurücknehmen muss blocken)
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222244',
   '33333333-3333-3333-3333-333333333337', tests.get_supabase_uid('alice')),
  -- zweite im geschlossenen Cycle (für den Vote-Delete-Härtungstest)
  ('44444444-4444-4444-4444-444444444445', '22222222-2222-2222-2222-222222222233',
   '33333333-3333-3333-3333-333333333333', current_setting('test.bob_id')::uuid);

-- Alice-Stimme im geschlossenen Cycle (als postgres, RLS-bypass): darf sie als
-- authenticated NICHT mehr zurückziehen (Härtung votes_delete_self).
insert into public.votes (nomination_id, user_id)
values ('44444444-4444-4444-4444-444444444445', tests.get_supabase_uid('alice'));

select plan(22);

-- ── Meta ──
select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'RLS ist auf public.profiles aktiv'
);

-- ── profiles ──
select tests.authenticate_as('alice');

select is(
  (select count(*)::int from public.profiles),
  3,
  'profiles_select_authenticated: authentifizierter User sieht alle Profile'
);

-- Update ohne WHERE: RLS using() lässt nur die eigene Zeile durch.
select lives_ok(
  $$ update public.profiles set display_name = 'HACK' $$,
  'profiles_update_self_or_admin: Update läuft (auf erlaubte Zeilen)'
);
select is(
  (select count(*)::int from public.profiles where display_name = 'HACK'),
  1,
  'profiles_update_self_or_admin: nur die eigene Zeile wurde geändert'
);

-- ── songs ──
select lives_ok(
  $$ insert into public.songs (spotify_track_id, title, artist, added_by)
     values ('spNew', 'Neu', 'B', (select auth.uid())) $$,
  'songs_insert_authenticated: Song mit eigenem added_by ist erlaubt'
);
select throws_ok(
  $$ insert into public.songs (spotify_track_id, title, artist, added_by)
     values ('spForeign', 'Fremd', 'B', current_setting('test.bob_id')::uuid) $$,
  '42501',
  NULL,
  'songs_insert_authenticated: Song mit fremdem added_by wird blockiert'
);

delete from public.songs where id = '33333333-3333-3333-3333-333333333331';
select is(
  (select count(*)::int from public.songs where id = '33333333-3333-3333-3333-333333333331'),
  1,
  'songs_delete_admin: Nicht-Admin kann Songs nicht löschen (0 Zeilen betroffen)'
);

-- ── song_nominations ──
select lives_ok(
  $$ insert into public.song_nominations (cycle_id, song_id, submitted_by)
     values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333332', (select auth.uid())) $$,
  'nominations_insert_self: eigene Nominierung in offenem Cycle ist erlaubt'
);
select throws_ok(
  $$ insert into public.song_nominations (cycle_id, song_id, submitted_by)
     values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333334', current_setting('test.bob_id')::uuid) $$,
  '42501',
  NULL,
  'nominations_insert_self: Nominierung für fremden User wird blockiert'
);
select throws_ok(
  $$ insert into public.song_nominations (cycle_id, song_id, submitted_by)
     values ('22222222-2222-2222-2222-222222222233', '33333333-3333-3333-3333-333333333333', (select auth.uid())) $$,
  '42501',
  NULL,
  'nominations_insert_self: Nominierung in geschlossenem Cycle wird blockiert'
);

-- ── votes ──
select throws_ok(
  $$ insert into public.votes (nomination_id, user_id)
     values ('44444444-4444-4444-4444-444444444441', (select auth.uid())) $$,
  '42501',
  NULL,
  'votes_insert_self: Stimme in geschlossenem Cycle wird blockiert'
);

-- ── Phasen (20260705154130_voting_phases): nominieren nur davor, abstimmen nur danach ──
select throws_ok(
  $$ insert into public.song_nominations (cycle_id, song_id, submitted_by)
     values ('22222222-2222-2222-2222-222222222244', '33333333-3333-3333-3333-333333333332', (select auth.uid())) $$,
  '42501',
  NULL,
  'nominations_insert_self: Nominierung in der Abstimmungsphase wird blockiert'
);

select lives_ok(
  $$ insert into public.votes (nomination_id, user_id)
     values ('44444444-4444-4444-4444-444444444442', (select auth.uid())) $$,
  'votes_insert_self: Stimme in der Abstimmungsphase ist erlaubt'
);

select throws_ok(
  $$ insert into public.votes (nomination_id, user_id)
     values ('44444444-4444-4444-4444-444444444443', (select auth.uid())) $$,
  '42501',
  NULL,
  'votes_insert_self: Stimme in der Nominierungsphase wird blockiert'
);

delete from public.votes where nomination_id = '44444444-4444-4444-4444-444444444442';
select is(
  (select count(*)::int from public.votes where nomination_id = '44444444-4444-4444-4444-444444444442'),
  0,
  'votes_delete_self: eigene Stimme in der Abstimmungsphase ist zurückziehbar'
);

delete from public.votes where nomination_id = '44444444-4444-4444-4444-444444444445';
select is(
  (select count(*)::int from public.votes where nomination_id = '44444444-4444-4444-4444-444444444445'),
  1,
  'votes_delete_self: Stimme in geschlossenem Cycle bleibt stehen (Härtung)'
);

delete from public.song_nominations where id = '44444444-4444-4444-4444-444444444444';
select is(
  (select count(*)::int from public.song_nominations where id = '44444444-4444-4444-4444-444444444444'),
  1,
  'nominations_delete_self_or_admin: eigene Nominierung in der Abstimmungsphase bleibt stehen'
);

delete from public.song_nominations
where cycle_id = '22222222-2222-2222-2222-222222222222'
  and song_id = '33333333-3333-3333-3333-333333333332';
select is(
  (select count(*)::int from public.song_nominations
   where cycle_id = '22222222-2222-2222-2222-222222222222'
     and song_id = '33333333-3333-3333-3333-333333333332'),
  0,
  'nominations_delete_self_or_admin: eigene Nominierung in der Nominierungsphase ist zurücknehmbar'
);

-- ── admin-only Tabellen / RPC für authenticated dicht ──
select throws_ok(
  $$ select count(*) from public.invite_codes $$,
  '42501',
  NULL,
  'invite_codes: für authenticated komplett gesperrt (Grants entzogen)'
);
-- ACHTUNG: user_id_by_email hier NICHT aufrufen. Als Rolle authenticated (ohne
-- EXECUTE) segfaultet der Backend-Prozess auf dem Permission-Denied-Pfad (lokaler
-- Stack, signal 11, instanzweiter Crash). Wir prüfen die Sicherheits-Garantie
-- (EXECUTE entzogen) deshalb ohne Aufruf. Siehe Branch-Report / offener Fund.
select is(
  has_function_privilege('authenticated', 'public.user_id_by_email(text)', 'execute'),
  false,
  'user_id_by_email: EXECUTE für authenticated entzogen'
);

-- ── songs_delete_admin: Admin darf löschen ──
select tests.authenticate_as('boss');
delete from public.songs where id = '33333333-3333-3333-3333-333333333331';
select is(
  (select count(*)::int from public.songs where id = '33333333-3333-3333-3333-333333333331'),
  0,
  'songs_delete_admin: Admin kann Songs löschen'
);

-- ── anon sieht keine Profile (SELECT-Grant entzogen) ──
select tests.clear_authentication();
select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  NULL,
  'anon kann profiles nicht lesen (SELECT-Grant entzogen)'
);

reset role;
select * from finish();

rollback;
