-- Lokaler Dev-Seed. Läuft bei `supabase db reset` (siehe config.toml [db.seed]),
-- NICHT in Produktion. Legt zwei Playlists mit je einem offenen Cycle an — eine in
-- der Nominierungsphase (Schritt-4-Flow testbar) und eine in der Abstimmungsphase
-- (Schritt-5-Flow testbar). Für einen vollen Voting-Test lokal: in der
-- Nominierungsphase Songs vorschlagen, dann den Cycle per SQL in die
-- Abstimmungsphase schieben:
--   update public.cycles set voting_starts_at = now()
--   where playlist_id = '00000000-0000-0000-0000-0000000000a1';

insert into public.playlists
  (id, name, description, is_master, is_active, default_winners_count, initial_winners_count, nomination_days)
values
  ('00000000-0000-0000-0000-0000000000a1', 'Laufrunde Beats',
   'Treibende Songs für die Laufrunde', false, true, 3, 10, 4),
  ('00000000-0000-0000-0000-0000000000a2', 'Cooldown',
   'Ruhigere Tracks zum Auslaufen', false, true, 3, 10, 4)
on conflict (id) do nothing;

-- Offener Erst-Cycle je Playlist (is_initial=true). winners_count explizit gesetzt
-- (sonst füllt der Trigger set_cycle_defaults initial_winners_count).
-- a1: Tag 0 von 7 -> Nominierungsphase (voting ab Tag 4).
-- a2: Tag 5 von 7 -> Abstimmungsphase (voting seit Tag 4, läuft noch 2 Tage).
insert into public.cycles
  (playlist_id, cycle_number, starts_at, voting_starts_at, ends_at, status, is_initial, winners_count)
values
  ('00000000-0000-0000-0000-0000000000a1', 1,
   now(), now() + interval '4 days', now() + interval '7 days', 'open', true, 10),
  ('00000000-0000-0000-0000-0000000000a2', 1,
   now() - interval '5 days', now() - interval '1 day', now() + interval '2 days', 'open', true, 10)
on conflict (playlist_id, cycle_number) do nothing;
