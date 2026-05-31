-- pgTAP: RLS-Policies aus 20260517171502_policies.sql + 20260517223927_db_lints…sql.
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

insert into public.cycles (id, playlist_id, cycle_number, starts_at, ends_at, winners_count, status) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1, now(), now() + interval '7 days', 3, 'open'),
  ('22222222-2222-2222-2222-222222222233', '11111111-1111-1111-1111-111111111111', 2, now() - interval '14 days', now() - interval '7 days', 3, 'closed');

insert into public.songs (id, spotify_track_id, title, artist) values
  ('33333333-3333-3333-3333-333333333331', 'spDel', 'Del', 'A'),
  ('33333333-3333-3333-3333-333333333332', 'spOpen', 'Open', 'A'),
  ('33333333-3333-3333-3333-333333333333', 'spClosed', 'Closed', 'A'),
  ('33333333-3333-3333-3333-333333333334', 'spNomC', 'NomC', 'A');

-- Nominierung im geschlossenen Cycle (für den Vote-Test), von bob eingereicht.
insert into public.song_nominations (id, cycle_id, song_id, submitted_by)
values ('44444444-4444-4444-4444-444444444441', '22222222-2222-2222-2222-222222222233',
        '33333333-3333-3333-3333-333333333334', current_setting('test.bob_id')::uuid);

select plan(14);

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
  $$ insert into public.songs (spotify_track_id, title, artist) values ('spNew', 'Neu', 'B') $$,
  'songs_insert_authenticated: authentifizierter User darf Songs anlegen'
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
