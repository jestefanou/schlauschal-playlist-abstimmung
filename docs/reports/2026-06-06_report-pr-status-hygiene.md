---
title: Report-Hygiene — PR-Nummer & Status im Frontmatter zuverlässig pflegen
branch: chore/report-pr-status-hygiene
base: main
pr: "#9"
status: open
date: 2026-06-06
authors: [jstefano]
related:
  - docs/reports/README.md
  - docs/reports/TEMPLATE.md
  - AGENTS.md
---

# Report-Hygiene — PR-Nummer & Status im Frontmatter zuverlässig pflegen

## TL;DR

Beim Segfault-Report (#8) fehlte die PR-Nummer (`pr: "—"`), und **alle vier**
bisherigen Reports standen trotz Merge noch auf `status: open` — den Status flippte
niemand. Ursache: Die Konvention sagte nicht, dass die PR-Nummer schon vor dem Commit
vorhergesagt und `status` nach dem Merge auf `merged` gezogen wird. Dieser Branch
backfillt die vier Reports und verankert beide Regeln in `README.md`, `TEMPLATE.md`
und `AGENTS.md` — inklusive eines wiederkehrenden Session-Start-Checks, der künftige
Drift abfängt.

## Problem & Kontext

Das Frontmatter der Reports ist als maschinenlesbarer Index gedacht (`pr`, `status`).
Zwei Lücken machten es unzuverlässig:

1. **`pr` fehlte**, wenn der Report angelegt wurde, bevor der PR existierte — beim
   Segfault-Report blieb es bei `—`.
2. **`status` blieb auf `open`**, weil der Merge in GitHub oft erst in einer späteren
   Session passiert und niemand zurückkam, um den Status zu ziehen. Betroffen: PRs
   #4, #5, #6, #8.

## Entscheidungen

| Entscheidung | Optionen | Gewählt & Warum |
| --- | --- | --- |
| PR-Nummer im Report | erst nach PR-Erstellung / vor dem Commit vorhersagen | **Vorhersagen** — die nächste Nummer = höchste PR/Issue + 1, via `gh` ermittelbar. So ist das Feld nie leer; Drift fängt der Session-Check ab. |
| Status-Pflege | manuell beim Merge / Session-Start-Check | **Session-Start-Check** — der Merge passiert per Hand in GitHub, oft sessionübergreifend; ein wiederkehrender Abgleich (`gh pr list`) ist robuster als auf den Merge-Moment zu hoffen. |
| Backfill-Umfang | nur Segfault / alle Reports | **Alle** — der `open`-Hänger betraf jeden bisherigen Report, nicht nur #8. |

## Geänderte Dateien

### Geändert
| Datei | Aufgabe der Datei | Was/Warum geändert |
| --- | --- | --- |
| `docs/reports/2026-05-30_auth-followups.md` | Report PR #4 | `status: open → merged` |
| `docs/reports/2026-05-30_docs-structure.md` | Report PR #5 | `status: open → merged` |
| `docs/reports/2026-05-31_test-setup.md` | Report PR #6 | `status: open → merged` |
| `docs/reports/2026-06-01_segfault-user-id-by-email.md` | Report PR #8 | `pr: "—" → "#8"`, `status: open → merged` |
| `docs/reports/README.md` | Konvention | `pr`-Vorhersage-Regel, `status`-Lebenszyklus, neue Sektion „Pflege: PR-Nummer & Status nachziehen (Session-Start)" |
| `docs/reports/TEMPLATE.md` | Vorlage | Leitkommentar zu `pr`/`status` im Frontmatter |
| `AGENTS.md` | Agent-Regeln | Abschnitt „Branch-Reports" um Frontmatter-Pflege (`pr` vor Commit, `status`-Nachzug, Session-Start-Check) ergänzt |

### Neu
| Datei | Aufgabe der Datei | Begründung |
| --- | --- | --- |
| `docs/reports/2026-06-06_report-pr-status-hygiene.md` | dieser Report | dogfooded die neue Regel: `pr: "#9"` vor dem Commit, `status: open` bis zum Merge |
| `docs/reports/2026-05-31_fix-e2e-env-and-gate.md` | nachgetragener Report für PR #7 | schließt die Report-Lücke aus dem Nebenbefund; aus PR #7 + Commit `198f962` rekonstruiert, als nachgetragen markiert |

Hinweis: `PROJECT_PLAN.md` (gitignored) wurde zusätzlich um den wiederkehrenden
Report-Hygiene-Check in „Wie nächste Session starten" ergänzt — nicht Teil dieses PRs.

## Tests & Verifikation

- Branch→PR-Mapping gegen `gh pr list --state all` geprüft; alle Backfill-Werte
  (#4/#5/#6 = merged, #8 = `pr #8` + merged) stimmen mit GitHub überein.
- Vorhersage-Methode verifiziert: höchste PR = #8, kein offenes Issue → nächste
  Nummer #9 (= dieser Branch).
- Reiner Doku-/Frontmatter-Change: kein Build/Schema betroffen.

## Risiken, Rollback & Auswirkungen

Keine Code-/Schema-Auswirkung. Die PR-Vorhersage ist best-effort — würde zwischen
Report-Commit und PR-Erstellung ein Issue eröffnet, verschöbe sich die Nummer; genau
dafür ist der Session-Start-Check da. Rollback = Revert des PRs.

## Offene Punkte / Follow-ups

- **Erledigt (vormaliger Nebenbefund):** PR #7 (`ci/fix-e2e-env-and-gate`) hatte keinen
  Branch-Report. In diesem Branch nachgetragen als
  [2026-05-31_fix-e2e-env-and-gate.md](2026-05-31_fix-e2e-env-and-gate.md) — aus PR #7 +
  Commit `198f962` rekonstruiert und ausdrücklich als nachgetragen markiert. Damit hat
  jeder gemergte PR seit Einführung der Report-Konvention (#4–#8) einen Report; #1–#3
  (2026-05-17) entstanden davor und haben bewusst keinen.

## Zusammenfassung

Aus einem fehlenden PR-Eintrag wurde ein systematisches Konventions-Update: Die
PR-Nummer wird künftig vor dem Commit vorhergesagt und eingetragen, der `status`
durchläuft `draft → open → merged`, und ein wiederkehrender Session-Start-Check gleicht
das Frontmatter aller Reports gegen den tatsächlichen GitHub-Stand ab. Die vier
Alt-Reports sind entsprechend nachgezogen.
