# Spotify Web API: App anlegen, Client Credentials & Suche

Anleitung für die serverseitige Spotify-Integration (Next.js Server Context,
**Client Credentials Flow**) — gebraucht ab Schritt 4 (Song-Vorschläge) für die
Track-Suche. Voraussetzung: ein bestehendes Spotify-Konto. Einen separaten
„Developer-Account" gibt es nicht; das normale Spotify-Login genügt.

> Diese Anleitung wurde am 2026-06-06 gegen die offizielle Doku verifiziert
> (developer.spotify.com). Die UI des Dashboards ändert sich gelegentlich — exakte
> Button-Labels können abweichen, die beschriebene Substanz folgt aber den Docs.
> Quellen: [Client-Credentials-Tutorial](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow),
> [Search-Referenz](https://developer.spotify.com/documentation/web-api/reference/search),
> [Redirect-URI-Regeln](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri),
> [Security-Blog 2025-02](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify).

## 1. App im Dashboard anlegen

1. Auf [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) mit
   dem normalen Spotify-Account einloggen. (Ohne Login wird die Create-Seite zurück auf
   die Startseite umgeleitet.)
2. **Create app** klicken.
3. **App name** (Pflicht) — frei wählbar, wird Nutzern im OAuth-Dialog angezeigt.
4. **App description** (Pflicht) — frei wählbar.
5. **Website** (optional, nicht blockierend).
6. **Redirect URI** eintragen. Auch wenn der Client Credentials Flow zur Laufzeit *keine*
   Redirect URI nutzt, verlangt das Formular bei der App-Erstellung eine. Trage den
   offiziellen Getting-Started-Platzhalter ein:
   ```
   http://127.0.0.1:3000
   ```
   dann **Add** klicken. Regeln seit April 2025 (verschärft):
   - HTTPS Pflicht für normale URIs.
   - HTTP **nur** für Loopback-IP-Literale: `http://127.0.0.1:PORT` bzw. `http://[::1]:PORT`.
   - **`localhost` ist verboten** — ausdrücklich das IP-Literal `127.0.0.1` verwenden.
     (Dasselbe `127.0.0.1`-vs-`localhost`-Thema wie in unserem lokalen Auth-Flow, hier auf
     Spotify-Seite — siehe [auth-testing.md](./auth-testing.md).)
7. Bei **„Which API/SDKs are you planning to use?"** → **Web API** ankreuzen (so weist es
   die offizielle Web-API-Übersicht an).
8. **Developer Terms of Service**-Checkbox anhaken.
9. **Save** / **Create**.

## 2. Client ID + Secret holen

1. App öffnen → **Settings**.
2. Die **Client ID** steht direkt auf der Settings-Seite.
3. Das **Client Secret** ist verdeckt → einblenden und sicher speichern. Bei Kompromittierung
   per **ROTATE** zurücksetzen (macht das alte Secret ungültig).

## 3. In `.env.local` eintragen

Die Variablennamen sind im Projekt schon reserviert (`.env.local.example`):

```dotenv
SPOTIFY_CLIENT_ID=deine_client_id
SPOTIFY_CLIENT_SECRET=dein_client_secret
```

Nur serverseitig verwenden (**kein** `NEXT_PUBLIC_`-Präfix), damit das Secret nie ins
Client-Bundle wandert.

## 4. Token holen (Client Credentials)

Token-Endpoint `POST https://accounts.spotify.com/api/token` — Credentials im
**Authorization: Basic**-Header (`base64(client_id:client_secret)`), Body nur `grant_type`:

```bash
curl -X POST "https://accounts.spotify.com/api/token" \
  -H "Authorization: Basic $(printf '%s' "$SPOTIFY_CLIENT_ID:$SPOTIFY_CLIENT_SECRET" | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

Antwort (HTTP 200):

```json
{ "access_token": "NgCXRKc...MzYjw", "token_type": "bearer", "expires_in": 3600 }
```

**Server-seitiges Caching:** Der Token gilt `expires_in` Sekunden (aktuell `3600` = 1 Std.).
Es wird **kein Refresh-Token** ausgegeben — nach Ablauf einfach neu anfordern. Den
`access_token` daher serverseitig cachen (Modul-Singleton) und mit etwas Puffer vor Ablauf
erneuern, statt bei jedem Request neu zu authentifizieren. (Im Projekt: `src/lib/spotify.ts`.)
`token_type` kommt teils klein (`bearer`) zurück — case-insensitiv behandeln.

## 5. Suche testen

`GET https://api.spotify.com/v1/search`, Pflicht-Params `q` + `type`. `market` explizit
setzen — ein Client-Credentials-Token hat keinen User-Kontext und damit kein Länder-Fallback:

```bash
TOKEN="hier_den_access_token_einsetzen"
curl -X GET \
  "https://api.spotify.com/v1/search?q=track:Doxy%20artist:Miles%20Davis&type=track&market=DE&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```

Ergebnisse für `type=track` liegen unter `tracks.items`; `next`/`offset` dienen der Paginierung.

## 6. Owner-OAuth verbinden (Schritt 7)

Der wöchentliche Push (Schritt 6b) schreibt in die Club-Playlists — dafür braucht die App
einen **User-Kontext** des Playlist-Besitzers (Authorization-Code-Flow), nicht nur das
App-Token. Verbunden wird über die App selbst:

1. **Redirect URI registrieren** (einmalig, App → Settings → Redirect URIs):
   - lokal: `http://127.0.0.1:3000/api/spotify/callback` (Loopback-IP, nie `localhost`)
   - Prod: `https://<domain>/api/spotify/callback`

   Spotify verifiziert die URI bei jedem Authorize **und** beim Code-Exchange exakt;
   eine nicht registrierte URI bricht mit `INVALID_CLIENT: Invalid redirect URI` ab.
2. **Als Admin einloggen** → `/admin/spotify` → **Mit Spotify verbinden**. Im
   Spotify-Dialog mit dem **Club-Account** (Besitzer der Playlists) zustimmen.
   Angefragte Scopes: `playlist-modify-public playlist-modify-private`.
3. Der Callback speichert den **Refresh-Token im Supabase Vault** (verschlüsselt;
   Zugriff nur über die `service_role`-RPCs `set_/get_spotify_refresh_token`) und den
   Verbindungs-Status in `spotify_connection` (Singleton-Tabelle, für Admins lesbar).
   Es landet **kein Token in `.env`** — nach Token-Ausfall genügt „Neu verbinden".

Hinweis Development-Modus: Die App darf bis zu 25 explizit eingetragene Nutzer
authentifizieren — der eine Club-Account muss ggf. unter **User Management**
eingetragen sein, falls er nicht der App-Owner ist.

## Stolperfallen

- **`limit` bei `/v1/search` ist 0–10 (Default 5)** — nicht 1–50 wie bei vielen anderen
  Endpoints. Werte > 10 schlagen fehl.
- **`localhost` als Redirect URI verboten** → immer `http://127.0.0.1:PORT`.
- **Redirect URI auch ohne OAuth-Nutzung angeben** — der Client Credentials Flow nutzt sie
  nie, das Formular verlangt aber eine.
- **`market` explizit setzen**, sonst liefert die Suche keine spielbaren Treffer.
- **Kein Refresh-Token** → cachen, nicht pro Request neu holen.
- **Credentials gehören in den Basic-Auth-Header**, nicht in den Form-Body (dort nur
  `grant_type=client_credentials`).
- **Kein User-Kontext** — Client Credentials kann nur Endpoints ohne Nutzerdaten aufrufen;
  Suche funktioniert, persönliche Endpoints nicht (User-OAuth ist Schritt 7).
- **Rate Limits** über ein rollierendes 30-Sekunden-Fenster; bei Überschreitung HTTP 429 mit
  `Retry-After`. Development-Modus hat ein deutlich kleineres Kontingent als Extended Quota.
- **Client Secret niemals exponieren** (kein `NEXT_PUBLIC_`); bei Leak per ROTATE zurücksetzen.
