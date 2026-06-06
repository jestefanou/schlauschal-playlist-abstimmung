// Spotify Web API — Client-Credentials-Flow + Track-Suche (rein serverseitig).
// Das App-Token wird modulweit gecacht (gilt ~3600s, kein Refresh-Token); nach
// Ablauf wird neu authentifiziert. Setup/Hintergrund: docs/guides/spotify-setup.md.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SEARCH_URL = "https://api.spotify.com/v1/search";

export type SpotifyTrack = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  albumArtUrl: string | null;
  previewUrl: string | null;
};

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET sind nicht gesetzt");
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Spotify-Token-Anfrage fehlgeschlagen (${res.status})`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  // 60s Puffer vor dem echten Ablauf, um Races an der Kante zu vermeiden.
  cachedToken = {
    value: json.access_token,
    expiresAt: now + (json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

type SpotifyApiTrack = {
  id: string;
  name: string;
  duration_ms: number | null;
  preview_url: string | null;
  artists: { name: string }[];
  album: { name: string | null; images: { url: string }[] } | null;
};

function mapTracks(json: unknown): SpotifyTrack[] {
  const items =
    (json as { tracks?: { items?: SpotifyApiTrack[] } })?.tracks?.items ?? [];
  return items.map((t) => {
    const images = t.album?.images ?? [];
    // Kleinstes Bild zuletzt → gutes Listen-Thumbnail; Fallback größtes.
    const thumb = images[images.length - 1]?.url ?? images[0]?.url ?? null;
    return {
      spotifyTrackId: t.id,
      title: t.name,
      artist: (t.artists ?? []).map((a) => a.name).join(", "),
      album: t.album?.name ?? null,
      durationMs: t.duration_ms ?? null,
      albumArtUrl: thumb,
      previewUrl: t.preview_url ?? null,
    };
  });
}

async function searchOnce(query: string, limit: number, token: string) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("type", "track");
  url.searchParams.set("market", "DE");
  // /v1/search erlaubt limit 0–10 (anders als andere Endpoints).
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}

export async function searchTracks(
  query: string,
  limit = 8,
): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (!q) return [];

  let res = await searchOnce(q, limit, await getAccessToken());
  if (res.status === 401) {
    // Token evtl. invalidiert — einmal verwerfen und neu holen.
    cachedToken = null;
    res = await searchOnce(q, limit, await getAccessToken());
  }
  if (!res.ok) {
    throw new Error(`Spotify-Suche fehlgeschlagen (${res.status})`);
  }
  return mapTracks(await res.json());
}
