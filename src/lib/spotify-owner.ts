// Spotify-OAuth für den Owner-Account (Authorization-Code-Flow, Schritt 7).
// Dauerhaft gespeichert wird nur der Refresh-Token (Supabase Vault, über die
// service_role-RPCs set/get_spotify_refresh_token) — Access-Tokens holt sich
// der Push-Job (Schritt 6b) bei Bedarf frisch. Setup: docs/guides/spotify-setup.md.

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PROFILE_URL = "https://api.spotify.com/v1/me";

// Playlists des Owners bearbeiten (öffentlich + privat) — mehr braucht der
// Push-Job nicht.
export const OWNER_SCOPES = "playlist-modify-public playlist-modify-private";

// CSRF-Schutz des OAuth-Flows: /api/spotify/connect setzt state als httpOnly-
// Cookie, /api/spotify/callback vergleicht ihn mit dem state-Query-Param.
export const STATE_COOKIE = "spotify_oauth_state";
export const STATE_COOKIE_PATH = "/api/spotify";

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("scope", OWNER_SCOPES);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export type OwnerTokens = {
  accessToken: string;
  refreshToken: string | null;
};

// redirect_uri muss exakt der Wert aus dem Authorize-Redirect sein — Spotify
// verifiziert ihn beim Exchange erneut.
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<OwnerTokens> {
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
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Spotify-Code-Exchange fehlgeschlagen (${res.status})`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
  };
}

export type SpotifyOwnerProfile = {
  id: string;
  displayName: string | null;
};

export async function fetchOwnerProfile(
  accessToken: string,
): Promise<SpotifyOwnerProfile> {
  const res = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Spotify-Profil-Abruf fehlgeschlagen (${res.status})`);
  }
  const json = (await res.json()) as {
    id: string;
    display_name?: string | null;
  };
  return { id: json.id, displayName: json.display_name ?? null };
}
