// Einfaches In-Memory-Rate-Limit (Fixed Window) pro Schlüssel — z. B. pro User.
// Gilt pro Server-Instanz (kein verteilter Store); für die Projektgröße ausreichend.
// Schützt geteilte Ressourcen (z. B. das instanzweite Spotify-App-Token), deren
// clientseitiges Debounce ein authentifizierter Aufrufer umgehen könnte.

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/**
 * Erlaubt bis zu `limit` Aufrufe je `windowMs`-Fenster pro `key`.
 * `now` ist injizierbar (Tests). Gibt `retryAfterMs` für UI-Hinweise zurück.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (w.count < limit) {
    w.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: false, retryAfterMs: w.resetAt - now };
}

/** Nur für Tests: internen Zustand leeren. */
export function __resetRateLimit(): void {
  buckets.clear();
}
