// Helfer für den lokalen Mailpit (Supabase-CLI-Mailserver auf Port 54324).
// REST-API-Doku: https://mailpit.axllent.org/docs/api-v1/

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Leert die komplette Inbox (vor/nach jedem Test). */
export async function clearInbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

/**
 * Holt die neueste Mail an `email` und extrahiert den GoTrue-Magic-Link aus dem
 * Text-Body (Text statt HTML, um &amp;-Entities zu vermeiden). Gibt `null` zurück,
 * wenn (noch) keine passende Mail da ist — gedacht für `expect.poll`.
 */
export async function getMagicLink(email: string): Promise<string | null> {
  const res = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`,
  );
  if (!res.ok) return null;

  const { messages } = (await res.json()) as { messages?: { ID: string }[] };
  if (!messages?.length) return null;

  const msgRes = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
  if (!msgRes.ok) return null;

  const { Text } = (await msgRes.json()) as { Text: string };
  const match = Text.match(/https?:\/\/[^\s"<>]*\/auth\/v1\/verify[^\s"<>]*/);
  return match ? match[0] : null;
}
