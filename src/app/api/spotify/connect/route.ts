import { NextResponse, type NextRequest } from "next/server";
import { getAdminUserId } from "@/lib/admin";
import { siteOrigin } from "@/lib/site-origin";
import {
  buildAuthorizeUrl,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
} from "@/lib/spotify-owner";

// Startet den Spotify-Owner-OAuth-Flow (Schritt 7): nur für Admins, setzt den
// state-Cookie (CSRF) und leitet zum Spotify-Consent-Dialog weiter. Zurück
// geht es über /api/spotify/callback.
export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);

  const adminId = await getAdminUserId();
  if (!adminId) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error("SPOTIFY_CLIENT_ID is not set");
    const url = new URL("/admin/spotify", origin);
    url.searchParams.set("spotify_error", "config");
    return NextResponse.redirect(url);
  }

  const state = crypto.randomUUID();
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri: `${origin}/api/spotify/callback`,
    state,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
