import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inNominationPhase } from "@/lib/cycle-phase";
import { VoteButton } from "./VoteButton";

type CycleRow = {
  id: string;
  voting_starts_at: string;
  ends_at: string;
  playlists: {
    id: string;
    name: string;
    vote_budget_per_cycle: number;
    timezone: string;
  };
};

type NominationRow = {
  id: string;
  cycle_id: string;
  created_at: string;
  songs: { title: string; artist: string; album_art_url: string | null };
  votes: { user_id: string }[];
};

function formatWhen(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export default async function VotePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  // Offene Cycles aktiver Nicht-Master-Playlists; die Phase wird unten aus
  // voting_starts_at abgeleitet (Abstimmung vs. noch Nominierung).
  const { data: cycleRows } = await supabase
    .from("cycles")
    .select(
      "id, voting_starts_at, ends_at, playlists!inner(id, name, vote_budget_per_cycle, timezone, is_active, is_master)",
    )
    .eq("status", "open")
    .eq("playlists.is_active", true)
    .eq("playlists.is_master", false);

  // supabase-js typisiert die Einbettung ohne DB-Typen als Array; zur Laufzeit
  // ist die to-one-Relation ein Objekt -> Cast über unknown (wie in /songs).
  const cycles = ((cycleRows ?? []) as unknown as CycleRow[]).sort((a, b) =>
    a.playlists.name.localeCompare(b.playlists.name, "de"),
  );

  const votingCycles = cycles.filter(
    (c) => !inNominationPhase(c.voting_starts_at),
  );
  const nominationCycles = cycles.filter((c) =>
    inNominationPhase(c.voting_starts_at),
  );

  // Nominierungen aller Abstimmungs-Cycles inkl. Votes in einem Query; Zählung
  // und "habe ich gewählt?" passieren in JS (Clubgröße, votes ist voll lesbar).
  const nominationsByCycle = new Map<string, NominationRow[]>();
  if (votingCycles.length) {
    const { data } = await supabase
      .from("song_nominations")
      .select(
        "id, cycle_id, created_at, songs(title, artist, album_art_url), votes(user_id)",
      )
      .in(
        "cycle_id",
        votingCycles.map((c) => c.id),
      );
    for (const row of (data ?? []) as unknown as NominationRow[]) {
      const list = nominationsByCycle.get(row.cycle_id) ?? [];
      list.push(row);
      nominationsByCycle.set(row.cycle_id, list);
    }
    // Top-Liste (Q5.2): meiste Stimmen zuerst, bei Gleichstand ältere Nominierung.
    for (const list of nominationsByCycle.values()) {
      list.sort(
        (a, b) =>
          b.votes.length - a.votes.length ||
          Date.parse(a.created_at) - Date.parse(b.created_at),
      );
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Abstimmen</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Vergib deine Stimmen für die Songs der Woche — pro Playlist hast du ein
        eigenes Budget.
      </p>

      {votingCycles.length === 0 && nominationCycles.length === 0 && (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Aktuell läuft keine Abstimmung. Ein Admin muss zuerst eine Playlist
          und einen Zyklus anlegen.
        </p>
      )}

      {votingCycles.map((cycle) => {
        const noms = nominationsByCycle.get(cycle.id) ?? [];
        const budget = cycle.playlists.vote_budget_per_cycle;
        const used = userId
          ? noms.filter((n) => n.votes.some((v) => v.user_id === userId)).length
          : 0;
        const left = Math.max(0, budget - used);

        return (
          <section key={cycle.id} className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-lg font-medium">{cycle.playlists.name}</h2>
              <span className="text-xs text-zinc-500">
                bis {formatWhen(cycle.ends_at, cycle.playlists.timezone)} · noch{" "}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {left} von {budget}
                </span>{" "}
                Stimmen
              </span>
            </div>

            {noms.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                Keine Nominierungen in diesem Zyklus.
              </p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2">
                {noms.map((n, i) => {
                  const voted = userId
                    ? n.votes.some((v) => v.user_id === userId)
                    : false;
                  return (
                    <li
                      key={n.id}
                      className="flex items-center gap-3 rounded border border-zinc-200 p-2 dark:border-zinc-800"
                    >
                      <span className="w-5 shrink-0 text-right text-sm tabular-nums text-zinc-400">
                        {i + 1}.
                      </span>
                      {n.songs.album_art_url ? (
                        // Externe Spotify-CDN-URL, winziges Thumbnail ->
                        // next/image-Optimizer lohnt nicht (vgl. /songs).
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={n.songs.album_art_url}
                          alt=""
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded bg-zinc-200 dark:bg-zinc-800" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {n.songs.title}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {n.songs.artist}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {n.votes.length}{" "}
                        {n.votes.length === 1 ? "Stimme" : "Stimmen"}
                      </span>
                      <VoteButton
                        nominationId={n.id}
                        voted={voted}
                        budgetLeft={left}
                      />
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}

      {nominationCycles.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-zinc-500">
            Noch in der Nominierungsphase
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {nominationCycles.map((cycle) => (
              <li
                key={cycle.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span>
                  <span className="font-medium">{cycle.playlists.name}</span>{" "}
                  <span className="text-zinc-500">
                    — Abstimmung startet{" "}
                    {formatWhen(cycle.voting_starts_at, cycle.playlists.timezone)}
                  </span>
                </span>
                <Link
                  href="/songs"
                  className="text-zinc-600 underline underline-offset-2 transition-colors hover:text-black dark:text-zinc-400 dark:hover:text-white"
                >
                  Jetzt Songs vorschlagen
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
