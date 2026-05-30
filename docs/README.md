# Dokumentation

Wegweiser durch die Projekt-Doku. Verbindliche Agent-Direktiven stehen in
[../AGENTS.md](../AGENTS.md), der aktuelle Arbeitsstand im (lokalen)
`PROJECT_PLAN.md`.

## Struktur

```
docs/
  setup/      Erstaufsetzen der lokalen Umgebung
  guides/     Wie-mache-ich-X (Arbeitsabläufe)
  reports/    Was-wurde-in-Branch-X-gemacht (pro Merge ein Report)
```

## Inhalt

### Setup
- [setup/getting-started.md](./setup/getting-started.md) — lokale Umgebung aufsetzen
  (Voraussetzungen, Supabase-Stack, Env, Troubleshooting)

### Guides
- [guides/testing.md](./guides/testing.md) — allgemeiner Test-Leitfaden
  (statische Checks, lokales E2E, Migrations-Verifikation)
- [guides/auth-testing.md](./guides/auth-testing.md) — Login-/Auth-Flow manuell durchspielen
- [guides/migrations.md](./guides/migrations.md) — Schema-Änderungen sicher nach Prod bringen

### Reports
- [reports/README.md](./reports/README.md) — Konvention für Branch-Reports + [Vorlage](./reports/TEMPLATE.md)
