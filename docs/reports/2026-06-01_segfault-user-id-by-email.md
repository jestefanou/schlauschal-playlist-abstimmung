---
title: "Segfault-Untersuchung: user_id_by_email crasht Postgres (supautils-Bug)"
branch: investigate/segfault-user-id-by-email
base: main
pr: "#8"
status: merged
date: 2026-06-01
authors: [jstefano]
related:
  - supabase/migrations/20260530142419_auth_user_lookup_rpc.sql
  - docs/reports/2026-05-31_test-setup.md
  - https://github.com/supabase/supautils/issues/196
  - https://github.com/supabase/supautils/issues/200
  - https://github.com/supabase/supautils/pull/190
---

# Segfault-Untersuchung: `user_id_by_email` crasht Postgres (supautils-Bug)

## TL;DR

Ein Aufruf von `public.user_id_by_email(text)` durch die Rolle `authenticated`
(EXECUTE entzogen) bringt den Postgres-Backend-Prozess mit **signal 11 (SIGSEGV)**
zum Absturz — ein instanzweiter Crash mit Auto-Recovery, statt eines sauberen
`permission denied`-Fehlers. Ursache ist eine **NULL-Pointer-Dereferenzierung in
`supautils_executor_start`** (Supabase-eigene Extension), nicht unser Code. Der
Fehler ist **upstream bereits behoben** (supautils `v3.2.2`, PR #190, 2026-04-28);
unser lokales Image `17.6.1.106` bündelt nur ein älteres `supautils 3.2.0`. **Keine
Code-/Schema-Änderung nötig** — Entscheidung: dokumentieren, tracken, und vor dem
Deployment (Schritt 8) sicherstellen, dass das Prod-Image `supautils ≥ v3.2.2`
mitbringt.

## Problem & Kontext

Beim Aufsetzen der pgTAP-RLS-Tests (Branch `chore/test-setup`, siehe
[2026-05-31_test-setup.md](2026-05-31_test-setup.md)) fiel auf, dass ein Aufruf der
Lookup-Funktion durch `authenticated` die gesamte lokale Datenbank-Instanz
abstürzen lässt. Da das auslösende Muster (`REVOKE EXECUTE` von `anon`/
`authenticated`, nur `service_role` darf ausführen) exakt die von Supabase
**empfohlene** Härtung ist und die Funktion im `public`-Schema (PostgREST-exponiert)
liegt, bestand der Verdacht auf einen generisch über die REST-API auslösbaren
Denial-of-Service. Der User wollte das gründlich und belastbar untersucht haben:
minimaler Repro, exakte Versionen, Reichweite, Prod-Betroffenheit, fundierter
Bug-Report und eine Mitigations-Entscheidung.

## Vorgehen (Untersuchung statt Feature-Branch)

Dieser Branch enthält **keine Code-Änderung** — er dokumentiert eine Untersuchung.
Ablauf:

1. **Forensik** (read-only): exakte Versionen, geladene Extensions, Funktionsdefinition + ACL.
2. **Repro** auf unserem Image `17.6.1.106` bestätigt (bewusster Instanz-Crash auf der lokalen Wegwerf-DB).
3. **Backtrace** via gdb (an einen wartenden Backend angehängt, Crash ausgelöst).
4. **Prior-Art-Recherche** (GitHub, Postgres-Listen, Foren) + skeptische Quellenprüfung.
5. **Timeline-/Fix-Status-Analyse** (Quellcode + Releases + Image-Pins).

## Entscheidungen

| Entscheidung | Optionen | Gewählt & Warum |
| --- | --- | --- |
| Prod-Reichweite nachweisen | Versions-Abgleich / Wegwerf-Cloud-Instanz | **Erst Abgleich** — supautils steckt in jedem Supabase-Image; direkter Cloud-Beweis unnötig, da Mechanismus und Fix-Status eindeutig. |
| Analyse-Tiefe | Repro+Logs / C-Backtrace | **Backtrace** — fehlte allen Upstream-Issues; lieferte den harten NULL-Deref-Beweis. |
| Mitigation | privates Schema+direkte Verbindung / Config / leichtgewichtig | **Leichtgewichtig** — Bug ist upstream gefixt, wir sind nicht deployed → schwere Umbauten am Auth-Pfad wären überdimensioniert. |
| Upstream-Meldung | an #200 kommentieren / eigenes Issue / nichts | **Nichts** — Maintainer hat #200 als Duplikat geschlossen und den Fix bestätigt; ein Kommentar wäre redundant. |

## Befunde

### Umgebung

| | |
| --- | --- |
| PostgreSQL | 17.6 (`170006`) |
| Image (lokal) | `public.ecr.aws/supabase/postgres:17.6.1.106` (aarch64 / Apple Silicon) |
| PostgREST | `v14.10`, exponierte Schemas: `public`, `graphql_public` |
| `session_preload_libraries` | **`supautils`** |
| `shared_preload_libraries` | `pgaudit, plan_filter, pgsodium, auto_explain, pg_net, pg_cron, pg_tle, supabase_vault, …` |
| Funktion | `public.user_id_by_email(text)`: `SECURITY DEFINER`, `STABLE`, `SET search_path=public,auth`, ACL `{postgres, service_role}` |

### Repro (auf `.106` bestätigt)

```sql
set role authenticated;
select public.user_id_by_email('x@y.z');   -- server process terminated by signal 11
```
Server-Log:
```
server process (PID 19837) was terminated by signal 11: Segmentation fault
DETAIL:  Failed process was running: set role authenticated; select public.user_id_by_email('x@y.z');
LOG:  terminating any other active server processes
LOG:  database system was not properly shut down; automatic recovery in progress
```
Reproduziert auch mit einer trivialen Funktion (`create function public.t() returns int language sql as 'select 1'; revoke execute … from anon;`) als `anon` — hängt also **nicht** an unserer Funktion oder an SECURITY DEFINER, sondern am Permission-Denied-Pfad.

### Backtrace (gdb, erster echter Trace zu diesem Bug)

```
#0  quote_identifier ()           ; ldrb w1,[x0] mit x0 = 0x0  → NULL-Deref (si_addr = 0x0)
#1  quote_qualified_identifier ()
#2  supautils_executor_start ()   ; aus .../supautils.so
#3  PortalStart ()
#4  exec_simple_query ()
```

### Mechanismus

`supautils_executor_start` fängt für Rollen aus `supautils.hint_roles` (Default:
`anon, authenticated, service_role`) den `42501`-Fehler ab, um einen GRANT-Hinweis
anzuhängen. Für eine **Funktion** liefert `find_missing_perm()` (das nur
Relations-`permInfos` prüft) `relid = InvalidOid`. Im Code **vor PR #190** wurde der
Hinweis ungeprüft gebaut — `get_rel_name(InvalidOid)` / `get_namespace_name(...)`
liefern `NULL`, und `quote_qualified_identifier(NULL, NULL)` → `quote_identifier(NULL)`
dereferenziert NULL → SIGSEGV, **bevor** der eigentliche Fehler ausgeliefert wird.
(Das alte `Assert(missing.relid != InvalidOid)` ist in Release-Builds wirkungslos.)

### Prior-Art & Fix-Status

- **PR #190** (merged 2026-04-28, Release **`v3.2.2`**) ersetzt den ungeprüften Pfad durch
  `if (missing.acl != 0 && OidIsValid(missing.relid) && …) { … if (relname != NULL) … }`
  → für Funktions-/Schema-Fehler wird der Hinweis übersprungen, der `42501` sauber
  geworfen, **kein Crash**.
- **Issues #196 / #200** (von Dritten, nicht von uns) meldeten den Crash und deuteten
  die PR-Notiz „doesn't add the missing *functionality* for functions, schemas" als
  „ungefixt" — gemeint war aber nur „kein GRANT-*Hinweis* für diese Fälle".
- **Maintainer-Bestätigung:** steve-chavez schloss **#200 als Duplikat** mit
  „This was already fixed" (→ #196 → PR #190 → `v3.2.2`).
- **Image-Pin-Abgleich:** `supabase/postgres` pinnt supautils inzwischen auf `3.2.2`
  (verifiziert am aktuellen Tag `17.6.1.133`). **Unser `.106` pinnt `3.2.0`** (vor dem
  Fix) — das erklärt den Crash vollständig als reine Versions-Lücke.

## Reichweite / Impact

- **Generisch:** Auf jeder Supabase-17.6.x-Instanz mit supautils `< v3.2.2` kann ein
  Aufruf einer über `/rest/v1/rpc/` erreichbaren `public`-Funktion durch eine
  `hint_role` ohne EXECUTE die Instanz kurz lahmlegen (PostgREST wechselt per
  `SET ROLE` auf die JWT-Rolle). Da das auslösende Muster die empfohlene Härtung ist,
  war der Kreis potenziell betroffener Projekte groß.
- **Für uns konkret:** **Noch nicht deployed → kein Live-Risiko.** Lokal auslösbar,
  aber unkritisch (Wegwerf-DB, Auto-Recovery). Der App-Auth-Flow selbst ist nie
  betroffen (Server Action ruft die RPC als `service_role`, hat EXECUTE).

## Datenbank / Migrationen

Keine. Die bestehende Migration
[`20260530142419_auth_user_lookup_rpc.sql`](../../supabase/migrations/20260530142419_auth_user_lookup_rpc.sql)
bleibt unverändert; das Muster ist korrekt und Supabase-konform.

## Tests & Verifikation

- Crash auf `17.6.1.106` reproduziert und Log gesichert.
- Backtrace via gdb erzeugt: NULL-Deref (`x0 = 0`, `si_addr = 0`) in `quote_identifier`,
  aufgerufen aus `supautils_executor_start`.
- Versions-Pins gegengeprüft: `.106 → supautils 3.2.0`, aktuelles `.133 → 3.2.2`.
- Test-Guard unverändert wirksam: `supabase/tests/020-rls.test.sql` ruft die Funktion
  **nicht** auf, sondern prüft nur `has_function_privilege(... , 'execute') = false`.
- Aufgeräumt: Probe-Funktion + Temp-Skript entfernt, DB-Zustand verifiziert.

## Risiken, Rollback & Auswirkungen

Keine — diese Arbeit ändert keinen Produktions-Code und kein Schema. Der einzige
Handlungspunkt ist organisatorisch (Image-Version vor Deploy prüfen).

## Offene Punkte / Follow-ups

- **Vor Schritt 8 (Deployment):** sicherstellen, dass das Prod-/Build-Image
  `supautils ≥ v3.2.2` bündelt (aktuelle `supabase/postgres`-Images erfüllen das).
  Damit ist der DoS-Vektor restlos zu.
- **Optional (Komfort):** lokales Dev-Image auf einen Tag mit `supautils ≥ v3.2.2`
  bumpen; danach könnte ein positiver pgTAP-Test ergänzt werden (Aufruf durch
  `authenticated` liefert sauberen `42501` statt Crash).
- **Kein Upstream-Post** (Issue ist gelöst/geschlossen).

## Zusammenfassung

Der beim Test-Setup entdeckte Postgres-Segfault wurde vollständig aufgeklärt: Ein
Aufruf einer `public`-Funktion durch eine `hint_role` ohne EXECUTE läuft in eine
NULL-Pointer-Dereferenzierung in Supabase' `supautils`-Extension
(`supautils_executor_start` → `quote_qualified_identifier` → `quote_identifier(NULL)`),
die den Backend-Prozess vor der eigentlichen Fehlermeldung mit signal 11 abstürzen
lässt. Forensik, ein minimaler Repro auf unserem Image `17.6.1.106` und ein
gdb-Backtrace belegen den Mechanismus hart; die Recherche zeigte zwei unabhängige
Fremd-Reports (#196/#200) und — entscheidend — dass der Fehler bereits mit
`supautils v3.2.2` (PR #190, 2026-04-28) behoben ist, was der Maintainer mit dem
Schließen von #200 bestätigte. Unser lokales Image hängt lediglich auf der älteren
Version `3.2.0` fest; aktuelle Images bündeln `3.2.2`. Da unser Code dem empfohlenen
Muster folgt, das Problem upstream gelöst ist und die App noch nicht deployed ist,
fällt die Entscheidung auf den proportionalen Abschluss: dokumentieren, tracken und
vor dem Go-Live die Image-Version verifizieren — ohne Eingriff in den getesteten
Auth-Pfad.
