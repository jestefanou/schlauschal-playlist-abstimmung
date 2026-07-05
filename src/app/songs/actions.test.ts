import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  searchSpotifyTracks,
  nominateSong,
  withdrawNomination,
} from "./actions";
import type { SpotifyTrack } from "@/lib/spotify";

// Boundaries der Song-Actions, alle gemockt:
//   @/lib/supabase/server -> createClient ASYNC
//   @/lib/spotify         -> searchTracks
//   @/lib/rate-limit      -> rateLimit (Default: allowed)
//   next/cache            -> revalidatePath (no-op)
const mocks = vi.hoisted(() => {
  const from = vi.fn();
  const getClaims = vi.fn();
  const searchTracks = vi.fn();
  const rateLimit = vi.fn();
  const revalidatePath = vi.fn();
  return {
    from,
    getClaims,
    searchTracks,
    rateLimit,
    revalidatePath,
    fakeSupa: { auth: { getClaims }, from },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mocks.fakeSupa),
}));
vi.mock("@/lib/spotify", () => ({
  searchTracks: mocks.searchTracks,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// Thenable, chainable Supabase-Query-Builder-Stub: jede Methode gibt den Builder
// zurück, `await builder` (an jedem Chain-Ende) löst `result` auf. Deckt die
// unterschiedlichen Enden ab (.upsert(), .single(), .in(), .select(), .eq()).
// Hinweis: der Stub erzwingt NICHT die Datenform pro Terminal (.single vs Array) —
// die korrekte Form liegt im jeweiligen Test (bewusst, vgl. makeQuery in auth-Tests).
function makeBuilder(result: { data?: unknown; error: unknown }) {
  const b: Record<string, ReturnType<typeof vi.fn>> & {
    then: (resolve: (v: unknown) => void) => void;
  } = { then: (resolve) => resolve(result) };
  for (const m of [
    "select",
    "insert",
    "upsert",
    "update",
    "delete",
    "eq",
    "gt",
    "in",
    "is",
    "or",
    "order",
    "single",
    "maybeSingle",
  ]) {
    b[m] = vi.fn(() => b);
  }
  return b;
}

function mockFrom(...builders: ReturnType<typeof makeBuilder>[]) {
  for (const b of builders) mocks.from.mockReturnValueOnce(b);
}

const TRACK: SpotifyTrack = {
  spotifyTrackId: "trk-1",
  title: "Doxy",
  artist: "Miles Davis",
  album: "Bags Groove",
  durationMs: 1000,
  albumArtUrl: "http://img/small.jpg",
  previewUrl: null,
};

const activeCycle = (id: string, playlistId: string) => ({
  id,
  playlist_id: playlistId,
  playlists: { is_active: true, is_master: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  mocks.searchTracks.mockResolvedValue([]);
  mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
});

describe("searchSpotifyTracks", () => {
  it("gibt idle zurück und berührt nichts bei < 2 Zeichen", async () => {
    const res = await searchSpotifyTracks(" a ");
    expect(res).toEqual({ status: "idle" });
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.searchTracks).not.toHaveBeenCalled();
  });

  it("akzeptiert genau 2 Zeichen (Schwellenwert)", async () => {
    mocks.searchTracks.mockResolvedValueOnce([TRACK]);
    const res = await searchSpotifyTracks("ab");
    expect(res).toEqual({ status: "success", tracks: [TRACK], query: "ab" });
  });

  it("lehnt nicht eingeloggte Aufrufe ab", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null } });
    const res = await searchSpotifyTracks("doxy");
    expect(res).toEqual({ status: "error", error: "Nicht eingeloggt." });
    expect(mocks.searchTracks).not.toHaveBeenCalled();
  });

  it("blockt bei überschrittenem Rate-Limit, ohne Spotify zu rufen", async () => {
    mocks.rateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 5000 });
    const res = await searchSpotifyTracks("doxy");
    expect(res).toEqual({
      status: "error",
      error: "Zu viele Suchanfragen. Bitte kurz warten.",
    });
    expect(mocks.searchTracks).not.toHaveBeenCalled();
  });

  it("liefert Treffer im Happy Path", async () => {
    mocks.searchTracks.mockResolvedValueOnce([TRACK]);
    const res = await searchSpotifyTracks("  doxy  ");
    expect(res).toEqual({ status: "success", tracks: [TRACK], query: "doxy" });
    expect(mocks.searchTracks).toHaveBeenCalledWith("doxy");
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "spotify-search:user-1",
      30,
      10_000,
    );
  });

  it("fängt Spotify-Fehler ab", async () => {
    mocks.searchTracks.mockRejectedValueOnce(new Error("429"));
    const res = await searchSpotifyTracks("doxy");
    expect(res).toEqual({
      status: "error",
      error: "Spotify-Suche fehlgeschlagen. Bitte später erneut versuchen.",
    });
  });
});

describe("nominateSong — Validierung & Auth", () => {
  it("verlangt einen Song", async () => {
    const res = await nominateSong(undefined as unknown as SpotifyTrack, ["p1"]);
    expect(res).toEqual({ status: "error", error: "Kein Song ausgewählt." });
  });

  it("verlangt mindestens eine Playlist", async () => {
    const res = await nominateSong(TRACK, []);
    expect(res).toEqual({
      status: "error",
      error: "Bitte mindestens eine Playlist wählen.",
    });
  });

  it("lehnt nicht eingeloggte Aufrufe ab", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null } });
    const res = await nominateSong(TRACK, ["p1"]);
    expect(res).toEqual({ status: "error", error: "Nicht eingeloggt." });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("nominateSong — Happy Path & Dedup", () => {
  it("nominiert in alle offenen Cycles, mit korrekten Query-Argumenten", async () => {
    const songsUpsert = makeBuilder({ error: null });
    const songsSelect = makeBuilder({ data: { id: "song-1" }, error: null });
    const cyclesB = makeBuilder({
      data: [activeCycle("c1", "p1"), activeCycle("c2", "p2")],
      error: null,
    });
    const nomsB = makeBuilder({ data: [{ id: "n1" }, { id: "n2" }], error: null });
    mockFrom(songsUpsert, songsSelect, cyclesB, nomsB);

    const res = await nominateSong(TRACK, ["p1", "p2"]);

    expect(res).toEqual({ status: "success", nominated: 2, skipped: 0 });
    expect(mocks.from.mock.calls.map((c) => c[0])).toEqual([
      "songs",
      "songs",
      "cycles",
      "song_nominations",
    ]);
    // Song-Upsert: snake_case-Mapping + added_by + DO-NOTHING-Konflikt.
    expect(songsUpsert.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        spotify_track_id: "trk-1",
        added_by: "user-1",
        album: "Bags Groove",
        duration_ms: 1000,
        album_art_url: "http://img/small.jpg",
      }),
      { onConflict: "spotify_track_id", ignoreDuplicates: true },
    );
    expect(songsSelect.eq).toHaveBeenCalledWith("spotify_track_id", "trk-1");
    expect(songsSelect.single).toHaveBeenCalled();
    // Cycle-Lookup: nur offene in der Nominierungsphase, nur gewählte Playlists.
    expect(cyclesB.eq).toHaveBeenCalledWith("status", "open");
    expect(cyclesB.gt).toHaveBeenCalledWith(
      "voting_starts_at",
      expect.any(String),
    );
    expect(cyclesB.in).toHaveBeenCalledWith("playlist_id", ["p1", "p2"]);
    // Nominierungen: self + DO-NOTHING auf (cycle_id, song_id).
    expect(nomsB.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          cycle_id: "c1",
          song_id: "song-1",
          submitted_by: "user-1",
        }),
      ]),
      { onConflict: "cycle_id,song_id", ignoreDuplicates: true },
    );
    expect(nomsB.select).toHaveBeenCalledWith("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/songs");
  });

  it("zählt bereits vorhandene Nominierungen als skipped", async () => {
    mockFrom(
      makeBuilder({ error: null }),
      makeBuilder({ data: { id: "song-1" }, error: null }),
      makeBuilder({
        data: [activeCycle("c1", "p1"), activeCycle("c2", "p2")],
        error: null,
      }),
      makeBuilder({ data: [{ id: "n1" }], error: null }), // nur 1 neu eingefügt
    );

    const res = await nominateSong(TRACK, ["p1", "p2"]);
    expect(res).toEqual({ status: "success", nominated: 1, skipped: 1 });
  });

  it("ignoriert Master-/inaktive Playlists und meldet sonst keine offenen Cycles", async () => {
    mockFrom(
      makeBuilder({ error: null }),
      makeBuilder({ data: { id: "song-1" }, error: null }),
      makeBuilder({
        data: [
          { id: "c1", playlist_id: "p1", playlists: { is_active: true, is_master: true } },
          { id: "c2", playlist_id: "p2", playlists: { is_active: false, is_master: false } },
        ],
        error: null,
      }),
    );

    const res = await nominateSong(TRACK, ["p1", "p2"]);
    expect(res).toEqual({
      status: "error",
      error: "Für die gewählten Playlists läuft gerade keine Nominierungsphase.",
    });
  });
});

describe("nominateSong — Fehlerpfade", () => {
  it("meldet Fehler, wenn der Song-Upsert scheitert", async () => {
    mockFrom(makeBuilder({ error: { message: "rls" } }));
    const res = await nominateSong(TRACK, ["p1"]);
    expect(res).toEqual({
      status: "error",
      error: "Song konnte nicht gespeichert werden.",
    });
  });

  it("meldet Fehler, wenn das Cycle-Lookup scheitert", async () => {
    mockFrom(
      makeBuilder({ error: null }),
      makeBuilder({ data: { id: "song-1" }, error: null }),
      makeBuilder({ data: null, error: { message: "boom" } }),
    );
    const res = await nominateSong(TRACK, ["p1"]);
    expect(res).toEqual({
      status: "error",
      error: "Offene Zyklen konnten nicht geladen werden.",
    });
  });

  it("meldet Fehler, wenn das Einfügen der Nominierung scheitert", async () => {
    mockFrom(
      makeBuilder({ error: null }),
      makeBuilder({ data: { id: "song-1" }, error: null }),
      makeBuilder({ data: [activeCycle("c1", "p1")], error: null }),
      makeBuilder({ data: null, error: { message: "boom" } }),
    );
    const res = await nominateSong(TRACK, ["p1"]);
    expect(res).toEqual({ status: "error", error: "Nominierung fehlgeschlagen." });
  });
});

describe("withdrawNomination", () => {
  it("löscht die Nominierung, revalidiert und meldet success", async () => {
    const builder = makeBuilder({ data: [{ id: "nom-1" }], error: null });
    mocks.from.mockReturnValueOnce(builder);

    const res = await withdrawNomination("nom-1");

    expect(res).toEqual({ status: "success" });
    expect(mocks.from).toHaveBeenCalledWith("song_nominations");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "nom-1");
    expect(builder.select).toHaveBeenCalledWith("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/songs");
  });

  it("gibt error zurück und revalidiert NICHT, wenn das DELETE scheitert", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({ data: null, error: { message: "boom" } }),
    );

    const res = await withdrawNomination("nom-1");

    expect(res).toEqual({
      status: "error",
      error: "Zurücknehmen fehlgeschlagen.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("meldet error, wenn RLS das DELETE auf 0 Zeilen filtert (Phase vorbei)", async () => {
    mocks.from.mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const res = await withdrawNomination("nom-1");

    expect(res).toEqual({
      status: "error",
      error: "Zurücknehmen nicht mehr möglich (Abstimmung läuft bereits?).",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
