# AGENTS.md

Direktiven für KI-Agents in diesem Repo. Detaillierte Erklärungen für menschliche Entwickler liegen in [docs/](./docs/) — diese Datei ist bewusst knapp, regelhaft, „check first / don't do that".

> **Vor jeder Session:** [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) lesen (gitignored, lokaler Scratchpad). Dort steht der aktuelle Status, offene Fragen, und Brücken-Notizen zwischen Sessions. Pflege die Datei aktiv — siehe Anleitung darin.

## Projekt
Webapp für den Laufclub **Schlauchschal Running**. Mitglieder schlagen Songs vor und voten; die wöchentlichen Top-Songs werden automatisch zu Spotify-Playlists des Clubs hinzugefügt.

## Stack (gepinnt — vor jedem framework-Touch verifizieren via `package.json`)
- **Next.js 16** (App Router, TypeScript, Turbopack)
- **React 19**
- **Tailwind CSS 4** (CSS-First Config)
- **Supabase** (`@supabase/ssr` + `@supabase/supabase-js`)
- **pnpm 11** (mit `allowBuilds`-Allowlist)
- **Vercel** (Deployment)

## Run Commands
| Befehl | Zweck |
| --- | --- |
| `pnpm dev` | Lokaler Dev-Server (Turbopack) |
| `pnpm build` | Production-Build |
| `pnpm lint` | ESLint |
| `pnpm exec supabase start` | Lokales Supabase-Stack (Docker) |
| `pnpm exec supabase db reset` | Lokale DB neu, alle Migrations frisch |
| `pnpm exec supabase migration new <name>` | Neue Migration anlegen |
| `pnpm exec supabase migration list` | Lokal vs. Remote-Stand prüfen |

Detaillierter Setup-Walkthrough → [docs/getting-started.md](./docs/getting-started.md).

## Verzeichnisstruktur (Stand Schritt 2)
```
src/
  app/                  # Next.js App Router
  lib/supabase/
    client.ts           # Browser-Client
    server.ts           # Server-Components-Client
    middleware.ts       # Session-Refresh-Helper
  proxy.ts              # Next.js Proxy Entry (nicht "middleware"!)
supabase/
  config.toml
  migrations/
    20260517171501_tables.sql      # 9 Tabellen + Constraints + Indizes
    20260517171502_policies.sql    # RLS + 20 Policies + is_admin()
    20260517171503_functions.sql   # 5 Trigger
docs/                    # Erklärungen für Menschen
  getting-started.md
  migrations-workflow.md
```

## Datenmodell-Invarianten (im Schema durchgesetzt)
- `profiles` 1:1 mit `auth.users` — Auto-Anlage via Trigger `handle_new_user`
- Mails in `admin_bootstrap_emails` bekommen beim Signup `is_admin=true`
- `is_admin`-Änderung nur durch existierende Admins (Trigger `prevent_unauthorized_admin_change`)
- Stimmen-Budget pro `(user, cycle)` erzwungen (Trigger `check_vote_budget`)
- Cycle-`winners_count` aus `playlists.default_winners_count` / `initial_winners_count` (Trigger `set_cycle_defaults`)
- Master-Playlist (`is_master=true`, max 1 via Partial-Unique-Index) hat keine Cycles (Trigger `prevent_master_cycles`)
- Songs global, dedupliziert über `spotify_track_id`; `song_nominations` ist die Cycle×Song-Zwischentabelle

## Konventionen
- **Nie in `main` arbeiten** — vor jeder inhaltlichen Änderung einen Feature-Branch anlegen (`git checkout -b feat/<scope>` oder `fix/<scope>`). `main` ist tabu für direkte Commits; auch kleine Edits laufen über Branch + PR/Merge. Wenn du beim Session-Start auf `main` bist und Arbeit ansteht: zuerst Branch erstellen, dann coden.
- **TypeScript strict** — keine `any` ohne Begründung.
- **Server-First** — Datenzugriff bevorzugt in Server Components / Server Actions.
- **Auth-Sicherheit** — Im Server-Code immer `supabase.auth.getClaims()`, niemals `getSession()`.
- **RLS überall an** — Service-Role nie im Client-Code. Server-Code mit Service-Role nur in klar abgegrenzten Routen (Cron, Webhooks).
- **Migrations sind die Wahrheit** — Schemaänderungen ausschließlich über `supabase migration new`, nie per Dashboard.

## Migration-Regeln (nicht verhandelbar)
1. **Niemals eine alte Migration editieren**, sobald sie in `main` ist. Korrekturen → neue Migration.
2. **Lokal immer mit `supabase db reset` testen**, nicht mit `migration up` — sonst entgehen dir Konflikte beim frischen Setup.
3. **Niemals direkt im Supabase-Dashboard auf Prod schrauben.** Wenn doch passiert: `supabase db pull` → committen.
4. **Seed-Data** (Demo-User, Test-Songs) gehört in `supabase/seed.sql`, nicht in Migrations. **Echte Stammdaten** (z.B. `admin_bootstrap_emails`) gehören in Migrations.

Hintergrund / volle Erklärung → [docs/migrations-workflow.md](./docs/migrations-workflow.md).

## Roadmap
1. Projekt-Setup ✅
2. Supabase-Schema & Migrationen ✅
3. Auth (Magic Link + Invite-Code)
4. Song-Vorschläge (Spotify-Suche)
5. Voting-UI
6. Wöchentlicher Cron + Spotify-Push
7. Spotify-OAuth für Owner-Account
8. Polishing & Vercel-Deployment

## Versions-Drift vermeiden (Hauptursache für KI-Bugs hier)

LLMs schreiben Code oft so, wie eine ältere Major-Version es verlangt hätte. In diesem Repo gilt:

1. **Vor framework-spezifischem Code: `package.json` lesen** und Major-Versionen feststellen.
2. **Wenn eine Major-Version frisch wirkt** (≥ als das, was du intern „vertraut" kennst): nicht aus Erinnerung schreiben. WebFetch auf die offizielle Doku für genau diese Version.
3. **Deprecation-Warnungen aus `pnpm build`/`pnpm dev` sind Arbeit, nicht Rauschen** — migrieren, bevor weitergebaut wird.
4. **Bei Drift-Verdacht**: kurz rückversichern statt Best-Guess.

### Bekannte Fallstricke in diesem Stack (Stand 2026)
- **Next.js 16**: `middleware.ts` heißt jetzt `proxy.ts`, exportierte Funktion `proxy()`. Cookie-Handling in Server Components ist `await cookies()` (async).
- **Tailwind 4**: CSS-First — kein `tailwind.config.js` im Default. Theme-Tokens via `@theme` in CSS. PostCSS-Plugin ist `@tailwindcss/postcss`.
- **Supabase SSR**: Paket `@supabase/ssr` (nicht `@supabase/auth-helpers-nextjs`). Server: `auth.getClaims()` statt `auth.getSession()`. Keys: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` (nicht `ANON_KEY` / `SERVICE_ROLE_KEY`).
- **Supabase config.toml**: `[auth.email] enable_signup = false` deaktiviert in supabase-cli 2.98 **das gesamte Email-Provider-Modul** (Fehler `email_provider_disabled` bei `signInWithOtp`), nicht nur Signup. Zum Schließen offener Signups nur den globalen `[auth] enable_signup = false` setzen und im Email-Block auf `true` lassen.
- **pnpm 11**: `onlyBuiltDependencies` entfernt, ersetzt durch `allowBuilds: { name: true|false }` in `pnpm-workspace.yaml`.

Diese Liste ergänzen, sobald ein neuer Fallstrick auftaucht.