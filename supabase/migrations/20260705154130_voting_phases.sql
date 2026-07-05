-- Sequentielle Phasen im Cycle: erst Nominierung, dann Abstimmung (Schritt 5).
-- Die Phase ergibt sich rein aus der Uhrzeit relativ zu cycles.voting_starts_at —
-- kein Phasen-Flip-Job nötig:
--   Nominierungsphase: starts_at <= now() < voting_starts_at
--   Abstimmungsphase:  voting_starts_at <= now() (bis der Cron den Cycle schließt)
-- Default-Aufteilung 4 Tage Nominierung + 3 Tage Abstimmung, pro Playlist
-- konfigurierbar über playlists.nomination_days.

-- ============================================================================
-- 1. Schema: playlists.nomination_days + cycles.voting_starts_at
-- ============================================================================

alter table public.playlists
  add column nomination_days integer not null default 4
    check (nomination_days >= 0);

comment on column public.playlists.nomination_days is
  'Länge der Nominierungsphase in Tagen ab Cycle-Start; danach beginnt die Abstimmungsphase. 0 = Abstimmung ab Cycle-Start.';

alter table public.cycles
  add column voting_starts_at timestamptz;

-- Backfill bestehender Cycles aus dem Playlist-Default, gedeckelt auf ends_at.
update public.cycles c
set voting_starts_at = least(
      c.starts_at + make_interval(days => p.nomination_days),
      c.ends_at
    )
from public.playlists p
where p.id = c.playlist_id
  and c.voting_starts_at is null;

alter table public.cycles
  alter column voting_starts_at set not null;

alter table public.cycles
  add constraint cycles_voting_window
    check (voting_starts_at >= starts_at and voting_starts_at <= ends_at);

comment on column public.cycles.voting_starts_at is
  'Phasengrenze: davor Nominierungsphase, ab hier Abstimmungsphase. Wird vom Trigger set_cycle_defaults aus playlists.nomination_days gefüllt, falls beim Insert nicht gesetzt.';

-- ============================================================================
-- 2. Trigger set_cycle_defaults: zusätzlich voting_starts_at füllen
--    (create or replace behält bestehende Grants/REVOKEs der Funktion bei)
-- ============================================================================

create or replace function public.set_cycle_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default integer;
  v_initial integer;
  v_nomination_days integer;
begin
  if new.winners_count is null or new.voting_starts_at is null then
    select default_winners_count, initial_winners_count, nomination_days
      into v_default, v_initial, v_nomination_days
    from public.playlists
    where id = new.playlist_id;
  end if;

  if new.winners_count is null then
    new.winners_count := case
      when new.is_initial then v_initial
      else v_default
    end;
  end if;

  if new.voting_starts_at is null then
    new.voting_starts_at := least(
      new.starts_at + make_interval(days => v_nomination_days),
      new.ends_at
    );
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 3. RLS: Phasen durchsetzen
-- ============================================================================

-- Nominieren nur in der Nominierungsphase eines offenen Cycles.
drop policy "nominations_insert_self" on public.song_nominations;
create policy "nominations_insert_self"
  on public.song_nominations for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and exists (
      select 1 from public.cycles c
      where c.id = cycle_id
        and c.status = 'open'
        and now() >= c.starts_at
        and now() < c.voting_starts_at
    )
  );

-- Zurücknehmen ebenfalls nur in der Nominierungsphase: ab Abstimmungsstart ist
-- die Kandidatenliste eingefroren (ein Delete würde per Cascade fremde Votes
-- löschen). Admins bleiben uneingeschränkt.
drop policy "nominations_delete_self_or_admin" on public.song_nominations;
create policy "nominations_delete_self_or_admin"
  on public.song_nominations for delete
  to authenticated
  using (
    (
      submitted_by = (select auth.uid())
      and exists (
        select 1 from public.cycles c
        where c.id = cycle_id
          and c.status = 'open'
          and now() < c.voting_starts_at
      )
    )
    or public.is_admin()
  );

-- Abstimmen nur in der Abstimmungsphase eines offenen Cycles.
drop policy "votes_insert_self" on public.votes;
create policy "votes_insert_self"
  on public.votes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.song_nominations sn
      join public.cycles c on c.id = sn.cycle_id
      where sn.id = nomination_id
        and c.status = 'open'
        and now() >= c.voting_starts_at
    )
  );

-- Härtung: Stimme zurückziehen nur im selben Fenster, in dem sie abgegeben
-- werden kann. Vorher blockte nur user_id = auth.uid() — eine Stimme war damit
-- auch nach Cycle-Schluss (vor/nach Auswertung) per API löschbar und hätte
-- cycle_winners inkonsistent gemacht.
drop policy "votes_delete_self" on public.votes;
create policy "votes_delete_self"
  on public.votes for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.song_nominations sn
      join public.cycles c on c.id = sn.cycle_id
      where sn.id = nomination_id
        and c.status = 'open'
        and now() >= c.voting_starts_at
    )
  );
