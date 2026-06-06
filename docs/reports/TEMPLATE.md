<!--
  Vorlage für Branch-Reports. Kopieren nach:
    docs/reports/YYYY-MM-DD_<branch-slug>.md
  Nicht zutreffende Abschnitte ("Datenbank/Migrationen", "Gelöscht" …) dürfen
  entfallen — dann den Abschnitt ganz weglassen, keine leeren Überschriften.
  Konvention & Beispiel: docs/reports/README.md

  Frontmatter pr/status:
    pr     — VOR dem Commit füllen mit der voraussichtlichen PR-Nummer
             (= höchste vorhandene PR-/Issue-Nummer + 1, via
             `gh pr list --state all --limit 1 --json number`). Nie "—"/leer.
    status — draft (Report entsteht) → open (PR offen) → merged (in main).
             Nach dem Merge auf `merged` setzen; passiert das nicht sofort,
             zieht der Session-Start-Check es nach (siehe docs/reports/README.md).
-->
---
title: <aussagekräftiger Titel>
branch: <branch-name>
base: main
pr: "#<nr>"
status: draft | open | merged
date: <YYYY-MM-DD>
authors: [<name>]
related:
  - <pfad oder link>
---

# <Titel>

## TL;DR
<!-- 2–4 Sätze: Problem → was gemacht → Ergebnis. -->

## Problem & Kontext
<!-- Warum gibt es diesen Branch? Welches Problem/Ziel/Risiko. -->

## Branch- & Commit-Historie
<!-- Abzweigpunkt (von welchem Commit/Tag), Commits chronologisch
     (`hash` — subject), PR-Nummer. -->

## Entscheidungen
<!-- Die nicht-offensichtlichen Weichenstellungen. Weglassen, wenn es keine gab. -->
| Entscheidung | Optionen | Gewählt & Warum |
| --- | --- | --- |
| | | |

## Geänderte Dateien

### Neu
| Datei | Aufgabe der Datei | Begründung | Wichtigste Symbole |
| --- | --- | --- | --- |
| | | | |

### Geändert
| Datei | Aufgabe der Datei | Was/Warum geändert | Wichtigste Symbole |
| --- | --- | --- | --- |
| | | | |

### Gelöscht
| Datei | War zuständig für | Warum entfernt |
| --- | --- | --- |
| | | |

## Architektur & Flows
<!-- Relevante Abläufe. Wenn sinnvoll vorher → nachher.
     Diagramme als Mermaid (```mermaid … ```), nicht als ASCII-Art. -->

## Datenbank / Migrationen
<!-- Nur wenn zutreffend: neue Migration(en), reversibel?, Auswirkung lokal/Prod. -->

## Tests & Verifikation
<!-- Was getestet, wie, mit welchem Ergebnis (build/lint/db reset/manuell/E2E). -->

## Risiken, Rollback & Auswirkungen
<!-- Was könnte brechen, wie zurückrollen, Breaking Changes, betroffene Bereiche. -->

## Offene Punkte / Follow-ups
<!-- Bewusst Verschobenes, nächste Schritte, Links zu Folge-Branches/Issues. -->

## Zusammenfassung
<!-- Zusammenhängender Fließtext über den ganzen Branch — auch ohne die Tabellen
     verständlich. -->
