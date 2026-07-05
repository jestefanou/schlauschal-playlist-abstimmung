import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { inNominationPhase } from "@/lib/cycle-phase";
import { SongSearch } from "./SongSearch";
import { WithdrawButton } from "./WithdrawButton";

type PlaylistRow = {
  id: string;
  name: string;
  cycles: { voting_starts_at: string }[];
};

type NominationRow = {
  id: string;
  songs: { title: string; artist: string; album_art_url: string | null };
  cycles: { voting_starts_at: string; playlists: { name: string } };
};

export default async function SongsPage() {
  const supabase = await createClient();

  // Playlists mit offenem Cycle (aktiv, nicht Master). Ob nominiert werden kann,
  // entscheidet die Phase: nur solange voting_starts_at in der Zukunft liegt.
  const { data: playlistRows } = await supabase
    .from("playlists")
    .select("id, name, cycles!inner(status, voting_starts_at)")
    .eq("is_active", true)
    .eq("is_master", false)
    .eq("cycles.status", "open")
    .order("name");

  const rows = (playlistRows ?? []) as unknown as PlaylistRow[];
  const inNomination = rows.filter((p) =>
    p.cycles.some((c) => inNominationPhase(c.voting_starts_at)),
  );
  const inVoting = rows.filter(
    (p) => !p.cycles.some((c) => inNominationPhase(c.voting_starts_at)),
  );

  const playlists = inNomination.map((p) => ({ id: p.id, name: p.name }));

  // Eigene Nominierungen im aktuellen (offenen) Cycle. Zurücknehmen geht nur in
  // der Nominierungsphase — ab Abstimmungsstart ist die Kandidatenliste
  // eingefroren (RLS erzwingt das, die UI zeigt es an).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  let myNominations: NominationRow[] = [];
  if (userId) {
    const { data } = await supabase
      .from("song_nominations")
      .select(
        "id, created_at, songs(title, artist, album_art_url), cycles!inner(status, voting_starts_at, playlists(name))",
      )
      .eq("submitted_by", userId)
      .eq("cycles.status", "open")
      .order("created_at", { ascending: false });
    myNominations = (data ?? []) as unknown as NominationRow[];
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Songs vorschlagen</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Such einen Track und schlag ihn für eine oder mehrere Playlists vor.
      </p>

      {playlists.length === 0 ? (
        inVoting.length > 0 ? (
          <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Die Nominierungsphase ist gerade vorbei — bei{" "}
            {inVoting.map((p) => p.name).join(", ")} läuft die Abstimmung.{" "}
            <Link href="/vote" className="underline underline-offset-2">
              Jetzt abstimmen
            </Link>
            . Neue Vorschläge gehen im nächsten Zyklus wieder.
          </p>
        ) : (
          <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Aktuell gibt es keine Playlist mit offenem Zyklus. Ein Admin muss
            zuerst eine Playlist und einen Zyklus anlegen.
          </p>
        )
      ) : (
        <>
          <SongSearch playlists={playlists} />
          {inVoting.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              Bei {inVoting.map((p) => p.name).join(", ")} läuft gerade die{" "}
              <Link href="/vote" className="underline underline-offset-2">
                Abstimmung
              </Link>{" "}
              — dort kann nicht mehr nominiert werden.
            </p>
          )}
        </>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Deine Vorschläge</h2>
        {myNominations.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            Noch keine Vorschläge im aktuellen Zyklus.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {myNominations.map((n) => {
              const canWithdraw = inNominationPhase(n.cycles.voting_starts_at);
              return (
                <li
                  key={n.id}
                  className="flex items-center gap-3 rounded border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  {n.songs.album_art_url ? (
                    // Externe Spotify-CDN-URL, winziges Thumbnail -> next/image-
                    // Optimizer lohnt nicht (bräuchte zudem images.remotePatterns).
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
                      {n.songs.artist} · {n.cycles.playlists.name}
                    </div>
                  </div>
                  {canWithdraw ? (
                    <WithdrawButton nominationId={n.id} />
                  ) : (
                    <span className="shrink-0 text-xs text-zinc-500">
                      in der Abstimmung
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
