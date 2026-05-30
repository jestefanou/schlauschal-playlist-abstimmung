# Schlauchschal Playlist-Abstimmung

Webapp für den Laufclub **Schlauchschal Running**: Mitglieder schlagen Songs vor und voten — die wöchentlichen Top-Songs werden automatisch zu unseren Spotify-Playlists hinzugefügt.

## Stack
Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (Postgres + Auth) · Vercel.

## Lokales Setup
```bash
pnpm install
cp .env.local.example .env.local   # Werte aus dem Supabase-Dashboard eintragen
pnpm dev
```

Öffne http://127.0.0.1:3000 (lokal bewusst `127.0.0.1`, nicht `localhost`).

## Supabase
Das Repo ist mit einem Supabase-Projekt verknüpft. Lokale Migrationen liegen unter `supabase/migrations/`.

```bash
pnpm exec supabase start                       # lokale DB (Docker)
pnpm exec supabase migration new <name>        # neue Migration
pnpm exec supabase db push                     # Migrationen ans Remote-Projekt pushen
```

## Doku
Übersicht & Index: [docs/README.md](./docs/README.md). Highlights:
- [docs/setup/getting-started.md](./docs/setup/getting-started.md) — detailliertes Setup (Voraussetzungen, Troubleshooting)
- [docs/guides/testing.md](./docs/guides/testing.md) — Testen (statische Checks, lokales E2E, Migrations)
- [docs/guides/migrations.md](./docs/guides/migrations.md) — wie wir Schema-Änderungen sicher nach Prod bringen
- [AGENTS.md](./AGENTS.md) — Konventionen, Architektur-Invarianten, Direktiven für KI-Agents
