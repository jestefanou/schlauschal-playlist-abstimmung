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

Öffne http://localhost:3000.

## Supabase
Das Repo ist mit einem Supabase-Projekt verknüpft. Lokale Migrationen liegen unter `supabase/migrations/`.

```bash
pnpm exec supabase start                       # lokale DB (Docker)
pnpm exec supabase migration new <name>        # neue Migration
pnpm exec supabase db push                     # Migrationen ans Remote-Projekt pushen
```

## Doku
- [docs/getting-started.md](./docs/getting-started.md) — detailliertes Setup (Voraussetzungen, Troubleshooting)
- [docs/migrations-workflow.md](./docs/migrations-workflow.md) — wie wir Schema-Änderungen sicher nach Prod bringen
- [AGENTS.md](./AGENTS.md) — Konventionen, Architektur-Invarianten, Direktiven für KI-Agents
