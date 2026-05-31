import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestMagicLink, signOut } from "./actions";

// Die Server Action hängt an vier Boundaries — alle gemockt, kein echter
// Next-Runtime und kein echtes Supabase. Signaturen exakt treffen:
//   next/headers          -> headers() ist ASYNC (Next 16)
//   next/navigation       -> redirect als no-op vi.fn (würde sonst NEXT_REDIRECT werfen)
//   @/lib/supabase/server -> createClient ASYNC (actions.ts macht `await createClient()`)
//   @/lib/supabase/admin  -> createAdminClient SYNC (Source ist sync)
// Geteilte Stubs über vi.hoisted, weil vi.mock über die Imports gehoisted wird
// und ein bare module-scope const in der Factory in Vitest 4 sonst
// "Cannot access before initialization" wirft.
const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const createUser = vi.fn();
  const from = vi.fn();
  const signInWithOtp = vi.fn();
  const authSignOut = vi.fn();
  const redirect = vi.fn();
  const headersGet = vi.fn();
  return {
    rpc,
    createUser,
    from,
    signInWithOtp,
    authSignOut,
    redirect,
    headersGet,
    fakeAdmin: { rpc, auth: { admin: { createUser } }, from },
    fakeSupa: { auth: { signInWithOtp, signOut: authSignOut } },
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: mocks.headersGet })),
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mocks.fakeSupa),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.fakeAdmin),
}));

const PREV = { status: "idle" as const };

function form(email?: string, code?: string): FormData {
  const f = new FormData();
  if (email !== undefined) f.set("email", email);
  if (code !== undefined) f.set("code", code);
  return f;
}

type QueryResult = { data: unknown; error: unknown };

// Chainable Supabase-Query-Builder-Stub: update/eq/is/or/select geben den
// Builder zurück, maybeSingle löst das gewünschte Ergebnis auf.
function makeQuery(result: QueryResult) {
  const q = {
    update: vi.fn(() => q),
    eq: vi.fn(() => q),
    is: vi.fn(() => q),
    or: vi.fn(() => q),
    select: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Defaults für den Happy Path; einzelne Tests überschreiben per ...Once.
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.createUser.mockResolvedValue({ error: null });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.authSignOut.mockResolvedValue(undefined);
  mocks.headersGet.mockImplementation((key: string) => {
    if (key === "x-forwarded-proto") return "http";
    if (key === "host") return "127.0.0.1:3000";
    return null;
  });
});

describe("requestMagicLink — Validierung", () => {
  it("lehnt ungültige E-Mail ab, ohne Supabase zu berühren", async () => {
    const res = await requestMagicLink(PREV, form("kein-email", "ABC"));
    expect(res).toEqual({
      status: "error",
      error: "Bitte eine gültige E-Mail eingeben.",
      lastCode: "ABC",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("normalisiert E-Mail (trim + lowercase) vor dem RPC-Lookup", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "uuid-1", error: null });
    await requestMagicLink(PREV, form("  USER@Example.COM  ", ""));
    expect(mocks.rpc).toHaveBeenCalledWith("user_id_by_email", {
      p_email: "user@example.com",
    });
  });

  it("gibt Server-Fehler zurück, wenn der RPC-Lookup fehlschlägt", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const res = await requestMagicLink(PREV, form("user@example.com", "X"));
    expect(res).toEqual({
      status: "error",
      error: "Server-Fehler. Bitte später erneut versuchen.",
      lastCode: "X",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("requestMagicLink — existierender User", () => {
  it("überspringt Invite-Code + createUser und sendet Magic Link (Origin aus Host-Header)", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "uuid-123", error: null });
    const res = await requestMagicLink(PREV, form("user@example.com", ""));

    expect(res).toEqual({
      status: "success",
      message:
        "Magic Link wurde an user@example.com gesendet. Bitte E-Mail-Postfach prüfen.",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://127.0.0.1:3000/auth/callback",
      },
    });
  });

  it("bevorzugt NEXT_PUBLIC_SITE_URL gegenüber dem Host-Header", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
    mocks.rpc.mockResolvedValueOnce({ data: "uuid-123", error: null });

    await requestMagicLink(PREV, form("user@example.com", ""));

    expect(mocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example.com/auth/callback",
        }),
      }),
    );
    expect(mocks.headersGet).not.toHaveBeenCalled();
  });

  it("meldet Fehler, wenn signInWithOtp fehlschlägt", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "uuid-123", error: null });
    mocks.signInWithOtp.mockResolvedValueOnce({ error: { message: "smtp" } });

    const res = await requestMagicLink(PREV, form("user@example.com", ""));
    expect(res).toEqual({
      status: "error",
      error: "Magic Link konnte nicht gesendet werden.",
      lastCode: "",
    });
  });
});

describe("requestMagicLink — neuer User", () => {
  it("verlangt einen Invite-Code, wenn die E-Mail unbekannt ist", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const res = await requestMagicLink(PREV, form("neu@example.com", ""));
    expect(res).toEqual({
      status: "error",
      error: "Diese E-Mail ist uns nicht bekannt. Bitte Invite-Code angeben.",
      lastCode: "",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("claimt den Code atomar, legt den User an und trägt invite in den Redirect", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const claimQ = makeQuery({ data: { code: "GOOD" }, error: null });
    mocks.from.mockReturnValueOnce(claimQ);

    const res = await requestMagicLink(PREV, form("neu@example.com", "GOOD"));

    expect(res.status).toBe("success");
    // atomarer Claim: UPDATE used_at WHERE code=GOOD AND used_at IS NULL AND (nicht abgelaufen)
    expect(mocks.from).toHaveBeenCalledWith("invite_codes");
    expect(claimQ.update).toHaveBeenCalledWith({ used_at: expect.any(String) });
    expect(claimQ.eq).toHaveBeenCalledWith("code", "GOOD");
    expect(claimQ.is).toHaveBeenCalledWith("used_at", null);
    expect(claimQ.or).toHaveBeenCalledWith(
      expect.stringContaining("expires_at.is.null,expires_at.gt."),
    );
    expect(claimQ.select).toHaveBeenCalledWith("code");
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "neu@example.com",
      email_confirm: true,
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "neu@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://127.0.0.1:3000/auth/callback?invite=GOOD",
      },
    });
  });

  it.each(["email_exists", "user_already_exists"])(
    "toleriert createUser-Fehler %s (User existiert in auth bereits)",
    async (code) => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
      mocks.from.mockReturnValueOnce(
        makeQuery({ data: { code: "GOOD" }, error: null }),
      );
      mocks.createUser.mockResolvedValueOnce({ error: { code } });

      const res = await requestMagicLink(PREV, form("neu@example.com", "GOOD"));
      expect(res.status).toBe("success");
    },
  );

  it("bricht bei echtem createUser-Fehler ab", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.from.mockReturnValueOnce(
      makeQuery({ data: { code: "GOOD" }, error: null }),
    );
    mocks.createUser.mockResolvedValueOnce({ error: { code: "unexpected" } });

    const res = await requestMagicLink(PREV, form("neu@example.com", "GOOD"));
    expect(res).toEqual({
      status: "error",
      error: "Account konnte nicht angelegt werden.",
      lastCode: "GOOD",
    });
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("meldet Server-Fehler, wenn der Code-Claim selbst fehlschlägt", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.from.mockReturnValueOnce(
      makeQuery({ data: null, error: { message: "db down" } }),
    );

    const res = await requestMagicLink(PREV, form("neu@example.com", "GOOD"));
    expect(res).toEqual({
      status: "error",
      error: "Server-Fehler beim Code-Check.",
      lastCode: "GOOD",
    });
  });
});

describe("requestMagicLink — Diagnose nach fehlgeschlagenem Claim", () => {
  // Claim liefert null -> zweite from()-Abfrage erklärt warum.
  function arrangeFailedClaim(diagnostic: QueryResult) {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.from.mockReturnValueOnce(makeQuery({ data: null, error: null })); // Claim
    mocks.from.mockReturnValueOnce(makeQuery(diagnostic)); // Diagnose
  }

  it("unbekannter Code", async () => {
    arrangeFailedClaim({ data: null, error: null });
    const res = await requestMagicLink(PREV, form("neu@example.com", "NOPE"));
    expect(res).toMatchObject({ error: "Invite-Code unbekannt.", lastCode: "NOPE" });
  });

  it("bereits eingelöster Code", async () => {
    arrangeFailedClaim({
      data: { used_at: new Date().toISOString(), expires_at: null },
      error: null,
    });
    const res = await requestMagicLink(PREV, form("neu@example.com", "USED"));
    expect(res).toMatchObject({
      error: "Invite-Code wurde bereits eingelöst.",
      lastCode: "USED",
    });
  });

  it("abgelaufener Code", async () => {
    arrangeFailedClaim({
      data: { used_at: null, expires_at: "2000-01-01T00:00:00.000Z" },
      error: null,
    });
    const res = await requestMagicLink(PREV, form("neu@example.com", "OLD"));
    expect(res).toMatchObject({
      error: "Invite-Code ist abgelaufen.",
      lastCode: "OLD",
    });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("meldet ab und redirected danach nach /login (in dieser Reihenfolge)", async () => {
    await signOut();
    expect(mocks.authSignOut).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.authSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
  });
});
