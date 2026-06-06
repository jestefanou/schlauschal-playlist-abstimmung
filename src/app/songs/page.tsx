import { createClient } from "@/lib/supabase/server";
import { SongSearch } from "./SongSearch";
import { WithdrawButton } from "./WithdrawButton";

type NominatablePlaylist = { id: string; name: string };

type NominationRow = {
  id: string;
  songs: { title: string; artist: string; album_art_url: string | null };
  cycles: { playlists: { name: string } };
};

export default async function SongsPage() {
  const supabase = await createClient();

  // Nominierbare Playlists = aktiv, nicht Master, mit offenem Cycle.
  const { data: playlistRows } = await supabase
    .from("playlists")
    .select("id, name, cycles!inner(status)")
    .eq("is_active", true)
    .eq("is_master", false)
    .eq("cycles.status", "open")
    .order("name");

  const playlists: NominatablePlaylist[] = (playlistRows ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
  }));

  // Eigene Nominierungen im aktuellen (offenen) Cycle.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  let myNominations: NominationRow[] = [];
  if (userId) {
    const { data } = await supabase
      .from("song_nominations")
      .select(
        "id, created_at, songs(title, artist, album_art_url), cycles!inner(status, playlists(name))",
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
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Aktuell gibt es keine Playlist mit offenem Zyklus. Ein Admin muss zuerst
          eine Playlist und einen Zyklus anlegen.
        </p>
      ) : (
        <SongSearch playlists={playlists} />
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Deine Vorschläge</h2>
        {myNominations.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            Noch keine Vorschläge im aktuellen Zyklus.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {myNominations.map((n) => (
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
                <WithdrawButton nominationId={n.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
