<!--
  Kurz-Checkliste für PRs. Der ausführliche Kontext gehört in den Branch-Report
  unter docs/reports/ (siehe docs/reports/README.md) — hier nur das Nötigste.
-->

## Was & Warum

<!-- 1–3 Sätze. Details → Branch-Report verlinken. -->

Branch-Report: `docs/reports/YYYY-MM-DD_<branch>.md`

## Checkliste

- [ ] `pnpm build` + `pnpm lint` grün
- [ ] Bei Schema-Änderung: `supabase db reset` läuft sauber durch
- [ ] Betroffenen Flow lokal getestet (über `127.0.0.1`)
- [ ] Branch-Report unter `docs/reports/` angelegt
