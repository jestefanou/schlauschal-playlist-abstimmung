# Getting Started

Detailliertes Setup für neue Mitwirkende. Wenn du nur schnell loslegen willst, reicht das, was im [README](../README.md) steht.

## Voraussetzungen

| Tool | Version | Wofür |
| --- | --- | --- |
| Node.js | ≥ 20 | Next.js, TypeScript |
| pnpm | ≥ 11 | Package Manager (Installation siehe unten) |
| Docker Desktop | aktuell | Lokales Supabase-Stack (Postgres, Auth, Storage, Studio) |

### pnpm installieren
```bash
npm install -g pnpm
```

### Docker
Wir nutzen [Docker Desktop](https://www.docker.com/products/docker-desktop). Beim ersten `supabase start` werden ca. 10 Container-Images gezogen — das dauert ein paar Minuten und braucht einmalig ~2 GB Plattenplatz.

## Lokales Setup

### 1. Repo + Dependencies
```bash
git clone <repo-url>
cd schlauschal-playlist-abstimmung
pnpm install
```

`pnpm install` führt die Postinstall-Scripts für `sharp`, `supabase` und `unrs-resolver` aus (per `allowBuilds` in [pnpm-workspace.yaml](../pnpm-workspace.yaml) zugelassen). Beim ersten Mal lädt das u.a. die Supabase-CLI als Go-Binary ins Projekt.

### 2. Supabase lokal hochfahren
Docker Desktop starten, dann:
```bash
pnpm exec supabase start
```
Wenn alles oben ist, gibt dir die CLI eine Tabelle mit URLs und Keys aus:

| Service | URL |
| --- | --- |
| Studio (Dashboard) | http://127.0.0.1:54323 |
| REST/Auth API | http://127.0.0.1:54321 |
| Postgres direkt | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Mailpit (Mail-Testserver für Magic-Links) | http://127.0.0.1:54324 |

Stoppen geht mit `pnpm exec supabase stop`. Komplett zurücksetzen (Migrations frisch durchlaufen lassen, alle Daten weg) mit `pnpm exec supabase db reset`.

### 3. Env-Datei
```bash
cp .env.local.example .env.local
```
Trage die Werte aus dem `supabase start`-Output ein:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # aus CLI-Output
```
Die lokalen Keys sind stabil zwischen `supabase start`-Aufrufen, du musst die `.env.local` also nur einmal füllen.

### 4. Next.js starten
```bash
pnpm dev
```
Öffne http://localhost:3000.

## Hilfreiche Commands

| Befehl | Wofür |
| --- | --- |
| `pnpm dev` | Dev-Server (Turbopack) |
| `pnpm build` | Production-Build (für TS-/Lint-Check) |
| `pnpm lint` | ESLint |
| `pnpm exec supabase start` | Lokales Supabase-Stack hoch |
| `pnpm exec supabase stop` | Lokales Stack runter (Daten bleiben) |
| `pnpm exec supabase db reset` | Lokale DB komplett neu (Migrations laufen frisch) |
| `pnpm exec supabase migration new <name>` | Neue Migration anlegen |
| `pnpm exec supabase migration list` | Stand vergleichen (lokal vs. remote) |

Mehr zum Migrations-Workflow → [migrations-workflow.md](./migrations-workflow.md).

## Troubleshooting

**`supabase start` hängt bei „Starting database"**
Docker Desktop hat zu wenig RAM zugewiesen. In den Docker-Einstellungen auf ≥ 4 GB stellen.

**`pnpm install` meckert über `ignored builds`**
Sollte nicht mehr passieren — die Allowlist steht in [pnpm-workspace.yaml](../pnpm-workspace.yaml). Falls doch: kontrollieren, ob ein neues Paket mit Postinstall reingekommen ist, das nicht in `allowBuilds:` steht. Hinzufügen und neu installieren.

**Port 54321/54322/54323 bereits belegt**
Du hast vermutlich noch ein anderes Supabase-Projekt laufen. `pnpm exec supabase stop --project-id <name>` für das andere Projekt.

**Magic-Link-Mail kommt nicht an**
Lokale Mails werden nicht versendet, sondern landen in [Mailpit](http://127.0.0.1:54324). Dort öffnest du sie und kopierst den Link.

> Den kompletten Login-Flow Schritt für Schritt durchspielen → [testing-auth.md](./testing-auth.md).
