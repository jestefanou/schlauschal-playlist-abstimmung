# Migrations-Workflow

Wie wir Datenbankänderungen sicher von lokal nach Production bekommen.

## Die drei Umgebungen

```
┌─────────────────┐       ┌─────────────────┐
│   LOCAL DEV     │       │   PRODUCTION    │
│  (Docker)       │       │  (live Projekt) │
├─────────────────┤       ├─────────────────┤
│ supabase start  │       │ Schlauchschal-  │
│ frei zum        │       │ Projekt auf     │
│ Kaputtmachen    │       │ supabase.com    │
└─────────────────┘       └─────────────────┘
```

Preview-Branches per PR gibt's bei Supabase nur im Pro-Plan — für uns nicht relevant.

## Wie Production aktualisiert wird

Die **GitHub-Integration** im Supabase-Dashboard überwacht den Pfad `supabase/migrations/` im verknüpften Repo. Das Verhalten hängt an einem einzigen Toggle:

| „Deploy to production" | Verhalten |
| --- | --- |
| **OFF** | Verbindung besteht, aber nichts passiert automatisch. |
| **ON** | Bei jedem Push auf `main` werden neue Migrations automatisch auf die Production-DB angewendet. |

Aktueller Stand: Toggle ist OFF. Wir aktivieren ihn bewusst in Schritt 8 (Deployment), nachdem wir einmal manuell gepusht haben und sicher sind, dass der Flow funktioniert.

## Daily Pattern (sobald Auto-Deploy an ist)

```
1.  git checkout -b feat/<beschreibung>
2.  pnpm exec supabase migration new <was_passiert>
       → supabase/migrations/<timestamp>_<was_passiert>.sql
3.  SQL schreiben
4.  pnpm exec supabase db reset
       → lokale DB wird neu aufgebaut, neue Migration läuft mit
5.  Code anpassen, manuell testen
6.  git add + commit + push
7.  PR auf main öffnen, reviewen (Self-Review zählt)
8.  Merge → GitHub-Integration applied die Migration auf Prod
```

## Die zwei goldenen Regeln

### 1. Migrations sind immutable nach dem Merge

Sobald eine Migration in `main` ist und auf Prod angewendet wurde: **nie wieder editieren**. Korrekturen kommen als *neue* Migration.

**Warum:** Supabase trackt pro DB einen Hash über jede applied Migration. Wenn du eine alte Migration nachträglich änderst, weicht der Hash ab und der nächste `db push` schlägt mit „migration history out of sync" fehl. Das Reparieren über `supabase migration repair` ist unangenehm.

**Faustregel:** Wurde der Branch gemergt? → nie wieder anfassen, nur dazuschreiben.

### 2. Testen mit `db reset`, nicht mit `migration up`

`pnpm exec supabase db reset` baut die lokale DB von Null auf und appliziert *alle* Migrations in Reihenfolge. Das erwischt Probleme, die nur beim frischen Setup auftreten — z.B. einen neuen Constraint, der mit alten Daten kollidieren würde, oder eine Migration, die fälschlicherweise von Live-Daten ausgeht.

`migration up` appliziert nur die noch nicht applied'ten — kann solche Probleme verstecken.

## Stolperfallen

**Timestamps müssen aufsteigend bleiben**
Wenn jemand parallel eine Migration mergt, kann sie im Timestamp zwischen deinen rutschen. Lösung: `git pull`, eigene Migration umbenennen (Timestamp nach hinten), `db reset` zum Testen, neu committen.

**Nie via Supabase-Dashboard auf Prod schrauben**
Tabelle im Studio anlegen, Spalte im Table-Editor ändern — alles auf Prod direkt **verboten**. Diese Änderungen sind nicht im Migration-History und der nächste `db push` knallt. Wenn doch passiert: `supabase db pull` zieht den Remote-Stand als neue Migration in den Code; committen.

**Seed-Data gehört NICHT in Migrations**
- Tabellen, Constraints, Trigger, Functions → in Migrations
- Test-User, Demo-Songs, Fixtures → in `supabase/seed.sql` (wird beim lokalen `db reset` eingespielt, läuft NICHT auf Prod)
- Echte Stammdaten (z.B. `admin_bootstrap_emails`) → doch in Migration, weil sie auf Prod sein müssen

**Migration für Daten, die nur auf Prod existieren**
Wenn du Daten migrieren musst, die nur auf Prod existieren (z.B. ein `UPDATE`, der eine alte Spalte in eine neue umkopiert), läuft die Migration lokal evtl. „leer" — das ist okay. Wichtig: idempotent schreiben, damit ein erneuter Lauf nichts kaputt macht.

## Stand checken

```bash
pnpm exec supabase migration list   # lokale vs. remote Stände
pnpm exec supabase db diff          # Hat lokal jemand das Schema verändert ohne Migration?
```

## Wenn doch was schiefgeht

`supabase migration repair --status applied <timestamp>` markiert eine Migration als „bereits angewendet", ohne sie nochmal zu fahren — z.B. nach manuellen Eingriffen.
`supabase migration repair --status reverted <timestamp>` markiert sie als „nicht angewendet".

**Wichtig:** `repair` ändert nur die Tracking-Tabelle, kein SQL. Vorher genau wissen, was der echte Zustand der DB ist.
