import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchOwnerProfile,
  OWNER_SCOPES,
} from "./spotify-owner";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("spotify-owner lib", () => {
  beforeEach(() => {
    process.env.SPOTIFY_CLIENT_ID = "cid";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("baut die Authorize-URL mit allen OAuth-Parametern", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "http://127.0.0.1:3000/api/spotify/callback",
        state: "state-123",
      }),
    );

    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toBe(OWNER_SCOPES);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/spotify/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("tauscht den Code mit Basic-Auth und korrektem Body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "acc", refresh_token: "ref" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCodeForTokens(
      "auth-code",
      "http://127.0.0.1:3000/api/spotify/callback",
    );

    expect(tokens).toEqual({ accessToken: "acc", refreshToken: "ref" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("accounts.spotify.com/api/token");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("cid:secret").toString("base64")}`,
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/spotify/callback",
    );
  });

  it("liefert refreshToken=null, wenn Spotify keinen mitschickt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ access_token: "acc" })),
    );
    const tokens = await exchangeCodeForTokens("code", "uri");
    expect(tokens.refreshToken).toBeNull();
  });

  it("wirft beim Exchange, wenn Credentials fehlen", async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    vi.stubGlobal("fetch", vi.fn());
    await expect(exchangeCodeForTokens("code", "uri")).rejects.toThrow(
      /nicht gesetzt/,
    );
  });

  it("wirft beim Exchange bei non-ok Antwort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 400)));
    await expect(exchangeCodeForTokens("code", "uri")).rejects.toThrow(/400/);
  });

  it("mappt das Owner-Profil (display_name optional)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "owner", display_name: "Club" }))
      .mockResolvedValueOnce(jsonResponse({ id: "owner" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchOwnerProfile("acc")).toEqual({
      id: "owner",
      displayName: "Club",
    });
    expect(await fetchOwnerProfile("acc")).toEqual({
      id: "owner",
      displayName: null,
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer acc");
  });

  it("wirft beim Profil-Abruf bei non-ok Antwort", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 401)));
    await expect(fetchOwnerProfile("acc")).rejects.toThrow(/401/);
  });
});
