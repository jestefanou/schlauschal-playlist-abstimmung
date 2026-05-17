import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const invite = searchParams.get("invite");
  const errorDescription = searchParams.get("error_description");

  if (errorDescription) {
    const url = new URL("/login", origin);
    url.searchParams.set("auth_error", errorDescription);
    return NextResponse.redirect(url);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("exchangeCodeForSession failed", error);
    const url = new URL("/login", origin);
    url.searchParams.set("auth_error", "Magic Link ungültig oder abgelaufen.");
    return NextResponse.redirect(url);
  }

  if (invite && data.user) {
    const admin = createAdminClient();
    const { error: updateErr } = await admin
      .from("invite_codes")
      .update({ used_by: data.user.id })
      .eq("code", invite)
      .is("used_by", null);
    if (updateErr) {
      console.error("invite_codes set used_by failed", updateErr);
    }
  }

  return NextResponse.redirect(new URL("/", origin));
}
