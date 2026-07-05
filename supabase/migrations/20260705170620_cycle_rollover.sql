-- Schritt 6a: Cycle-Rollover (ohne Spotify-Push — der folgt nach Schritt 7).
--
-- Kernstück ist rollover_due_cycles(): schließt überfällige offene Cycles,
-- ermittelt die Gewinner nach cycle_winners und öffnet den Folge-Cycle.
-- Aufgerufen wird sie per RPC aus dem Vercel-Cron-Route-Handler
-- (/api/cron/rollover) mit dem Service-Role-Client — als DB-Funktion, damit
-- Schließen + Auswertung + Folge-Cycle eine Transaktion sind.
--
-- Entscheidungen (Q6.x, 2026-07-05):
--   - Gewinner brauchen immer >= 1 Stimme, auch im Initial-Cycle. Ein Cycle
--     kann also weniger als winners_count Gewinner haben.
--   - Tie-Breaking: Stimmen absteigend, bei Gleichstand gewinnt die früher
--     eingereichte Nominierung — dieselbe Ordnung wie die /vote-Top-Liste.
--   - Der Push auf Spotify passiert später (Schritt 6b): Cycles bleiben nach
--     dem Rollover auf 'closed', der Übergang 'closed' -> 'pushed' und die
--     pushed_to_*-Timestamps in cycle_winners kommen mit dem Push-Job.

-- ============================================================================
-- 1. rollover_due_cycles()
-- ============================================================================

create or replace function public.rollover_due_cycles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_winner_count integer;
  v_next_id uuid;
  v_next_number integer;
  v_next_start timestamptz;
  v_results jsonb := '[]'::jsonb;
begin
  -- SKIP LOCKED: läuft der Cron doppelt, überspringt der zweite Aufruf die
  -- Cycles, die der erste gerade verarbeitet — kein doppelter Rollover.
  for v_cycle in
    select c.id, c.playlist_id, c.cycle_number, c.ends_at, c.winners_count,
           p.is_active
    from public.cycles c
    join public.playlists p on p.id = c.playlist_id
    where c.status = 'open'
      and c.ends_at <= now()
    order by c.ends_at
    for update of c skip locked
  loop
    -- Erst schließen: ab hier ist der Stimmen-Stand eingefroren (RLS blockt
    -- Insert/Delete auf votes, sobald der Cycle nicht mehr 'open' ist).
    update public.cycles set status = 'closed' where id = v_cycle.id;

    -- Gewinner: nur Nominierungen mit >= 1 Stimme; Stimmen absteigend, bei
    -- Gleichstand frühere Nominierung; sn.id als letzter deterministischer
    -- Tie-Breaker für identische created_at.
    insert into public.cycle_winners (cycle_id, song_id, rank, vote_count)
    select v_cycle.id,
           sn.song_id,
           row_number() over (order by count(v.user_id) desc, sn.created_at, sn.id),
           count(v.user_id)::integer
    from public.song_nominations sn
    left join public.votes v on v.nomination_id = sn.id
    where sn.cycle_id = v_cycle.id
    group by sn.id, sn.song_id, sn.created_at
    having count(v.user_id) >= 1
    order by count(v.user_id) desc, sn.created_at, sn.id
    limit v_cycle.winners_count;

    get diagnostics v_winner_count = row_count;

    -- Folge-Cycle nur für weiterhin aktive Playlists. starts_at = ends_at des
    -- Vorgängers hält den Wochen-Rhythmus; lief der Cron länger nicht, wird in
    -- ganzen Wochen vorgespult, statt Geister-Cycles in der Vergangenheit
    -- anzulegen. winners_count und voting_starts_at füllt set_cycle_defaults.
    v_next_id := null;
    if v_cycle.is_active then
      v_next_start := v_cycle.ends_at + make_interval(
        days => 7 * floor(extract(epoch from (now() - v_cycle.ends_at)) / (7 * 86400))::integer
      );

      select coalesce(max(cycle_number), 0) + 1
        into v_next_number
      from public.cycles
      where playlist_id = v_cycle.playlist_id;

      insert into public.cycles
        (playlist_id, cycle_number, starts_at, ends_at, status, is_initial)
      values
        (v_cycle.playlist_id, v_next_number, v_next_start,
         v_next_start + interval '7 days', 'open', false)
      returning id into v_next_id;
    end if;

    v_results := v_results || jsonb_build_object(
      'cycle_id', v_cycle.id,
      'playlist_id', v_cycle.playlist_id,
      'winners', v_winner_count,
      'next_cycle_id', v_next_id
    );
  end loop;

  return jsonb_build_object(
    'rolled', jsonb_array_length(v_results),
    'cycles', v_results
  );
end;
$$;

revoke execute on function public.rollover_due_cycles() from public, anon, authenticated;
grant execute on function public.rollover_due_cycles() to service_role;

-- ============================================================================
-- 2. RLS-Härtung: Stimmen nur bis ends_at
--
-- Bisher prüften votes_insert_self/votes_delete_self nur status='open' und
-- now() >= voting_starts_at. Zwischen ends_at und dem nächsten Cron-Lauf
-- (Daily-Cron: bis zu ~24h) war ein überfälliger Cycle damit per API weiter
-- bevotebar. Jetzt endet das Stimm-Fenster hart bei ends_at.
-- ============================================================================

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
        and now() < c.ends_at
    )
  );

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
        and now() < c.ends_at
    )
  );
