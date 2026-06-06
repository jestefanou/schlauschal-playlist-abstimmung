import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("spotify lib", () => {
  beforeEach(() => {
    vi.resetModules(); // Modul-Token-Cache pro Test zurücksetzen
    process.env.SPOTIFY_CLIENT_ID = "cid";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("holt das App-Token einmal und cached es über mehrere Suchen", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "tok", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(jsonResponse({ tracks: { items: [] } }))
      .mockResolvedValueOnce(jsonResponse({ tracks: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    await searchTracks("erste");
    await searchTracks("zweite");

    const tokenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/token"),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("baut die Such-URL mit type/market/limit und mappt Tracks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "tok", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tracks: {
            items: [
              {
                id: "t1",
                name: "Doxy",
                duration_ms: 1000,
                preview_url: null,
                artists: [{ name: "Miles Davis" }, { name: "Sonny Rollins" }],
                album: {
                  name: "Bags Groove",
                  images: [{ url: "big" }, { url: "small" }],
                },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    const tracks = await searchTracks("doxy", 50);

    const searchCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/v1/search"),
    );
    const url = String(searchCall?.[0]);
    expect(url).toContain("type=track");
    expect(url).toContain("market=DE");
    expect(url).toContain("limit=10"); // 50 wird auf max. 10 geklemmt

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      spotifyTrackId: "t1",
      title: "Doxy",
      artist: "Miles Davis, Sonny Rollins",
      album: "Bags Groove",
      albumArtUrl: "small", // kleinstes Bild (zuletzt)
    });
  });

  it("wirft, wenn Credentials fehlen", async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    vi.stubGlobal("fetch", vi.fn());
    const { searchTracks } = await import("./spotify");
    await expect(searchTracks("x")).rejects.toThrow(/nicht gesetzt/);
  });

  it("holt bei 401 ein neues Token und versucht die Suche erneut", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "t1", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, 401)) // Suche -> Token abgelaufen
      .mockResolvedValueOnce(jsonResponse({ access_token: "t2", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ tracks: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    await searchTracks("doxy");

    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/token")),
    ).toHaveLength(2); // Token invalidiert + neu geholt
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("/v1/search")),
    ).toHaveLength(2); // ein Retry
  });

  it("wirft bei non-ok Suchantwort", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    await expect(searchTracks("doxy")).rejects.toThrow(/500/);
  });

  it("wirft, wenn die Token-Anfrage fehlschlägt", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 400));
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    await expect(searchTracks("doxy")).rejects.toThrow(/Token/);
  });

  it("kurzschließt eine leere Query ohne fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./spotify");
    expect(await searchTracks("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
