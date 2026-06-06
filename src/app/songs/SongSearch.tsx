"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchSpotifyTracks, nominateSong } from "./actions";
import type { SpotifyTrack } from "@/lib/spotify";

type Playlist = { id: string; name: string };

export function SongSearch({ playlists }: { playlists: Playlist[] }) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<SpotifyTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced Live-Suche im Event-Handler (kein Effekt mit synchronem setState).
  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);

    const q = value.trim();
    if (q.length < 2) {
      // reqId mit-erhöhen, damit eine noch laufende ältere Suche beim Auflösen
      // verworfen wird und nicht die geleerte Liste wieder befüllt.
      reqId.current += 1;
      setTracks([]);
      setError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const id = ++reqId.current;
    timer.current = setTimeout(async () => {
      const res = await searchSpotifyTracks(q);
      if (id !== reqId.current) return; // veraltete Antwort verwerfen
      if (res.status === "success") {
        setTracks(res.tracks);
        setError(null);
      } else if (res.status === "error") {
        setTracks([]);
        setError(res.error);
      } else {
        setTracks([]);
        setError(null);
      }
      setSearching(false);
    }, 300);
  }

  // Beim Unmount einen noch laufenden Debounce-Timer aufräumen.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const showEmpty =
    !searching && !error && query.trim().length >= 2 && tracks.length === 0;

  return (
    <div className="mt-6">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Song oder Artist suchen…"
        className="w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        autoFocus
      />
      {searching && <p className="mt-2 text-sm text-zinc-500">Suche…</p>}
      {error && (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      {showEmpty && (
        <p className="mt-2 text-sm text-zinc-500">Keine Treffer.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {tracks.map((t) => (
          <TrackRow key={t.spotifyTrackId} track={t} playlists={playlists} />
        ))}
      </ul>
    </div>
  );
}

function TrackRow({
  track,
  playlists,
}: {
  track: SpotifyTrack;
  playlists: Playlist[];
}) {
  // Bei nur einer Playlist ist sie vorausgewählt.
  const [selected, setSelected] = useState<string[]>(
    playlists.length === 1 ? [playlists[0].id] : [],
  );
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const res = await nominateSong(track, selected);
      if (res.status === "success") {
        const parts = [`${res.nominated} Playlist(s)`];
        if (res.skipped) parts.push(`${res.skipped} schon vorhanden`);
        setMsg({ kind: "ok", text: `Vorgeschlagen: ${parts.join(", ")}.` });
      } else {
        setMsg({ kind: "err", text: res.error });
      }
    });
  }

  return (
    <li className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        {track.albumArtUrl ? (
          // Externe Spotify-CDN-URL, winziges Thumbnail -> next/image-Optimizer
          // lohnt nicht (bräuchte zudem images.remotePatterns).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.albumArtUrl}
            alt=""
            className="h-12 w-12 rounded object-cover"
          />
        ) : (
          <div className="h-12 w-12 rounded bg-zinc-200 dark:bg-zinc-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{track.title}</div>
          <div className="truncate text-xs text-zinc-500">{track.artist}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {playlists.map((p) => (
          <label
            key={p.id}
            className="flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
          >
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            {p.name}
          </label>
        ))}
        <button
          type="button"
          onClick={submit}
          disabled={pending || selected.length === 0}
          className="ml-auto rounded bg-black px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {pending ? "…" : "Vorschlagen"}
        </button>
      </div>
      {msg && (
        <p
          className={`mt-2 text-xs ${
            msg.kind === "ok"
              ? "text-green-800 dark:text-green-200"
              : "text-red-800 dark:text-red-200"
          }`}
        >
          {msg.text}
        </p>
      )}
    </li>
  );
}
