import { createClient } from "@/lib/supabase/server";

// Liefert die User-ID des eingeloggten Users, wenn er Admin ist — sonst null.
// profiles ist für authenticated lesbar (profiles_select_authenticated); der
// Check läuft serverseitig, das Ergebnis gated Admin-Seiten und -Routen.
export async function getAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  return profile?.is_admin ? userId : null;
}
