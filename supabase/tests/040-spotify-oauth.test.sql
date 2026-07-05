-- pgTAP: Schritt 7 (Spotify-Owner-OAuth) aus 20260705182305_spotify_owner_oauth.sql.
-- Geprüft werden: RLS/Sichtbarkeit der Singleton-Tabelle spotify_connection
-- (nur Admins lesen, niemand außer service_role schreibt), das Singleton-
-- Constraint und der Vault-Roundtrip der Token-RPCs als service_role.
-- Eine Transaktion, am Ende Rollback (räumt auch das Vault-Secret weg).

set search_path = extensions, tests, public;

begin;

-- ── Seed (als postgres) ──
select tests.create_supabase_user('alice');
select tests.create_supabase_user('boss', 'je.stefanou@gmail.com'); -- Admin

insert into public.spotify_connection
  (id, status, spotify_user_id, spotify_display_name, connected_by)
values
  (true, 'connected', 'club-owner', 'Schlauchschal Running', tests.get_supabase_uid('boss'));

select plan(15);

-- ── Meta ──
select is(
  (select relrowsecurity from pg_class where oid = 'public.spotify_connection'::regclass),
  true,
  'RLS ist auf public.spotify_connection aktiv'
);

-- ── Singleton: es kann nur eine Row geben ──
select throws_ok(
  $$ insert into public.spotify_connection (id, status, spotify_user_id)
     values (true, 'connected', 'zweite-row') $$,
  '23505',
  NULL,
  'spotify_connection: zweite Row mit id=true kollidiert mit dem Primary Key'
);
select throws_ok(
  $$ insert into public.spotify_connection (id, status, spotify_user_id)
     values (false, 'connected', 'dritte-row') $$,
  '23514',
  NULL,
  'spotify_connection: id=false scheitert am Singleton-Check'
);

-- ── Nicht-Admin: sieht nichts, darf nichts schreiben ──
select tests.authenticate_as('alice');

select is(
  (select count(*)::int from public.spotify_connection),
  0,
  'spotify_connection_select_admin: Nicht-Admin sieht keine Row'
);
select throws_ok(
  $$ insert into public.spotify_connection (id, status, spotify_user_id)
     values (true, 'connected', 'boese') $$,
  '42501',
  NULL,
  'spotify_connection: INSERT für authenticated gesperrt (Grant entzogen)'
);
select throws_ok(
  $$ update public.spotify_connection set status = 'broken' $$,
  '42501',
  NULL,
  'spotify_connection: UPDATE für authenticated gesperrt (Grant entzogen)'
);

-- ── Admin: liest die Row, schreiben darf auch er nicht ──
select tests.authenticate_as('boss');

select is(
  (select spotify_user_id from public.spotify_connection),
  'club-owner',
  'spotify_connection_select_admin: Admin liest die Verbindungs-Row'
);
select throws_ok(
  $$ delete from public.spotify_connection $$,
  '42501',
  NULL,
  'spotify_connection: DELETE auch für Admins gesperrt (nur service_role schreibt)'
);

-- ── Token-RPCs: EXECUTE-Rechte ──
-- ACHTUNG: die RPCs als authenticated/anon NICHT aufrufen — der Permission-
-- Denied-Pfad segfaultet im lokalen Stack (supautils < 3.2.2, siehe
-- docs/reports/2026-06-01_segfault-user-id-by-email.md). Garantie deshalb
-- ohne Aufruf via has_function_privilege prüfen.
select is(
  has_function_privilege('authenticated', 'public.set_spotify_refresh_token(text)', 'execute'),
  false,
  'set_spotify_refresh_token: EXECUTE für authenticated entzogen'
);
select is(
  has_function_privilege('anon', 'public.get_spotify_refresh_token()', 'execute'),
  false,
  'get_spotify_refresh_token: EXECUTE für anon entzogen'
);
select is(
  has_function_privilege('service_role', 'public.set_spotify_refresh_token(text)', 'execute')
    and has_function_privilege('service_role', 'public.get_spotify_refresh_token()', 'execute'),
  true,
  'Token-RPCs: EXECUTE für service_role vorhanden'
);

-- ── Vault-Roundtrip als service_role ──
select tests.clear_authentication();
reset role;
set local role service_role;

select lives_ok(
  $$ select public.set_spotify_refresh_token('pgtap-token-1') $$,
  'set_spotify_refresh_token: Erstanlage läuft'
);
select is(
  (select public.get_spotify_refresh_token()),
  'pgtap-token-1',
  'get_spotify_refresh_token: liefert den gespeicherten Token'
);
-- Zweites Set überschreibt das bestehende Vault-Secret (Update, kein Duplikat).
select lives_ok(
  $$ select public.set_spotify_refresh_token('pgtap-token-2') $$,
  'set_spotify_refresh_token: Überschreiben läuft'
);
select is(
  (select public.get_spotify_refresh_token()),
  'pgtap-token-2',
  'get_spotify_refresh_token: liefert nach Überschreiben den neuen Token'
);

reset role;
select * from finish();

rollback;
