# Branch-Reports

Pro Branch, der nach `main` gemergt wird, liegt hier **ein Report**, der
festhält, was im Branch passiert ist — gedacht als Nachschlagewerk für Menschen
**und** KI-Agents, die später verstehen wollen, *warum* etwas so ist.

## Konvention

- **Wann:** Der Report wird **vor dem Merge** angelegt (Teil des Branches, im
  selben PR). Ein PR ohne Report gilt als unvollständig.
- **Wo / Dateiname:** `docs/reports/YYYY-MM-DD_<branch-slug>.md`
  (Datum = Merge-/Fertigstellungsdatum, Slug = Branchname ohne `feat/`/`chore/`-Präfix).
  Beispiel: `2026-05-30_auth-followups.md`.
- **Wie:** [TEMPLATE.md](./TEMPLATE.md) kopieren und ausfüllen. Nicht zutreffende
  Abschnitte ganz weglassen.

## Wichtig: Reports sind Momentaufnahmen

Ein Report beschreibt den Stand **zum Zeitpunkt seines Branches**. Spätere
Refactorings können Dateien verschieben oder umbenennen — die Pfade in alten
Reports werden dann nicht nachgezogen. Im Zweifel gilt die Datums-/Branch-Angabe
im Frontmatter als Kontext.

## Aufbau (Kurzform)

Frontmatter (maschinenlesbar: `branch`, `base`, `pr`, `status`, `date`,
`authors`, `related`) + Abschnitte: TL;DR · Problem & Kontext · Branch-/Commit-
Historie · Entscheidungen · Geänderte Dateien (neu/geändert/gelöscht) ·
Architektur & Flows · Datenbank/Migrationen · Tests & Verifikation · Risiken &
Rollback · Offene Punkte · Zusammenfassung.

Details in der [Vorlage](./TEMPLATE.md). Gutes Beispiel:
[2026-05-30_auth-followups.md](./2026-05-30_auth-followups.md).
