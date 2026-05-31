import { defineConfig } from "@playwright/test";

// Lokale Supabase-Keys aus .env.local laden (Node 22+/24 built-in). In CI fehlt
// die Datei — dort kommen die Vars direkt aus `supabase status -o env`, darum try/catch.
try {
  process.loadEnvFile(".env.local");
} catch {
  // kein .env.local (z.B. CI) — Env kommt aus der Umgebung.
}

const HOST = "127.0.0.1"; // NIE localhost — GoTrue-Redirect-Allowlist + Origin-Resolution
const PORT = 3000;
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // eine geteilte Mailpit-Inbox -> seriell
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    // Production-Parität: bauen + starten. NEXT_PUBLIC_SITE_URL muss schon beim
    // BUILD gesetzt sein (Next inlinet NEXT_PUBLIC_*), darum gilt env für `build && start`.
    command: `pnpm build && pnpm exec next start --port ${PORT} --hostname ${HOST}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
