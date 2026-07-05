import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Wöchentlicher Cycle-Rollover (Schritt 6a), getriggert von Vercel Cron
// (vercel.json). Die eigentliche Arbeit — überfällige Cycles schließen,
// Gewinner in cycle_winners schreiben, Folge-Cycle öffnen — passiert
// transaktional in der DB-Funktion rollover_due_cycles (nur service_role).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET is not set");
    return NextResponse.json({ error: "Server-Fehlkonfiguration." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rollover_due_cycles");
  if (error) {
    console.error("rollover_due_cycles failed", error);
    return NextResponse.json({ error: "Rollover fehlgeschlagen." }, { status: 500 });
  }

  return NextResponse.json(data);
}
