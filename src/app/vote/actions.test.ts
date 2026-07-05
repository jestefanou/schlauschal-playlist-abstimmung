import { beforeEach, describe, expect, it, vi } from "vitest";

import { castVote, withdrawVote } from "./actions";

// Boundaries der Vote-Actions, alle gemockt:
//   @/lib/supabase/server -> createClient ASYNC
//   next/cache            -> revalidatePath (no-op)
// Die harten Regeln (Phase, Budget, Doppel-Stimme) liegen in der DB; hier wird
// nur das Fehlercode-Mapping und der 0-Zeilen-Pfad getestet.
const mocks = vi.hoisted(() => {
  const from = vi.fn();
  const getClaims = vi.fn();
  const revalidatePath = vi.fn();
  return {
    from,
    getClaims,
    revalidatePath,
    fakeSupa: { auth: { getClaims }, from },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => mocks.fakeSupa),
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// Thenable, chainable Query-Builder-Stub (vgl. songs/actions.test.ts).
function makeBuilder(result: { data?: unknown; error: unknown }) {
  const b: Record<string, ReturnType<typeof vi.fn>> & {
    then: (resolve: (v: unknown) => void) => void;
  } = { then: (resolve) => resolve(result) };
  for (const m of ["select", "insert", "delete", "eq"]) {
    b[m] = vi.fn(() => b);
  }
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
});

describe("castVote", () => {
  it("verlangt eine Nomination", async () => {
    const res = await castVote("");
    expect(res).toEqual({ status: "error", error: "Kein Song ausgewählt." });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("lehnt nicht eingeloggte Aufrufe ab", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null } });
    const res = await castVote("nom-1");
    expect(res).toEqual({ status: "error", error: "Nicht eingeloggt." });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fügt die Stimme ein und revalidiert (Happy Path)", async () => {
    const builder = makeBuilder({ error: null });
    mocks.from.mockReturnValueOnce(builder);

    const res = await castVote("nom-1");

    expect(res).toEqual({ status: "success" });
    expect(mocks.from).toHaveBeenCalledWith("votes");
    expect(builder.insert).toHaveBeenCalledWith({
      nomination_id: "nom-1",
      user_id: "user-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/vote");
  });

  it("übersetzt den Budget-Trigger (P0001) in eine Budget-Meldung", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({
        error: {
          code: "P0001",
          message: "Stimmen-Budget für diesen Cycle erschöpft (max 3 Stimmen)",
        },
      }),
    );

    const res = await castVote("nom-1");
    expect(res).toEqual({
      status: "error",
      error: "Dein Stimmen-Budget für diese Playlist ist aufgebraucht.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("übersetzt die Unique-Verletzung (23505) in Doppel-Stimmen-Meldung", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({ error: { code: "23505", message: "duplicate key" } }),
    );

    const res = await castVote("nom-1");
    expect(res).toEqual({
      status: "error",
      error: "Du hast für diesen Song schon gestimmt.",
    });
  });

  it("übersetzt RLS-Verletzung (42501) in Phasen-Meldung", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({ error: { code: "42501", message: "rls" } }),
    );

    const res = await castVote("nom-1");
    expect(res).toEqual({
      status: "error",
      error: "Abstimmen ist für diesen Song gerade nicht möglich.",
    });
  });

  it("meldet generischen Fehler bei unbekanntem Fehlercode", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({ error: { code: "XX000", message: "boom" } }),
    );

    const res = await castVote("nom-1");
    expect(res).toEqual({
      status: "error",
      error: "Abstimmen fehlgeschlagen. Bitte später erneut versuchen.",
    });
  });
});

describe("withdrawVote", () => {
  it("löscht die eigene Stimme und revalidiert (Happy Path)", async () => {
    const builder = makeBuilder({ data: [{ id: "v1" }], error: null });
    mocks.from.mockReturnValueOnce(builder);

    const res = await withdrawVote("nom-1");

    expect(res).toEqual({ status: "success" });
    expect(mocks.from).toHaveBeenCalledWith("votes");
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("nomination_id", "nom-1");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.select).toHaveBeenCalledWith("id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/vote");
  });

  it("lehnt nicht eingeloggte Aufrufe ab", async () => {
    mocks.getClaims.mockResolvedValueOnce({ data: { claims: null } });
    const res = await withdrawVote("nom-1");
    expect(res).toEqual({ status: "error", error: "Nicht eingeloggt." });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("meldet error, wenn RLS das DELETE auf 0 Zeilen filtert (Phase vorbei)", async () => {
    mocks.from.mockReturnValueOnce(makeBuilder({ data: [], error: null }));

    const res = await withdrawVote("nom-1");

    expect(res).toEqual({
      status: "error",
      error: "Stimme konnte nicht zurückgezogen werden (Abstimmung vorbei?).",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("gibt error zurück und revalidiert NICHT, wenn das DELETE scheitert", async () => {
    mocks.from.mockReturnValueOnce(
      makeBuilder({ data: null, error: { message: "boom" } }),
    );

    const res = await withdrawVote("nom-1");

    expect(res).toEqual({
      status: "error",
      error: "Zurückziehen fehlgeschlagen. Bitte später erneut versuchen.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
