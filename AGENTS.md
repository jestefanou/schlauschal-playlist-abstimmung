# AGENTS.md

Diese Datei orientiert Agents (Claude Code & Co.) und neue Mitwirkende.

## Projekt
Webapp für den Laufclub **Schlauchschal Running**. Mitglieder schlagen Songs vor und voten; die wöchentlichen Top-Songs werden automatisch zu Spotify-Playlists des Clubs hinzugefügt.

## Stack
- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS 4**
- **Supabase** (Postgres + Auth, lokale Migrationen via Supabase CLI)
- **Spotify Web API** (Cron-Push aus Vercel oder Supabase Edge Function — wird in Schritt 6 entschieden)
- **Vercel** (Deployment)

## Setup
```bash
pnpm install
cp .env.local.example .env.local   # Supabase-Werte eintragen
pnpm dev
```

## Run Commands
| Befehl | Zweck |
| --- | --- |
| `pnpm dev` | Lokaler Dev-Server (Turbopack) |
| `pnpm build` | Production-Build |
| `pnpm lint` | ESLint |
| `pnpm exec supabase start` | Lokale Supabase-Instanz starten (Docker) |
| `pnpm exec supabase db push` | Migrationen ans verknüpfte Remote-Projekt pushen |
| `pnpm exec supabase migration new <name>` | Neue Migration anlegen |

## Verzeichnisstruktur (Stand Schritt 1)
```
src/
  app/                  # Next.js App Router
  lib/supabase/
    client.ts           # Browser-Client
    server.ts           # Server-Components-Client
    middleware.ts       # Session-Refresh-Helper (von proxy.ts genutzt)
  proxy.ts              # Next.js Proxy Entry (früher "middleware")
supabase/
  config.toml           # Supabase-Projektkonfig
  migrations/           # SQL-Migrationen (entsteht in Schritt 2)
```

## Konventionen
- **TypeScript strict** — keine `any` ohne Begründung.
- **Server-First**: Datenzugriff bevorzugt in Server Components / Server Actions.
- **Auth-Sicherheit**: Im Server-Code immer `supabase.auth.getClaims()`, niemals `getSession()` — Letzteres ist client-only sicher.
- **RLS überall an**: Jede Tabelle bekommt Row-Level-Security-Policies, kein direkter Service-Role-Zugriff aus dem Frontend.
- **Migrationen sind die Wahrheit**: Schemaänderungen ausschließlich über `supabase migration new ...`, nie per Dashboard-Quick-Edit auf Prod.

## Geplante Roadmap
1. Projekt-Setup ✅
2. Supabase-Schema & Migrationen (Profile, Songs, Votes, Wochen, Playlist-Mapping, RLS)
3. Auth (Magic Link + E-Mail-Allowlist)
4. Song-Vorschläge (Spotify-Suche im Frontend)
5. Voting-UI
6. Wöchentlicher Cron + Spotify-Push
7. Spotify-OAuth für Owner-Account
8. Polishing & Vercel-Deployment

## Pnpm-Hinweis
pnpm 11 erfordert für native Postinstall-Scripts eine explizite Allow-Liste in `pnpm-workspace.yaml` (`allowBuilds`). Aktuell erlaubt: `sharp`, `supabase`, `unrs-resolver`. Beim Hinzufügen weiterer Pakete mit Postinstall ggf. ergänzen.

## Hinweise für KI-Agents: Versions-Drift vermeiden

LLMs neigen dazu, Code so zu schreiben, wie eine ältere Major-Version eines Frameworks es verlangt hätte (Trainingsdaten hinken hinterher). In diesem Repo gilt:

**Bevor du framework-spezifischen Code schreibst:**
1. **Lies `package.json`** und notiere die Major-Versionen der relevanten Pakete (Next, React, Tailwind, Supabase-SDKs).
2. **Bei einer Major-Version ≥ deiner internen "vertrauten" Version**: verlasse dich **nicht** auf Erinnerung. Hol dir die aktuelle Doku via WebFetch (nextjs.org/docs, supabase.com/docs, tailwindcss.com/docs) bevor du eine Datei anlegst oder eine API verwendest.
3. **Behandle Deprecation-Warnungen aus `pnpm build`/`pnpm dev` als Arbeit, nicht als Rauschen.** Wenn der Build sagt „X is deprecated, use Y": migrieren, bevor weitergebaut wird.
4. **Bei Verdacht auf Drift** (Beispiel: ein Code-Snippet aus dem Gedächtnis fühlt sich „Standard" an, aber die Doku des aktuellen Majors zeigt etwas anderes): kurz beim User rückversichern, statt Best-Guess zu schreiben.

**Bekannte Fallstricke in diesem Stack (Stand 2026):**
- **Next.js 16**: `middleware.ts` heißt jetzt `proxy.ts`, exportierte Funktion `proxy()` (nicht `middleware()`). Cookie-Handling in Server Components erfolgt über `await cookies()` (async, nicht sync).
- **Tailwind 4**: CSS-First-Config — kein `tailwind.config.js` mehr im Default-Setup; Theme-Tokens werden in CSS via `@theme` deklariert. PostCSS-Plugin ist `@tailwindcss/postcss`, nicht mehr `tailwindcss` direkt.
- **Supabase SSR**: Paket `@supabase/ssr` (nicht das alte `@supabase/auth-helpers-nextjs`). Im Server-Code `auth.getClaims()` statt `auth.getSession()`. Neue Key-Namen: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (statt `ANON_KEY`) und `SUPABASE_SECRET_KEY` (statt `SERVICE_ROLE_KEY`).
- **pnpm 11**: `onlyBuiltDependencies` ist entfernt, ersetzt durch `allowBuilds: { name: true|false }` in `pnpm-workspace.yaml`.

Diese Liste ergänzen, sobald ein neuer Fallstrick im Repo auftaucht.
