"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { searchTracks, type SpotifyTrack } from "@/lib/spotify";
import { rateLimit } from "@/lib/rate-limit";

export type SearchState =
  | { status: "idle" }
  | { status: "success"; tracks: SpotifyTrack[]; query: string }
  | { status: "error"; error: string };

// Live-Suche aus dem Client (debounced). Auth-gated + leichtes Per-User-Throttle:
// das Spotify-App-Token (Client Credentials) ist instanzweit geteilt, und der
// Client-Debounce ist für einen eingeloggten Aufrufer trivial umgehbar.
export async function searchSpotifyTracks(query: string): Promise<SearchState> {
  const q = query.trim();
  if (q.length < 2) return { status: "idle" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return { status: "error", error: "Nicht eingeloggt." };

  const { allowed } = rateLimit(`spotify-search:${userId}`, 30, 10_000);
  if (!allowed) {
    return { status: "error", error: "Zu viele Suchanfragen. Bitte kurz warten." };
  }

  try {
    const tracks = await searchTracks(q);
    return { status: "success", tracks, query: q };
  } catch (err) {
    console.error("searchSpotifyTracks failed", err);
    return {
      status: "error",
      error: "Spotify-Suche fehlgeschlagen. Bitte später erneut versuchen.",
    };
  }
}

export type NominateResult =
  | { status: "success"; nominated: number; skipped: number }
  | { status: "error"; error: string };

// Schlägt einen Track für mehrere Playlists vor: Song in den globalen Pool
// (dedupliziert), dann je Cycle in der Nominierungsphase der gewählten Playlists
// eine Nomination. Die Phase erzwingt auch RLS — der Filter hier liefert nur die
// bessere Fehlermeldung.
export async function nominateSong(
  track: SpotifyTrack,
  playlistIds: string[],
): Promise<NominateResult> {
  if (!track?.spotifyTrackId) {
    return { status: "error", error: "Kein Song ausgewählt." };
  }
  if (!playlistIds?.length) {
    return { status: "error", error: "Bitte mindestens eine Playlist wählen." };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { status: "error", error: "Nicht eingeloggt." };

  // 1. Song in den Pool aufnehmen (unique über spotify_track_id).
  //    ignoreDuplicates -> ON CONFLICT DO NOTHING; songs hat kein UPDATE-Recht
  //    für authenticated, ein DO-UPDATE-Upsert würde an RLS scheitern.
  const { error: songErr } = await supabase.from("songs").upsert(
    {
      spotify_track_id: track.spotifyTrackId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration_ms: track.durationMs,
      album_art_url: track.albumArtUrl,
      preview_url: track.previewUrl,
      added_by: userId,
    },
    { onConflict: "spotify_track_id", ignoreDuplicates: true },
  );
  if (songErr) {
    console.error("song upsert failed", songErr);
    return { status: "error", error: "Song konnte nicht gespeichert werden." };
  }

  const { data: song, error: songSelErr } = await supabase
    .from("songs")
    .select("id")
    .eq("spotify_track_id", track.spotifyTrackId)
    .single();
  if (songSelErr || !song) {
    console.error("song lookup failed", songSelErr);
    return { status: "error", error: "Song konnte nicht gespeichert werden." };
  }

  // 2. Cycles der gewählten Playlists in der Nominierungsphase holen
  //    (offen, aktiv, nicht Master, Abstimmungsstart noch in der Zukunft).
  const { data: cycles, error: cycleErr } = await supabase
    .from("cycles")
    .select("id, playlist_id, playlists!inner(is_active, is_master)")
    .eq("status", "open")
    .gt("voting_starts_at", new Date().toISOString())
    .in("playlist_id", playlistIds);
  if (cycleErr) {
    console.error("cycle lookup failed", cycleErr);
    return { status: "error", error: "Offene Zyklen konnten nicht geladen werden." };
  }

  const targetCycles = (cycles ?? []).filter((c) => {
    // supabase-js typisiert die Einbettung ohne DB-Typen als Array; zur Laufzeit
    // ist die to-one-Relation ein Objekt -> Cast über unknown.
    const pl = c.playlists as unknown as {
      is_active: boolean;
      is_master: boolean;
    };
    return pl?.is_active && !pl?.is_master;
  });
  if (!targetCycles.length) {
    return {
      status: "error",
      error: "Für die gewählten Playlists läuft gerade keine Nominierungsphase.",
    };
  }

  // 3. Nominierungen einfügen; (cycle_id, song_id) unique -> Duplikate überspringen.
  const rows = targetCycles.map((c) => ({
    cycle_id: c.id as string,
    song_id: song.id as string,
    submitted_by: userId,
  }));
  const { data: inserted, error: nomErr } = await supabase
    .from("song_nominations")
    .upsert(rows, { onConflict: "cycle_id,song_id", ignoreDuplicates: true })
    .select("id");
  if (nomErr) {
    console.error("nomination insert failed", nomErr);
    return { status: "error", error: "Nominierung fehlgeschlagen." };
  }

  revalidatePath("/songs");
  const nominated = inserted?.length ?? 0;
  return { status: "success", nominated, skipped: rows.length - nominated };
}

export type WithdrawResult =
  | { status: "success" }
  | { status: "error"; error: string };

// Eigene Nominierung zurücknehmen. RLS erlaubt DELETE nur self (oder Admin) und
// nur in der Nominierungsphase — danach ist die Kandidatenliste eingefroren.
export async function withdrawNomination(
  nominationId: string,
): Promise<WithdrawResult> {
  const supabase = await createClient();
  const { data: deleted, error } = await supabase
    .from("song_nominations")
    .delete()
    .eq("id", nominationId)
    .select("id");
  if (error) {
    console.error("withdrawNomination failed", error);
    return { status: "error", error: "Zurücknehmen fehlgeschlagen." };
  }
  // RLS filtert außerhalb der Nominierungsphase auf 0 Zeilen, ohne error —
  // ohne diesen Check sähe der Klick wie ein Erfolg aus.
  if (!deleted?.length) {
    return {
      status: "error",
      error: "Zurücknehmen nicht mehr möglich (Abstimmung läuft bereits?).",
    };
  }
  revalidatePath("/songs");
  return { status: "success" };
}
