import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminUserId } from "@/lib/admin";

type ConnectionRow = {
  status: "connected" | "broken";
  spotify_user_id: string;
  spotify_display_name: string | null;
  connected_at: string;
  last_error: string | null;
  last_error_at: string | null;
};

// Fehler-Keys aus /api/spotify/callback bzw. /api/spotify/connect.
const ERROR_MESSAGES: Record<string, string> = {
  denied: "Spotify hat den Zugriff abgelehnt (im Dialog abgebrochen?).",
  state:
    "Sicherheits-Check fehlgeschlagen (state stimmt nicht überein). Bitte den Flow erneut starten.",
  exchange: "Token-Austausch mit Spotify fehlgeschlagen. Bitte erneut versuchen.",
  profile: "Spotify-Profil konnte nicht abgerufen werden. Bitte erneut versuchen.",
  store: "Der Token konnte nicht gespeichert werden. Bitte erneut versuchen.",
  config: "Server-Fehlkonfiguration: Spotify-Zugangsdaten fehlen.",
};

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
}

export default async function AdminSpotifyPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; spotify_error?: string }>;
}) {
  // Nicht-Admins sehen ein 404 — die Seite gibt ihre Existenz nicht preis.
  const adminId = await getAdminUserId();
  if (!adminId) notFound();

  const params = await searchParams;
  const errorMessage = params.spotify_error
    ? (ERROR_MESSAGES[params.spotify_error] ??
      "Unbekannter Fehler beim Verbinden. Bitte erneut versuchen.")
    : null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("spotify_connection")
    .select(
      "status, spotify_user_id, spotify_display_name, connected_at, last_error, last_error_at",
    )
    .maybeSingle();
  const connection = data as ConnectionRow | null;

  const accountLabel = connection
    ? (connection.spotify_display_name ?? connection.spotify_user_id)
    : null;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Spotify-Verbindung
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Der verbundene Spotify-Account besitzt die Club-Playlists — in seine
        Playlists schreibt der wöchentliche Push die Gewinner-Songs.
      </p>

      {params.connected && (
        <p className="mt-6 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Spotify-Verbindung hergestellt.
        </p>
      )}
      {errorMessage && (
        <p className="mt-6 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {errorMessage}
        </p>
      )}

      <section className="mt-6 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        {!connection && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Noch kein Spotify-Account verbunden.
          </p>
        )}

        {connection?.status === "connected" && (
          <p className="text-sm">
            Verbunden als{" "}
            <span className="font-medium">{accountLabel}</span>{" "}
            <span className="text-zinc-500">
              (seit {formatWhen(connection.connected_at)})
            </span>
          </p>
        )}

        {connection?.status === "broken" && (
          <div className="text-sm">
            <p className="font-medium text-red-700 dark:text-red-400">
              Verbindung getrennt — bitte neu verbinden.
            </p>
            {connection.last_error && (
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                Letzter Fehler
                {connection.last_error_at
                  ? ` (${formatWhen(connection.last_error_at)})`
                  : ""}
                : {connection.last_error}
              </p>
            )}
          </div>
        )}

        <a
          href="/api/spotify/connect"
          className="mt-4 inline-block rounded border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {connection ? "Neu verbinden" : "Mit Spotify verbinden"}
        </a>
      </section>
    </main>
  );
}
