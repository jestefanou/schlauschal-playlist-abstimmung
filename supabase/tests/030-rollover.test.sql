-- pgTAP: Cycle-Rollover aus 20260705170620_cycle_rollover.sql.
-- rollover_due_cycles() läuft hier als postgres (Superuser behält EXECUTE trotz
-- REVOKE) — im Betrieb ruft die Cron-Route sie als service_role via RPC.
-- Die EXECUTE-Sperre wird bewusst NUR über has_function_privilege geprüft, nie
-- per Aufruf als authenticated: der Permission-Denied-Pfad segfaultet mit dem
-- lokal gepinnten supautils 3.2.0 (siehe docs/reports/2026-06-01_segfault-…md).
-- Eine Transaktion, am Ende Rollback -> keine Testdaten bleiben zurück.

set search_path = extensions, tests, public;

begin;

-- ── Seed (als postgres, RLS-bypass) ──
select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');

select set_config('test.alice_id', tests.get_supabase_uid('alice')::text, true);
select set_config('test.bob_id', tests.get_supabase_uid('bob')::text, true);
select set_config('test.carol_id', tests.get_supabase_uid('carol')::text, true);

-- Defensive gegen lokalen Drift: fremde überfällige offene Cycles (z.B. per
-- Phasen-Flip-Snippet verschobener Seed) würden die 'rolled'-Zählung stören.
-- Transaktions-lokal, wird eh zurückgerollt.
update public.cycles set ends_at = now() + interval '7 days'
where status = 'open' and ends_at <= now();

-- P1: aktiv, Cycle 1 überfällig (ends_at vor 10 Tagen -> Fast-Forward-Fall).
-- P2: inaktiv, Cycle überfällig -> schließen + auswerten, aber kein Folge-Cycle.
-- P3: aktiv, Cycle läuft noch -> bleibt unberührt.
insert into public.playlists (id, name, is_active, vote_budget_per_cycle, default_winners_count, initial_winners_count, nomination_days) values
  ('51111111-0000-0000-0000-000000000001', 'Rollover Aktiv', true, 3, 3, 10, 4),
  ('51111111-0000-0000-0000-000000000002', 'Rollover Inaktiv', false, 3, 3, 10, 4),
  ('51111111-0000-0000-0000-000000000003', 'Rollover Laufend', true, 3, 3, 10, 4);

insert into public.cycles (id, playlist_id, cycle_number, starts_at, voting_starts_at, ends_at, winners_count, status) values
  ('52222222-0000-0000-0000-000000000001', '51111111-0000-0000-0000-000000000001', 1,
   now() - interval '17 days', now() - interval '13 days', now() - interval '10 days', 3, 'open'),
  ('52222222-0000-0000-0000-000000000002', '51111111-0000-0000-0000-000000000002', 1,
   now() - interval '8 days', now() - interval '4 days', now() - interval '1 day', 3, 'open'),
  ('52222222-0000-0000-0000-000000000003', '51111111-0000-0000-0000-000000000003', 1,
   now() - interval '5 days', now() - interval '1 day', now() + interval '2 days', 3, 'open');

insert into public.songs (id, spotify_track_id, title, artist) values
  ('53333333-0000-0000-0000-000000000001', 'roll1', 'Drei Stimmen', 'A'),
  ('53333333-0000-0000-0000-000000000002', 'roll2', 'Zwei Stimmen spät', 'A'),
  ('53333333-0000-0000-0000-000000000003', 'roll3', 'Zwei Stimmen früh', 'A'),
  ('53333333-0000-0000-0000-000000000004', 'roll4', 'Eine Stimme', 'A'),
  ('53333333-0000-0000-0000-000000000005', 'roll5', 'Keine Stimme', 'A'),
  ('53333333-0000-0000-0000-000000000006', 'roll6', 'Inaktiv ohne Stimme', 'A'),
  ('53333333-0000-0000-0000-000000000007', 'roll7', 'Laufender Cycle', 'A');

-- Nominierungen in C1: n3 ist FRÜHER eingereicht als n2 (Tie-Break-Fall bei
-- je 2 Stimmen); n4 fliegt am winners_count-Limit raus; n5 hat 0 Stimmen.
insert into public.song_nominations (id, cycle_id, song_id, submitted_by, created_at) values
  ('54444444-0000-0000-0000-000000000001', '52222222-0000-0000-0000-000000000001',
   '53333333-0000-0000-0000-000000000001', current_setting('test.alice_id')::uuid, now() - interval '16 days'),
  ('54444444-0000-0000-0000-000000000002', '52222222-0000-0000-0000-000000000001',
   '53333333-0000-0000-0000-000000000002', current_setting('test.bob_id')::uuid, now() - interval '15 days'),
  ('54444444-0000-0000-0000-000000000003', '52222222-0000-0000-0000-000000000001',
   '53333333-0000-0000-0000-000000000003', current_setting('test.carol_id')::uuid, now() - interval '15 days 12 hours'),
  ('54444444-0000-0000-0000-000000000004', '52222222-0000-0000-0000-000000000001',
   '53333333-0000-0000-0000-000000000004', current_setting('test.alice_id')::uuid, now() - interval '14 days'),
  ('54444444-0000-0000-0000-000000000005', '52222222-0000-0000-0000-000000000001',
   '53333333-0000-0000-0000-000000000005', current_setting('test.bob_id')::uuid, now() - interval '14 days'),
  ('54444444-0000-0000-0000-000000000006', '52222222-0000-0000-0000-000000000002',
   '53333333-0000-0000-0000-000000000006', current_setting('test.alice_id')::uuid, now() - interval '7 days'),
  ('54444444-0000-0000-0000-000000000007', '52222222-0000-0000-0000-000000000003',
   '53333333-0000-0000-0000-000000000007', current_setting('test.alice_id')::uuid, now() - interval '4 days');

-- Stimmen: n1=3, n2=2, n3=2, n4=1, n5=0; n7 (laufender Cycle)=1.
-- Budgets bleiben im Rahmen (max 3 pro User & Cycle).
insert into public.votes (nomination_id, user_id) values
  ('54444444-0000-0000-0000-000000000001', current_setting('test.alice_id')::uuid),
  ('54444444-0000-0000-0000-000000000001', current_setting('test.bob_id')::uuid),
  ('54444444-0000-0000-0000-000000000001', current_setting('test.carol_id')::uuid),
  ('54444444-0000-0000-0000-000000000002', current_setting('test.alice_id')::uuid),
  ('54444444-0000-0000-0000-000000000002', current_setting('test.bob_id')::uuid),
  ('54444444-0000-0000-0000-000000000003', current_setting('test.alice_id')::uuid),
  ('54444444-0000-0000-0000-000000000003', current_setting('test.carol_id')::uuid),
  ('54444444-0000-0000-0000-000000000004', current_setting('test.bob_id')::uuid),
  ('54444444-0000-0000-0000-000000000007', current_setting('test.alice_id')::uuid);

select plan(21);

-- ── RLS-Härtung: Dead-Window (Cycle überfällig, aber noch 'open') ──
select tests.authenticate_as('carol');
select throws_ok(
  $$ insert into public.votes (nomination_id, user_id)
     values ('54444444-0000-0000-0000-000000000005', current_setting('test.carol_id')::uuid) $$,
  '42501',
  NULL,
  'votes_insert_self: nach ends_at keine neue Stimme mehr (Dead-Window dicht)'
);
delete from public.votes
where nomination_id = '54444444-0000-0000-0000-000000000003'
  and user_id = current_setting('test.carol_id')::uuid;
reset role;
select is(
  (select count(*)::int from public.votes
   where nomination_id = '54444444-0000-0000-0000-000000000003'
     and user_id = current_setting('test.carol_id')::uuid),
  1,
  'votes_delete_self: nach ends_at keine Stimme mehr zurückziehbar (0 Zeilen)'
);

-- ── Rollover ──
select set_config('test.rollover_result', public.rollover_due_cycles()::text, true);

select is(
  (current_setting('test.rollover_result')::jsonb ->> 'rolled')::int,
  2,
  'rollover_due_cycles: genau die zwei überfälligen Cycles verarbeitet'
);
select is(
  (select status from public.cycles where id = '52222222-0000-0000-0000-000000000001'),
  'closed',
  'überfälliger Cycle (aktive Playlist) ist geschlossen'
);
select is(
  (select status from public.cycles where id = '52222222-0000-0000-0000-000000000002'),
  'closed',
  'überfälliger Cycle (inaktive Playlist) ist geschlossen'
);
select is(
  (select status from public.cycles where id = '52222222-0000-0000-0000-000000000003'),
  'open',
  'laufender Cycle bleibt offen'
);

-- ── Gewinner-Ermittlung ──
select results_eq(
  $$ select song_id::text, rank, vote_count
     from public.cycle_winners
     where cycle_id = '52222222-0000-0000-0000-000000000001'
     order by rank $$,
  $$ values ('53333333-0000-0000-0000-000000000001', 1, 3),
            ('53333333-0000-0000-0000-000000000003', 2, 2),
            ('53333333-0000-0000-0000-000000000002', 3, 2) $$,
  'Gewinner: Stimmen absteigend, Tie-Break frühere Nominierung, Limit winners_count'
);
select is(
  (select count(*)::int from public.cycle_winners
   where cycle_id = '52222222-0000-0000-0000-000000000002'),
  0,
  '0-Stimmen-Nominierung wird kein Gewinner (Cycle kann leer ausgehen)'
);
select is(
  (select count(*)::int from public.cycle_winners
   where cycle_id = '52222222-0000-0000-0000-000000000003'),
  0,
  'laufender Cycle wird nicht ausgewertet'
);

-- ── Folge-Cycle (aktive Playlist, Fast-Forward um 1 Woche) ──
select is(
  (select status from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  'open',
  'Folge-Cycle ist offen'
);
select is(
  (select is_initial from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  false,
  'Folge-Cycle ist kein Initial-Cycle'
);
select is(
  (select winners_count from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  3,
  'Folge-Cycle erbt default_winners_count (via set_cycle_defaults)'
);
select is(
  (select starts_at from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  (select ends_at + interval '7 days' from public.cycles
   where id = '52222222-0000-0000-0000-000000000001'),
  'Folge-Cycle: 10 Tage Verzug -> Fast-Forward um genau eine ganze Woche'
);
select is(
  (select ends_at - starts_at from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  interval '7 days',
  'Folge-Cycle dauert 7 Tage'
);
select is(
  (select voting_starts_at - starts_at from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000001' and cycle_number = 2),
  interval '4 days',
  'Folge-Cycle: voting_starts_at aus nomination_days (via set_cycle_defaults)'
);
select is(
  (select count(*)::int from public.cycles
   where playlist_id = '51111111-0000-0000-0000-000000000002'),
  1,
  'inaktive Playlist bekommt keinen Folge-Cycle'
);

-- ── Idempotenz ──
select is(
  (public.rollover_due_cycles() ->> 'rolled')::int,
  0,
  'zweiter Lauf direkt danach ist ein No-Op'
);
select is(
  (select count(*)::int from public.cycle_winners
   where cycle_id = '52222222-0000-0000-0000-000000000001'),
  3,
  'zweiter Lauf erzeugt keine weiteren Gewinner'
);
select is(
  (select count(*)::int from public.cycles
   where playlist_id in ('51111111-0000-0000-0000-000000000001',
                         '51111111-0000-0000-0000-000000000002',
                         '51111111-0000-0000-0000-000000000003')),
  4,
  'zweiter Lauf erzeugt keine weiteren Cycles'
);

-- ── EXECUTE-Sperre (ohne Aufruf, siehe Kopfkommentar) ──
select is(
  has_function_privilege('authenticated', 'public.rollover_due_cycles()', 'execute'),
  false,
  'rollover_due_cycles: EXECUTE für authenticated entzogen'
);
select is(
  has_function_privilege('anon', 'public.rollover_due_cycles()', 'execute'),
  false,
  'rollover_due_cycles: EXECUTE für anon entzogen'
);

reset role;
select * from finish();

rollback;
