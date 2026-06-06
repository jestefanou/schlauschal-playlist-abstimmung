import { beforeEach, describe, expect, it } from "vitest";

import { rateLimit, __resetRateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimit());

  it("erlaubt bis zum Limit und blockt danach im selben Fenster", () => {
    const t0 = 1_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 10_000, t0).allowed).toBe(true);
    }
    const blocked = rateLimit("k", 3, 10_000, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(10_000);
  });

  it("öffnet ein neues Fenster nach Ablauf", () => {
    rateLimit("k", 1, 10_000, 1_000);
    expect(rateLimit("k", 1, 10_000, 5_000).allowed).toBe(false);
    expect(rateLimit("k", 1, 10_000, 11_000).allowed).toBe(true);
  });

  it("hält Schlüssel unabhängig", () => {
    expect(rateLimit("a", 1, 10_000, 1_000).allowed).toBe(true);
    expect(rateLimit("a", 1, 10_000, 1_000).allowed).toBe(false);
    expect(rateLimit("b", 1, 10_000, 1_000).allowed).toBe(true);
  });
});
