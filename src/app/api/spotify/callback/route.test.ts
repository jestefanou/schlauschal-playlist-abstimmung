import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";

// Boundaries der Callback-Route, gemockt:
//   @/lib/admin          -> getAdminUserId (Admin-Gate)
//   @/lib/spotify-owner  -> exchangeCodeForTokens / fetchOwnerProfile
//                           (Konstanten wie STATE_COOKIE bleiben echt)
//   @/lib/supabase/admin -> createAdminClient (RPC + Upsert)
const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const upsert = vi.fn();
  return {
    getAdminUserId: vi.fn(),
    exchange: vi.fn(),
    profile: vi.fn(),
    rpc,
    upsert,
    fakeAdmin: { rpc, from: vi.fn(() => ({ upsert })) },
  };
});

vi.mock("@/lib/admin", () => ({
  getAdminUserId: mocks.getAdminUserId,
}));

vi.mock("@/lib/spotify-owner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spotify-owner")>();
  return {
    ...actual,
    exchangeCodeForTokens: mocks.exchange,
    fetchOwnerProfile: mocks.profile,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.fakeAdmin),
}));

function makeRequest(query: string, stateCookie?: string) {
  return new NextRequest(
    `http://127.0.0.1:3000/api/spotify/callback${query}`,
    stateCookie === undefined
      ? {}
      : { headers: { cookie: `spotify_oauth_state=${stateCookie}` } },
  );
}

function locationOf(res: Response) {
  return new URL(res.headers.get("location") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
  mocks.getAdminUserId.mockResolvedValue("admin-uuid");
  mocks.exchange.mockResolvedValue({
    accessToken: "acc",
    refreshToken: "ref",
  });
  mocks.profile.mockResolvedValue({ id: "owner", displayName: "Club" });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/spotify/callback", () => {
  it("leitet Nicht-Admins auf / um, ohne Spotify anzufassen", async () => {
    mocks.getAdminUserId.mockResolvedValue(null);
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).pathname).toBe("/");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("meldet 'denied', wenn Spotify einen error zurückgibt", async () => {
    const res = await GET(makeRequest("?error=access_denied&state=s", "s"));
    const url = locationOf(res);
    expect(url.pathname).toBe("/admin/spotify");
    expect(url.searchParams.get("spotify_error")).toBe("denied");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("meldet 'state' bei fehlendem oder abweichendem state", async () => {
    const mismatch = await GET(makeRequest("?code=c&state=a", "b"));
    expect(locationOf(mismatch).searchParams.get("spotify_error")).toBe("state");

    const noCookie = await GET(makeRequest("?code=c&state=a"));
    expect(locationOf(noCookie).searchParams.get("spotify_error")).toBe("state");

    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("meldet 'exchange', wenn der Code fehlt", async () => {
    const res = await GET(makeRequest("?state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("exchange");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it("meldet 'exchange', wenn der Token-Tausch scheitert", async () => {
    mocks.exchange.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("exchange");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("meldet 'exchange', wenn kein refresh_token mitkommt", async () => {
    mocks.exchange.mockResolvedValue({ accessToken: "acc", refreshToken: null });
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("exchange");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("meldet 'profile', wenn der Profil-Abruf scheitert", async () => {
    mocks.profile.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("profile");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("meldet 'store', wenn die Token-RPC fehlschlägt — Status bleibt unangetastet", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" } });
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("store");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("meldet 'store', wenn das Status-Upsert fehlschlägt", async () => {
    mocks.upsert.mockResolvedValue({ error: { message: "boom" } });
    const res = await GET(makeRequest("?code=c&state=s", "s"));
    expect(locationOf(res).searchParams.get("spotify_error")).toBe("store");
  });

  it("speichert Token vor Status und meldet Erfolg", async () => {
    const res = await GET(makeRequest("?code=c&state=s", "s"));

    expect(mocks.exchange).toHaveBeenCalledWith(
      "c",
      "http://127.0.0.1:3000/api/spotify/callback",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("set_spotify_refresh_token", {
      p_token: "ref",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: true,
        status: "connected",
        spotify_user_id: "owner",
        spotify_display_name: "Club",
        connected_by: "admin-uuid",
        last_error: null,
        last_error_at: null,
      }),
    );
    // Erst der Token in den Vault, dann der Status.
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsert.mock.invocationCallOrder[0],
    );

    const url = locationOf(res);
    expect(url.pathname).toBe("/admin/spotify");
    expect(url.searchParams.get("connected")).toBe("1");
  });

  it("löscht den state-Cookie in jedem Ausgang", async () => {
    const success = await GET(makeRequest("?code=c&state=s", "s"));
    const errorCase = await GET(makeRequest("?error=access_denied", "s"));

    for (const res of [success, errorCase]) {
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("spotify_oauth_state=;");
      expect(setCookie).toContain("Max-Age=0");
    }
  });
});
