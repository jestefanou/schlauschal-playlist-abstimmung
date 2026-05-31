-- pgTAP: Trigger-Funktionen aus 20260517171503_functions.sql.
-- Läuft als postgres (Superuser, RLS-bypass) — Trigger feuern rollenunabhängig.
-- Der is_admin-Schutz hängt an auth.uid() (= JWT-Claim 'sub'), darum wird für die
-- beiden Admin-Tests nur der Claim gesetzt, nicht die Rolle gewechselt: so bleibt
-- das pgTAP-Bookkeeping als Superuser und es gibt keine Temp-Table-Permission-Probleme.
-- Eine Transaktion, am Ende Rollback -> keine Testdaten bleiben zurück.

set search_path = extensions, tests, public;

begin;

-- Drei Test-User anlegen (feuert on_auth_user_created -> profiles).
select tests.create_supabase_user('alice');
select tests.create_supabase_user('boss', 'je.stefanou@gmail.com'); -- Bootstrap-Admin
select tests.create_supabase_user('voter');

select plan(10);

-- ── 1. handle_new_user: Profil-Auto-Anlage + display_name + Admin-Bootstrap ──
select is(
  (select display_name from public.profiles where id = tests.get_supabase_uid('alice')),
  'alice',
  'handle_new_user: display_name fällt auf E-Mail-Local-Part zurück'
);
select is(
  (select is_admin from public.profiles where id = tests.get_supabase_uid('alice')),
  false,
  'handle_new_user: normale E-Mail -> is_admin=false'
);
select is(
  (select is_admin from public.profiles where id = tests.get_supabase_uid('boss')),
  true,
  'handle_new_user: Bootstrap-E-Mail -> is_admin=true'
);

-- ── Seed für die übrigen Trigger ──
insert into public.playlists (id, name, vote_budget_per_cycle, default_winners_count, initial_winners_count)
values ('10000000-0000-0000-0000-000000000001', 'Normale Playlist', 3, 3, 10);

insert into public.playlists (id, name, is_master)
values ('10000000-0000-0000-0000-0000000000ff', 'Master', true);

insert into public.cycles (id, playlist_id, cycle_number, starts_at, ends_at, winners_count, status)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1,
        now(), now() + interval '7 days', 3, 'open');

insert into public.songs (id, spotify_track_id, title, artist) values
  ('30000000-0000-0000-0000-000000000001', 'sp1', 'Song 1', 'A'),
  ('30000000-0000-0000-0000-000000000002', 'sp2', 'Song 2', 'A'),
  ('30000000-0000-0000-0000-000000000003', 'sp3', 'Song 3', 'A'),
  ('30000000-0000-0000-0000-000000000004', 'sp4', 'Song 4', 'A');

insert into public.song_nominations (id, cycle_id, song_id, submitted_by) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', tests.get_supabase_uid('voter')),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', tests.get_supabase_uid('voter')),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', tests.get_supabase_uid('voter')),
  ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', tests.get_supabase_uid('voter'));

-- ── 4. set_cycle_defaults: winners_count NULL wird aus Playlist-Defaults gefüllt ──
insert into public.cycles (playlist_id, cycle_number, starts_at, ends_at, winners_count, is_initial)
values ('10000000-0000-0000-0000-000000000001', 2, now(), now() + interval '7 days', null, false);
select is(
  (select winners_count from public.cycles where playlist_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 2),
  3,
  'set_cycle_defaults: regulärer Cycle erbt default_winners_count (3)'
);

insert into public.cycles (playlist_id, cycle_number, starts_at, ends_at, winners_count, is_initial)
values ('10000000-0000-0000-0000-000000000001', 3, now(), now() + interval '7 days', null, true);
select is(
  (select winners_count from public.cycles where playlist_id = '10000000-0000-0000-0000-000000000001' and cycle_number = 3),
  10,
  'set_cycle_defaults: Initial-Cycle erbt initial_winners_count (10)'
);

-- ── 5. prevent_master_cycles: Cycle auf Master-Playlist verboten ──
select throws_like(
  $$ insert into public.cycles (playlist_id, cycle_number, starts_at, ends_at, winners_count)
     values ('10000000-0000-0000-0000-0000000000ff', 1, now(), now() + interval '7 days', 3) $$,
  '%Master-Playlists haben keine Cycles%',
  'prevent_master_cycles: Cycle auf Master-Playlist wird blockiert'
);

-- ── 3. check_vote_budget: 3 Stimmen ok, 4. übersteigt das Budget ──
select lives_ok(
  $$ insert into public.votes (nomination_id, user_id) values
       ('40000000-0000-0000-0000-000000000001', (select id from auth.users where raw_user_meta_data->>'test_identifier' = 'voter')),
       ('40000000-0000-0000-0000-000000000002', (select id from auth.users where raw_user_meta_data->>'test_identifier' = 'voter')),
       ('40000000-0000-0000-0000-000000000003', (select id from auth.users where raw_user_meta_data->>'test_identifier' = 'voter')) $$,
  'check_vote_budget: 3 Stimmen im Budget (max 3) sind erlaubt'
);
select throws_like(
  $$ insert into public.votes (nomination_id, user_id) values
       ('40000000-0000-0000-0000-000000000004', (select id from auth.users where raw_user_meta_data->>'test_identifier' = 'voter')) $$,
  '%Stimmen-Budget%',
  'check_vote_budget: 4. Stimme übersteigt das Budget und wird blockiert'
);

-- ── 2. prevent_unauthorized_admin_change (nur Claim setzen, Rolle bleibt postgres) ──
select set_config(
  'request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('alice')::text, 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ update public.profiles set is_admin = true where id = tests.get_supabase_uid('alice') $$,
  'Nur Admins können is_admin ändern',
  'prevent_unauthorized_admin_change: Nicht-Admin kann eigenes is_admin nicht setzen'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', tests.get_supabase_uid('boss')::text, 'role', 'authenticated')::text,
  true
);
select lives_ok(
  $$ update public.profiles set is_admin = false where id = tests.get_supabase_uid('boss') $$,
  'prevent_unauthorized_admin_change: Admin darf is_admin ändern'
);

select * from finish();

rollback;
