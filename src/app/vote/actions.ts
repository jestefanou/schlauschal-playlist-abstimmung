"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type VoteResult =
  | { status: "success" }
  | { status: "error"; error: string };

// Stimme abgeben. Die harten Regeln erzwingt die DB (RLS: Abstimmungsphase eines
// offenen Cycles; Trigger: Stimmen-Budget; Unique: max. 1 Stimme pro Song) —
// hier werden ihre Fehlercodes nur in verständliche Meldungen übersetzt, weil
// zwischen Seiten-Render und Klick jede dieser Regeln kippen kann.
export async function castVote(nominationId: string): Promise<VoteResult> {
  if (!nominationId) {
    return { status: "error", error: "Kein Song ausgewählt." };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { status: "error", error: "Nicht eingeloggt." };

  const { error } = await supabase
    .from("votes")
    .insert({ nomination_id: nominationId, user_id: userId });

  if (error) {
    if (error.code === "P0001" && error.message?.includes("Stimmen-Budget")) {
      return {
        status: "error",
        error: "Dein Stimmen-Budget für diese Playlist ist aufgebraucht.",
      };
    }
    if (error.code === "23505") {
      return { status: "error", error: "Du hast für diesen Song schon gestimmt." };
    }
    if (error.code === "42501") {
      return {
        status: "error",
        error: "Abstimmen ist für diesen Song gerade nicht möglich.",
      };
    }
    console.error("castVote failed", error);
    return {
      status: "error",
      error: "Abstimmen fehlgeschlagen. Bitte später erneut versuchen.",
    };
  }

  revalidatePath("/vote");
  return { status: "success" };
}

// Eigene Stimme zurückziehen. RLS erlaubt das nur in der Abstimmungsphase eines
// offenen Cycles; außerhalb löscht das DELETE schlicht 0 Zeilen — deshalb wird
// die Trefferzahl geprüft statt nur auf error zu schauen.
export async function withdrawVote(nominationId: string): Promise<VoteResult> {
  if (!nominationId) {
    return { status: "error", error: "Kein Song ausgewählt." };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  if (!userId) return { status: "error", error: "Nicht eingeloggt." };

  const { data: deleted, error } = await supabase
    .from("votes")
    .delete()
    .eq("nomination_id", nominationId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error("withdrawVote failed", error);
    return {
      status: "error",
      error: "Zurückziehen fehlgeschlagen. Bitte später erneut versuchen.",
    };
  }
  if (!deleted?.length) {
    return {
      status: "error",
      error: "Stimme konnte nicht zurückgezogen werden (Abstimmung vorbei?).",
    };
  }

  revalidatePath("/vote");
  return { status: "success" };
}
