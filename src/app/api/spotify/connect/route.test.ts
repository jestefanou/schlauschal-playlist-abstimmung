import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";

// Boundary der Connect-Route, gemockt: @/lib/admin -> getAdminUserId.
// buildAuthorizeUrl/STATE_COOKIE bleiben echt — geprüft wird das Zusammenspiel:
// Admin-Gate, state-Cookie und die Weiterleitung zum Spotify-Consent.
const mocks = vi.hoisted(() => ({
  getAdminUserId: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  getAdminUserId: mocks.getAdminUserId,
}));

function makeRequest() {
  return new NextRequest("http://127.0.0.1:3000/api/spotify/connect");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
  vi.stubEnv("SPOTIFY_CLIENT_ID", "cid");
  mocks.getAdminUserId.mockResolvedValue("admin-uuid");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/spotify/connect", () => {
  it("leitet Nicht-Admins auf / um", async () => {
    mocks.getAdminUserId.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("meldet 'config', wenn SPOTIFY_CLIENT_ID fehlt", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    const res = await GET(makeRequest());
    const url = new URL(res.headers.get("location") ?? "");
    expect(url.pathname).toBe("/admin/spotify");
    expect(url.searchParams.get("spotify_error")).toBe("config");
  });

  it("leitet zum Spotify-Consent und setzt den state-Cookie passend", async () => {
    const res = await GET(makeRequest());

    const url = new URL(res.headers.get("location") ?? "");
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/spotify/callback",
    );

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("spotify_oauth_state=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("Path=/api/spotify");

    // Der state im Redirect muss dem Cookie-Wert entsprechen (CSRF-Paar).
    const cookieState = /spotify_oauth_state=([^;]+)/.exec(setCookie)?.[1];
    expect(url.searchParams.get("state")).toBe(cookieState);
  });
});
