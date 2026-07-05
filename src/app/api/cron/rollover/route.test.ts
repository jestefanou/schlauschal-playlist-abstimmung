import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

// Boundary der Cron-Route, gemockt: @/lib/supabase/admin -> createAdminClient.
// Die Rollover-Logik selbst liegt in der DB-Funktion rollover_due_cycles und
// wird in supabase/tests/030-rollover.test.sql (pgTAP) getestet — hier geht es
// nur um Auth-Gate und Durchreichen von Ergebnis/Fehler.
const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, fakeAdmin: { rpc } };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => mocks.fakeAdmin),
}));

function makeRequest(auth?: string) {
  return new Request("http://127.0.0.1:3000/api/cron/rollover", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/rollover", () => {
  it("antwortet 500, wenn CRON_SECRET nicht konfiguriert ist", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("antwortet 401 ohne Authorization-Header", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("antwortet 401 bei falschem Secret", async () => {
    const res = await GET(makeRequest("Bearer falsch"));
    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ruft rollover_due_cycles auf und liefert dessen Ergebnis", async () => {
    const summary = { rolled: 1, cycles: [{ winners: 3 }] };
    mocks.rpc.mockResolvedValue({ data: summary, error: null });

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(mocks.rpc).toHaveBeenCalledWith("rollover_due_cycles");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
  });

  it("antwortet 500, wenn die RPC fehlschlägt", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
  });
});
