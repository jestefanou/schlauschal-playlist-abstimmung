import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clearInbox, getMagicLink } from "./helpers/mailpit";

// Service-Role-Client zum Seeden (Invite-Code) und Aufräumen (User löschen).
// Bypassed RLS, hat alle Grants. Keys aus .env.local (lokal) bzw. CI-Env.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.describe("Auth: Magic-Link-Flow", () => {
  let admin: SupabaseClient;

  test.beforeAll(() => {
    admin = adminClient();
  });

  test.beforeEach(async () => {
    await clearInbox();
  });

  test("Erst-Login mit gültigem Invite-Code führt in die eingeloggte App", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `e2e-${stamp}@test.local`;
    const code = `E2E-${stamp}`;

    const { error: seedErr } = await admin
      .from("invite_codes")
      .insert({ code, note: "e2e" });
    expect(seedErr, "Invite-Code-Seed").toBeNull();

    try {
      await page.goto("/login");
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="code"]', code);
      await page.getByRole("button", { name: "Magic Link anfordern" }).click();

      // Server Action erfolgreich -> Bestätigung im UI.
      await expect(page.getByText(/Magic Link wurde an .* gesendet/)).toBeVisible();

      // Mail kommt asynchron in Mailpit an -> pollen, Link extrahieren.
      let link: string | null = null;
      await expect
        .poll(
          async () => {
            link = await getMagicLink(email);
            return link;
          },
          { timeout: 15_000, message: "Magic-Link-Mail kam nicht in Mailpit an" },
        )
        .not.toBeNull();

      // WICHTIG: im SELBEN Context öffnen — der PKCE-Code-Verifier-Cookie
      // (sb-127-auth-token-code-verifier) liegt auf genau diesem Browser.
      await page.goto(link!);

      // GoTrue /verify -> /auth/callback -> exchangeCodeForSession -> Redirect auf /.
      await page.waitForURL("http://127.0.0.1:3000/");
      await expect(
        page.getByRole("button", { name: "Abmelden" }),
      ).toBeVisible();
    } finally {
      const { data: uid } = await admin.rpc("user_id_by_email", {
        p_email: email,
      });
      if (uid) await admin.auth.admin.deleteUser(uid as string);
      await admin.from("invite_codes").delete().eq("code", code);
      await clearInbox();
    }
  });

  test("Unbekannter Invite-Code zeigt eine Fehlermeldung", async ({ page }) => {
    const email = `e2e-bad-${Date.now()}@test.local`;

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="code"]', "GIBTS-NICHT");
    await page.getByRole("button", { name: "Magic Link anfordern" }).click();

    await expect(page.getByText("Invite-Code unbekannt.")).toBeVisible();
  });
});
