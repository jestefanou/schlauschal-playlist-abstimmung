---
title: "CI: E2E-Lauf reparieren + Aggregat-Gate für Branch-Protection"
branch: ci/fix-e2e-env-and-gate
base: main
pr: "#7"
status: merged
date: 2026-05-31
authors: [jstefano]
backfilled: 2026-06-06
related:
  - .github/workflows/ci.yml
---

# CI: E2E-Lauf reparieren + Aggregat-Gate für Branch-Protection

> **Nachgetragen am 2026-06-06.** Der Branch wurde am 2026-05-31 ohne Report nach
> `main` gemergt (PR #7); die fehlende Datei fiel beim Report-Hygiene-Check auf
> (siehe [2026-06-06_report-pr-status-hygiene.md](2026-06-06_report-pr-status-hygiene.md)).
> Dieser Report ist **nachträglich** aus PR #7, Commit `198f962` und dessen Diff
> rekonstruiert — **keine Spekulation**. `date`/Dateiname bilden das Merge-Datum ab
> (Konvention); Felder, die sich nicht aus diesen Quellen belegen lassen, sind unten
> ausdrücklich als „nicht dokumentiert" gekennzeichnet.

## TL;DR

Der E2E-Job der CI scheiterte mit `Invalid supabaseUrl: Must be a valid HTTP or HTTPS
URL`. Ursache: `supabase status -o env` gibt `KEY="value"` **mit** Anführungszeichen
aus; beim Anhängen an `$GITHUB_ENV` blieben die Quotes Teil des Werts. Fix: die Werte
werden jetzt in eine `.env.local` geschrieben, deren Quotes sowohl Next (Build) als auch
`process.loadEnvFile` (Test-Prozess) strippen — identisch zum lokalen Lauf. Zusätzlich
kam ein Aggregat-Job `ci-success` hinzu, der als **einziger Required-Check** für die
Branch-Protection taugt und übersprungene gated Jobs nicht als Fehler wertet. Eine Datei
geändert (`.github/workflows/ci.yml`, +31/−3).

## Problem & Kontext

Nach dem Aufsetzen des Test-Frameworks (PR #6) lief der E2E-Job in GitHub Actions rot:
`Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL`. Lokal trat das nicht auf, weil
Next dort `.env.local` liest und die Anführungszeichen entfernt. Parallel fehlte ein
stabiler einzelner Required-Check, an dem sich eine Branch-Protection festmachen lässt,
ohne dass die nur bedingt laufenden DB-/E2E-Jobs PRs blockieren, in denen sie übersprungen
werden.

## Branch- & Commit-Historie

- Abzweig von `main`.
- Ein Commit: `198f962` — „ci: E2E-Env-Fix (.env.local statt `$GITHUB_ENV`) + Aggregat-Gate".
- Gemergt als **PR #7** (Merge-Commit `54d82ce`) am 2026-05-31.

## Entscheidungen

| Entscheidung | Optionen | Gewählt & Warum |
| --- | --- | --- |
| Env-Übergabe an die Jobs | `>> $GITHUB_ENV` / `.env.local` schreiben | **`.env.local`** — Next und `process.loadEnvFile` strippen die von `supabase status -o env` gelieferten Quotes; `$GITHUB_ENV` übernähme sie literal (Ursache des `Invalid supabaseUrl`). |
| Lokale Stack-Keys in der CI | als Secrets hinterlegen / zur Laufzeit ableiten | **Zur Laufzeit ableiten** — die Keys sind keine Secrets, sondern werden von `supabase start` pro Lauf erzeugt. |
| Merge-Gate | jeden Job einzeln als Required-Check / ein Aggregat-Job | **Aggregat-Job `ci-success`** — ein einziger Required-Check, der übersprungene gated Jobs als ok wertet und nur bei echten Failures rot wird. |

## Geänderte Dateien

### Geändert
| Datei | Aufgabe der Datei | Was/Warum geändert | Wichtigste Symbole |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | GitHub-Actions-Pipeline | E2E-Step schreibt Stack-Keys statt nach `$GITHUB_ENV` jetzt in `.env.local` (Quote-Stripping wie lokal); neuer Aggregat-Job für die Branch-Protection | Step „.env.local aus dem lokalen Stack erzeugen"; Job `ci-success` |

## Architektur & Flows

**E2E-Env (vorher → nachher):** `supabase status -o env … >> "$GITHUB_ENV"` → `… > .env.local`.
Die `--override-name`-Mappings (`api.url=NEXT_PUBLIC_SUPABASE_URL`,
`auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`auth.secret_key=SUPABASE_SECRET_KEY`) bleiben unverändert; nur das Ziel der Umleitung
wechselt, damit die Quotes beim Einlesen entfernt werden.

**`ci-success` (neu):** läuft mit `if: always()` und `needs: [build-test, changes, db-tests, e2e]`.
Logik laut Diff:
- Pflicht-Jobs `build-test` und `changes` müssen `success` sein, sonst `exit 1`.
- Gated Jobs `db-tests` und `e2e`: `success` **oder** `skipped` sind ok; `failure`/`cancelled`
  blockt.

So kann anschließend eine Branch-Protection mit genau einem Required-Check (`ci-success`)
eingerichtet werden, ohne dass übersprungene DB-/E2E-Jobs Merges blockieren.

## Tests & Verifikation

Verifikation erfolgte über den CI-Lauf des PRs selbst — der zuvor rote E2E-Job war Anlass
des Branches; der PR wurde anschließend gemergt. Über den hier rekonstruierten Diff und die
PR-Beschreibung hinaus liegen **keine weiteren Verifikationsnotizen vor** (Report nachträglich
erstellt).

## Risiken, Rollback & Auswirkungen

Reine CI-Konfiguration, kein Anwendungs-Code und kein Schema betroffen. Die in der CI
erzeugte `.env.local` enthält ausschließlich pro Lauf von `supabase start` generierte lokale
Stack-Keys (keine echten Secrets). Rollback = Revert des PRs.

## Offene Punkte / Follow-ups

Aus PR #7 selbst keine dokumentiert. Das mit diesem Branch ermöglichte Einrichten der
Branch-Protection (Required-Check `ci-success`) ist eine GitHub-Einstellung außerhalb des
Repos und in PR #7 nicht weiter belegt.

## Zusammenfassung

PR #7 reparierte den fehlgeschlagenen E2E-Job, indem die lokalen Supabase-Stack-Keys statt
nach `$GITHUB_ENV` in eine `.env.local` geschrieben werden — dadurch werden die von
`supabase status -o env` gelieferten Anführungszeichen beim Einlesen entfernt und der Build
erhält eine gültige `NEXT_PUBLIC_SUPABASE_URL`. Zusätzlich führte der Branch den Aggregat-Job
`ci-success` ein, der als einziger Required-Check für eine Branch-Protection dient und
übersprungene gated Jobs nicht als Fehler zählt. Geändert wurde ausschließlich
`.github/workflows/ci.yml`.
