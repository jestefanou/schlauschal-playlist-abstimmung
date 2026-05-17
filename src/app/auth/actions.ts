"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type LoginState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; error: string; lastCode?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    return {
      status: "error",
      error: "Bitte eine gültige E-Mail eingeben.",
      lastCode: code,
    };
  }

  const admin = createAdminClient();

  const { data: usersPage, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.error("listUsers failed", listErr);
    return {
      status: "error",
      error: "Server-Fehler. Bitte später erneut versuchen.",
      lastCode: code,
    };
  }
  const existingUser = usersPage.users.find(
    (u) => u.email?.toLowerCase() === email,
  );

  let validatedCode: string | null = null;
  if (!existingUser) {
    if (!code) {
      return {
        status: "error",
        error:
          "Diese E-Mail ist uns nicht bekannt. Bitte Invite-Code angeben.",
        lastCode: code,
      };
    }

    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("invite_codes")
      .update({ used_at: nowIso })
      .eq("code", code)
      .is("used_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .select("code")
      .maybeSingle();

    if (claimErr) {
      console.error("invite_codes claim failed", claimErr);
      return {
        status: "error",
        error: "Server-Fehler beim Code-Check.",
        lastCode: code,
      };
    }

    if (!claimed) {
      const { data: invite } = await admin
        .from("invite_codes")
        .select("used_at, expires_at")
        .eq("code", code)
        .maybeSingle();
      if (!invite) {
        return {
          status: "error",
          error: "Invite-Code unbekannt.",
          lastCode: code,
        };
      }
      if (invite.used_at) {
        return {
          status: "error",
          error: "Invite-Code wurde bereits eingelöst.",
          lastCode: code,
        };
      }
      return {
        status: "error",
        error: "Invite-Code ist abgelaufen.",
        lastCode: code,
      };
    }
    validatedCode = code;

    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr) {
      const errCode = (createErr as { code?: string }).code;
      if (errCode !== "email_exists" && errCode !== "user_already_exists") {
        console.error("createUser failed", createErr);
        return {
          status: "error",
          error: "Account konnte nicht angelegt werden.",
          lastCode: code,
        };
      }
    }
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "127.0.0.1:3000";
  const callbackUrl = new URL("/auth/callback", `${proto}://${host}`);
  if (validatedCode) {
    callbackUrl.searchParams.set("invite", validatedCode);
  }

  const supabase = await createClient();
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (otpErr) {
    console.error("signInWithOtp failed", otpErr);
    return {
      status: "error",
      error: "Magic Link konnte nicht gesendet werden.",
      lastCode: code,
    };
  }

  return {
    status: "success",
    message: `Magic Link wurde an ${email} gesendet. Bitte E-Mail-Postfach prüfen.`,
  };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
