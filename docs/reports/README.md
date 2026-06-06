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
- **`pr` schon vor dem Commit eintragen:** Die PR-Nummer steht zwar erst nach dem
  Öffnen des PRs fest, ist aber vorhersagbar — sie ist die **höchste vorhandene
  PR-/Issue-Nummer + 1**. Ermitteln mit `gh pr list --state all --limit 1 --json number`
  (bei vorhandenen Issues auch `gh issue list …` prüfen, GitHub teilt den Zähler) und
  als `pr: "#<n>"` eintragen. **Nie `—` oder leer committen.** Best-effort: kommt etwas
  dazwischen, fängt der Pflege-Check (unten) die Drift ab.
- **`status` als Lebenszyklus:** `draft` (Report entsteht) → `open` (PR offen, noch
  nicht gemergt) → `merged` (in `main`). Nach dem Merge auf `merged` setzen.

## Pflege: PR-Nummer & Status nachziehen (Session-Start)

Weil der Merge in GitHub oft **erst in einer späteren Session** passiert, bleibt
`status` sonst auf `open` hängen und eine vorhergesagte `pr`-Nummer kann driften.
Deshalb **bei jedem Session-Start kurz prüfen** (Aufgabe steht auch im
`PROJECT_PLAN.md`):

1. Gemergte PRs auflisten: `gh pr list --state all --json number,headRefName,state`.
2. Für jeden Report den `branch` aus dem Frontmatter dem PR zuordnen.
3. Wo `pr` fehlt/falsch ist → korrekte Nummer eintragen; wo der PR `MERGED` ist,
   aber `status` noch `open`/`draft` → auf `merged` setzen.

So bleibt das Frontmatter maschinenlesbar korrekt, ohne dass jemand den Merge-Moment
abpassen muss.

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
