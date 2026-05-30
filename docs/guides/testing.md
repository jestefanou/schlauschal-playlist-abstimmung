# Testen — allgemeiner Leitfaden

Wie wir in diesem Projekt sicherstellen, dass eine Änderung wirklich
funktioniert. Geschrieben für Entwickler:innen, die mit Code vertraut sind, aber
nicht mit den Eigenheiten *dieses* Stacks — Begriffe werden kurz erklärt.

Für den konkreten, durchgespielten Beispiel-Fall (Login/Auth) siehe
[auth-testing.md](./auth-testing.md). Für das lokale Setup siehe
[../setup/getting-started.md](../setup/getting-started.md).

## Was „Testen" hier (aktuell) bedeutet

Es gibt **noch kein automatisiertes Test-Framework** (kein Jest/Vitest/Playwright
im Repo). Das Sicherheitsnetz besteht zurzeit aus drei Ebenen:

1. **Statische Checks** — der Compiler und der Linter finden Fehler, ohne dass
   Code läuft.
2. **Manuelles End-to-End-Testen** — die echte App lokal starten und den Ablauf
   durchklicken („End-to-End" = vom Klick im Browser bis zur Datenbank und
   zurück).
3. **Migrations-Verifikation** — die Datenbank aus den Migrationsdateien frisch
   aufbauen und prüfen, dass sie sauber durchläuft.

Das ist für die aktuelle Projektphase bewusst so. Automatisierte Tests können
später dazukommen; wenn, dann wird dieser Leitfaden erweitert.

## 1. Statische Checks

```bash
pnpm build    # baut die App; bricht bei TypeScript-Fehlern ab
pnpm lint     # ESLint: Stil- und Korrektheits-Regeln
```

- `pnpm build` ist hier auch der **Typecheck**: Next.js lässt den
  TypeScript-Compiler über alles laufen. Grüner Build = keine Typfehler.
- Beide sind schnell und sollten **vor jedem Commit** grün sein.

## 2. Lokales End-to-End-Testen

Voraussetzung: lokaler Stack läuft (siehe
[../setup/getting-started.md](../setup/getting-started.md)).

```bash
pnpm exec supabase status   # läuft Supabase? sonst: supabase start
pnpm dev                    # Dev-Server
```

> **Wichtig — immer `http://127.0.0.1:3000`, nie `localhost`.** Supabase ist auf
> `127.0.0.1` konfiguriert; ein Host-Mix bricht u. a. Magic-Link-Redirects. Details
> in [auth-testing.md](./auth-testing.md).

Werkzeuge beim manuellen Testen:

| Was | Wo | Wofür |
| --- | --- | --- |
| **App** | http://127.0.0.1:3000 | der eigentliche Klick-Durchlauf |
| **Studio** | http://127.0.0.1:54323 | DB im Browser ansehen/bearbeiten, SQL ausführen |
| **Mailpit** | http://127.0.0.1:54324 | lokal „versendete" Mails (Magic Links) abfangen |

**Datenbank direkt prüfen** — entweder im Studio (SQL Editor) oder per Container:

```bash
docker exec -i "$(docker ps --filter name=supabase_db --format '{{.Names}}')" \
  psql -U postgres -d postgres -c "select count(*) from public.profiles;"
```

(`docker exec … psql` öffnet die Postgres-Shell *im* DB-Container — praktisch,
wenn `psql` lokal nicht installiert ist.)

## 3. Migrationen verifizieren

Schema-Änderungen liegen als Migrationsdateien in `supabase/migrations/`. Verifiziert
wird mit einem **frischen** Aufbau, nicht inkrementell:

```bash
pnpm exec supabase db reset   # DB von Null, alle Migrationen in Reihenfolge
```

Warum `reset` und nicht `migration up`: ein Reset erwischt Probleme, die nur beim
Aufbau aus dem Nichts auftreten (z. B. ein Constraint, der mit Altdaten kollidiert
wäre). Hintergrund und Regeln → [migrations.md](./migrations.md).

## 4. Testdaten

- **Anlegen**: per SQL (Studio oder `psql`). Beispiel-Snippets stehen im
  jeweiligen Test-Leitfaden.
- **Aufräumen**: am einfachsten `pnpm exec supabase db reset` (wirft alle lokalen
  Daten weg und seedet neu). Gezieltes Löschen geht auch per SQL.
- Seed-Daten, die *immer* lokal da sein sollen, gehören nach `supabase/seed.sql`
  (läuft beim Reset mit, **nicht** auf Prod) — siehe [migrations.md](./migrations.md).

## 5. Nach dem Testen aufräumen

Wenn du fertig bist: Dev-Server stoppen (`Strg+C`), bei Bedarf `supabase stop`
(hält das Stack an, Daten bleiben) oder `supabase db reset` (Daten weg). So
sammeln sich keine laufenden Prozesse und kein Testmüll an.

## Checkliste vor dem Commit/PR

- [ ] `pnpm build` grün (inkl. Typecheck)
- [ ] `pnpm lint` grün
- [ ] Bei Schema-Änderung: `pnpm exec supabase db reset` läuft sauber durch
- [ ] Betroffenen Flow einmal manuell durchgeklickt (über `127.0.0.1`)
- [ ] Branch-Report unter [../reports/](../reports/) angelegt (siehe
      [reports/README.md](../reports/README.md))
