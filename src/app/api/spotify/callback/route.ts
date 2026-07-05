import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminUserId } from "@/lib/admin";
import { siteOrigin } from "@/lib/site-origin";
import {
  exchangeCodeForTokens,
  fetchOwnerProfile,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
} from "@/lib/spotify-owner";

// Rückkehr aus dem Spotify-Consent-Dialog (Schritt 7): state prüfen (CSRF),
// Code gegen Tokens tauschen, Refresh-Token in den Vault legen (RPC) und den
// Verbindungs-Status in spotify_connection aktualisieren. Fehler landen als
// ?spotify_error=<key> auf /admin/spotify — die Seite übersetzt die Keys.
export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);

  const adminId = await getAdminUserId();
  if (!adminId) {
    return NextResponse.redirect(new URL("/", origin));
  }

  // Der state-Cookie ist einmalig — in jedem Ausgang (Erfolg wie Fehler) löschen.
  const finish = (params: Record<string, string>) => {
    const url = new URL("/admin/spotify", origin);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = NextResponse.redirect(url);
    response.cookies.set(STATE_COOKIE, "", {
      path: STATE_COOKIE_PATH,
      maxAge: 0,
    });
    return response;
  };

  const { searchParams } = new URL(request.url);

  // Abbruch/Ablehnung im Spotify-Dialog kommt als ?error=access_denied zurück.
  if (searchParams.get("error")) {
    return finish({ spotify_error: "denied" });
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !stateCookie || state !== stateCookie) {
    return finish({ spotify_error: "state" });
  }
  if (!code) {
    return finish({ spotify_error: "exchange" });
  }

  let refreshToken: string;
  let accessToken: string;
  try {
    const tokens = await exchangeCodeForTokens(
      code,
      `${origin}/api/spotify/callback`,
    );
    if (!tokens.refreshToken) {
      // Ohne Refresh-Token ist die Verbindung wertlos — der Push-Job könnte
      // sich später keine Access-Tokens mehr holen.
      console.error("Spotify token response contained no refresh_token");
      return finish({ spotify_error: "exchange" });
    }
    refreshToken = tokens.refreshToken;
    accessToken = tokens.accessToken;
  } catch (err) {
    console.error("exchangeCodeForTokens failed", err);
    return finish({ spotify_error: "exchange" });
  }

  // Welcher Spotify-Account wurde verbunden? (Anzeige auf /admin/spotify.)
  let profile: { id: string; displayName: string | null };
  try {
    profile = await fetchOwnerProfile(accessToken);
  } catch (err) {
    console.error("fetchOwnerProfile failed", err);
    return finish({ spotify_error: "profile" });
  }

  // Erst den Token in den Vault, dann den Status — so behauptet
  // spotify_connection nie "connected" ohne gespeicherten Token.
  const admin = createAdminClient();
  const { error: tokenErr } = await admin.rpc("set_spotify_refresh_token", {
    p_token: refreshToken,
  });
  if (tokenErr) {
    console.error("set_spotify_refresh_token failed", tokenErr);
    return finish({ spotify_error: "store" });
  }

  const { error: statusErr } = await admin.from("spotify_connection").upsert({
    id: true,
    status: "connected",
    spotify_user_id: profile.id,
    spotify_display_name: profile.displayName,
    connected_by: adminId,
    connected_at: new Date().toISOString(),
    last_error: null,
    last_error_at: null,
  });
  if (statusErr) {
    console.error("spotify_connection upsert failed", statusErr);
    return finish({ spotify_error: "store" });
  }

  return finish({ connected: "1" });
}
