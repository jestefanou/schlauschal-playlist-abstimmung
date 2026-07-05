---
title: "Schritt 4 — Song-Vorschläge (Spotify-Suche + Multi-Playlist-Nominierung)"
branch: feat/song-suggestions
base: main
pr: "#10"
status: merged
date: 2026-06-06
authors: [jstefano]
related:
  - src/lib/spotify.ts
  - src/app/songs/
  - supabase/migrations/20260606152100_songs_added_by_self.sql
  - docs/guides/spotify-setup.md
---

# Schritt 4 — Song-Vorschläge (Spotify-Suche + Multi-Playlist-Nominierung)

## TL;DR

Mitglieder können Songs über die Spotify-Suche finden und sie in einem Zug für
mehrere Playlists vorschlagen sowie eigene Vorschläge zurücknehmen. Neu: ein
serverseitiger Spotify-Client (Client-Credentials-Flow, gecachtes App-Token), drei
Server Actions (`searchSpotifyTracks`/`nominateSong`/`withdrawNomination`), eine
`/songs`-Seite mit debounced Live-Suche + Multi-Select. Verifiziert per Lint/Build,
43 Unit-Tests, 26 pgTAP-Tests **und** einem kompletten Browser-E2E-Durchlauf gegen den
lokalen Stack. Vor dem PR lief ein Multi-Agent-Code-Assessment; die bestätigten
Befunde sind eingearbeitet (u. a. eine RLS-Härtung für `songs.added_by` und ein
Per-User-Rate-Limit für die Suche).

## Problem & Kontext

Schritt 4 der Roadmap: Mitglieder schlagen Songs vor. Entscheidungen Q4.1–Q4.4 wurden
vorab mit dem User geklärt:

- **Q4.1 → A:** Spotify Client-Credentials-Flow serverseitig (kein User-OAuth für die Suche).
- **Q4.2 → A:** Client-seitige Suche mit Debounce.
- **Q4.3 → B:** Multi-Select über aktive Playlists; ein Submit → mehrere Nominierungen.
- **Q4.4 → B:** Liste eigener Nominierungen + Zurücknehmen.

## Branch- & Commit-Historie

- Abgezweigt von `main` (nach Merge PR #9) am 2026-06-06.
- Umgesetzt in diesem Branch (dieser Report im selben Commit); PR #10 → `main`.

## Entscheidungen

| Entscheidung | Optionen | Gewählt & Warum |
| --- | --- | --- |
| Song-Dedup-Insert unter RLS | upsert DO UPDATE / DO NOTHING | **DO NOTHING** (`ignoreDuplicates`) — `songs` hat kein UPDATE-Recht für `authenticated`; ein DO-UPDATE-Upsert würde an RLS scheitern. Danach `select id`. |
| Live-Suche | Effekt auf `query` / Event-Handler | **Event-Handler** (`onQueryChange`) — vermeidet die React-19-Regel `set-state-in-effect`; `useEffect` nur fürs Timer-Cleanup. |
| Zurücknehmen-Feedback | `<form action>` (void) / Client-Button mit Result | **Client-Button** (`WithdrawButton` + `useTransition`) — Fehler werden dem Nutzer angezeigt, konsistent zum Result-Pattern der anderen Actions (Assessment-Befund). |
| `songs.added_by`-Integrität | belassen / RLS härten | **RLS härten** (neue Migration) — `with check (added_by = auth.uid())`, konsistent zu `nominations`/`votes` (Assessment-Befund). |
| Spotify-Suche-Abuse | nur Client-Debounce / serverseitiges Throttle | **Per-User-Throttle** (`rateLimit`, 30/10s) — der Client-Debounce ist umgehbar, das App-Token instanzweit geteilt (Assessment-Befund). |
| Album-Cover | `next/image` / `<img>` | **`<img>`** — externe Spotify-CDN-URLs, winzige Thumbnails; `next/image` bräuchte `images.remotePatterns`, Optimizer lohnt nicht (Trade-off kommentiert). |

## Geänderte Dateien

### Neu
| Datei | Aufgabe | Wichtigste Symbole |
| --- | --- | --- |
| `src/lib/spotify.ts` | Spotify Client-Credentials-Token (gecacht, 401-Retry) + Track-Suche | `searchTracks`, `SpotifyTrack` |
| `src/lib/rate-limit.ts` | In-Memory Fixed-Window-Rate-Limit pro Schlüssel | `rateLimit` |
| `src/app/songs/actions.ts` | Server Actions | `searchSpotifyTracks`, `nominateSong`, `withdrawNomination` |
| `src/app/songs/page.tsx` | `/songs`-Seite (Playlists + eigene Vorschläge laden) | `SongsPage` |
| `src/app/songs/SongSearch.tsx` | Client: debounced Suche + Multi-Select-Nominierung | `SongSearch`, `TrackRow` |
| `src/app/songs/WithdrawButton.tsx` | Client: Zurücknehmen mit Fehler-Feedback | `WithdrawButton` |
| `supabase/migrations/20260606152100_songs_added_by_self.sql` | RLS: `songs.added_by = auth.uid()` | — |
| `supabase/seed.sql` | Lokaler Dev-Seed (2 Playlists + offene Cycles) | — |
| `docs/guides/spotify-setup.md` | Anleitung App-Anlage + Client Credentials | — |
| `*.test.ts` (spotify/rate-limit/actions) | Unit-Tests | — |

### Geändert
| Datei | Was/Warum |
| --- | --- |
| `src/components/Header.tsx` | Nav-Link „Songs" |
| `next.config.ts` | `allowedDevOrigins: ["127.0.0.1"]` — sonst killt der HMR-Cross-Origin-Block im Dev den Client-State per Full-Reload |
| `.env.local.example` | `SPOTIFY_CLIENT_ID`/`SECRET` aktiviert |
| `supabase/tests/020-rls.test.sql` | `songs`-Insert-Test auf eigenes/fremdes `added_by` (plan 14 → 15) |

## Architektur & Flows

1. **Suche:** `SongSearch` (Client) debounct (300 ms) → Server Action `searchSpotifyTracks`
   (auth-gated + Per-User-Throttle) → `searchTracks` holt/cacht das App-Token und ruft
   `/v1/search` (`market=DE`, `limit≤10`).
2. **Nominieren:** `nominateSong(track, playlistIds[])` → Song-Upsert (DO NOTHING) →
   `select id` → offene Cycles der gewählten (aktiven, nicht-Master) Playlists → je Cycle
   eine `song_nominations`-Zeile (`submitted_by = auth.uid()`, DO NOTHING auf
   `(cycle_id, song_id)`) → `revalidatePath('/songs')`.
3. **Zurücknehmen:** `WithdrawButton` → `withdrawNomination(id)` (DELETE, RLS self/admin)
   → bei Erfolg Revalidate, bei Fehler Inline-Meldung.

## Datenbank / Migrationen

- **Neu** `20260606152100_songs_added_by_self.sql`: ersetzt die `songs`-Insert-Policy
  (`with check (auth.uid() is not null)`) durch `with check (added_by = (select auth.uid()))`.
  Additiv/reversibel (drop+create policy). Schließt eine Attributions-/Integritätslücke
  (Client konnte per direktem PostgREST-Insert ein fremdes `added_by` setzen).
- Lokaler **Seed** (`seed.sql`) legt 2 Playlists + offene Cycles an (nur lokal via
  `[db.seed]`, keine Prod-Daten).

## Tests & Verifikation

- `pnpm lint` sauber, `pnpm build` grün (`/songs`-Route).
- `pnpm test:run` **43/43** (Spotify-Lib inkl. 401-Retry/non-ok-Throws/Leer-Query;
  Rate-Limit; Action-Logik inkl. Query-Argument-Assertions, Rate-Limit-Pfad,
  Withdraw-Erfolg/-Fehler, Schwellenwert `q.length==2`).
- `pnpm test:db` **26/26** (neue `songs.added_by`-Policy: eigener erlaubt, fremder → 42501).
- `supabase db reset` wendet alle 6 Migrationen + Seed sauber an.
- **Browser-E2E** (lokaler Stack, `127.0.0.1:3000`): Login (Magic Link via Mailpit) →
  Suche → Vorschlag in 2 Playlists (DB-Ground-Truth bestätigt, Song dedupliziert) →
  Zurücknehmen (RLS-DELETE bestätigt). Anschließend DB auf sauberen Seed-Stand zurückgesetzt.

## Code-Assessment (vor dem PR)

Multi-Agent-Assessment (5 Dimensionen, adversarisch verifiziert): **kein Blocker, kein
echter Major.** Eingearbeitet: Stale-Request-Guard im `<2-Zeichen`-Zweig, `status`-Tag
`"ok"`→`"success"` (Konsistenz zu `LoginState`), Empty-State „Keine Treffer",
`mapTracks` gegen fehlendes `artists` abgesichert, Status-Meldungen an den Box-Stil/die
Farbtöne angeglichen, `<img>`-Trade-off kommentiert, `withdrawNomination` mit
Result-Typ + Client-Feedback, `songs.added_by`-RLS-Härtung, Per-User-Rate-Limit,
Tests gestärkt.

## Risiken, Rollback & Auswirkungen

- Reine Feature-Erweiterung; die einzige Schema-Änderung (RLS-Policy) ist additiv und
  per Revert/`drop policy` rückrollbar.
- `SPOTIFY_CLIENT_ID`/`SECRET` müssen in jeder Umgebung gesetzt sein (Prod: Vercel-Env).
- Rate-Limit ist In-Memory pro Server-Instanz (kein verteilter Store) — für die
  Projektgröße ausreichend; bei mehreren Instanzen entsprechend lockerer.

## Offene Punkte / Follow-ups

- **E2E für den Song-Flow** bewusst zurückgestellt (bräuchte Spotify-API-Mocking); die
  Action-Logik ist unit-getestet, der Flow wurde manuell per Browser verifiziert.
- **Master-Playlist** (Aggregat) wird nicht als Nominierungsziel angeboten — relevant erst
  in Schritt 6 (Push) / Schritt 8 (Admin-UI zum Anlegen von Playlists/Cycles).
- Schritt 5 (Voting-UI) baut auf den hier erzeugten `song_nominations` auf.

## Zusammenfassung

Schritt 4 liefert den kompletten Vorschlags-Flow: Spotify-Suche serverseitig (App-Token
gecacht, throttled), Multi-Playlist-Nominierung mit Song-Dedup über `spotify_track_id`,
und eine Rücknahme-Funktion mit Nutzer-Feedback. RLS bleibt die Vertrauensgrenze; eine
Migration bindet `songs.added_by` an den Aufrufer (konsistent zu den Geschwister-Policies).
Statisch (Lint/Build), per Unit- (43) und pgTAP-Tests (26) sowie per Browser-E2E
verifiziert; ein vorgeschaltetes Multi-Agent-Assessment ohne Blocker, dessen Befunde
eingearbeitet sind.
