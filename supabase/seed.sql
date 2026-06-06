-- Lokaler Dev-Seed. Läuft bei `supabase db reset` (siehe config.toml [db.seed]),
-- NICHT in Produktion. Legt zwei nominierbare Playlists mit je einem offenen Cycle
-- an, damit der Song-Vorschlag-Flow (Schritt 4) lokal sofort testbar ist.

insert into public.playlists
  (id, name, description, is_master, is_active, default_winners_count, initial_winners_count)
values
  ('00000000-0000-0000-0000-0000000000a1', 'Laufrunde Beats',
   'Treibende Songs für die Laufrunde', false, true, 3, 10),
  ('00000000-0000-0000-0000-0000000000a2', 'Cooldown',
   'Ruhigere Tracks zum Auslaufen', false, true, 3, 10)
on conflict (id) do nothing;

-- Offener Erst-Cycle je Playlist (is_initial=true). winners_count explizit gesetzt
-- (sonst füllt der Trigger set_cycle_defaults initial_winners_count).
insert into public.cycles
  (playlist_id, cycle_number, starts_at, ends_at, status, is_initial, winners_count)
values
  ('00000000-0000-0000-0000-0000000000a1', 1, now(), now() + interval '7 days', 'open', true, 10),
  ('00000000-0000-0000-0000-0000000000a2', 1, now(), now() + interval '7 days', 'open', true, 10)
on conflict (playlist_id, cycle_number) do nothing;
