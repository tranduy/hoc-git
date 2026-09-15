import { describe, expect, it } from "vitest";
import type { RedactedSessionStatus } from "@tool-chenh/contracts";
import { CatalogSourceRegistry } from "./catalog-source-registry.js";

const NOW = 1_700_000_000_000;

const session = (changes: Partial<RedactedSessionStatus> = {}): RedactedSessionStatus => ({
  id: "session-1", provider: "BTI", category: "FOOTBALL", source: "FABET_LOGIN",
  state: "ACTIVE", trustedHostname: null, acquiredAtMs: NOW - 60_000,
  lastValidatedAtMs: NOW - 60_000, renewAfterMs: NOW + 60_000, nextRetryAtMs: null,
  secretConfigured: true, reason: null, ...changes
});

const registry = (sessions: readonly RedactedSessionStatus[]) => new CatalogSourceRegistry({
  sessions: { listStatuses: async () => ({ sessions }) } as never,
  accounts: {} as never,
  supportedPairs: [{ provider: "BTI", category: "FOOTBALL", alias: "BTI" }] as never,
  clock: { nowMs: () => NOW }
});

describe("a session that outlived its renewal deadline", () => {
  it("reports EXPIRED rather than a clean ACTIVE", async () => {
    // Measured live: fourteen sessions reported ACTIVE and not one was usable,
    // the newest twenty-seven hours past renewal, with no retry pending and no
    // reason recorded. Every preflight was refused and nothing said why.
    const [status] = await registry([session({ renewAfterMs: NOW - 1 })]).listStatuses();
    expect(status?.sessionState).toBe("ACTIVE");
    expect(status?.reason).toBe("EXPIRED");
  });

  it("treats a session with no renewal deadline the same way", async () => {
    const [status] = await registry([session({ renewAfterMs: null })]).listStatuses();
    expect(status?.reason).toBe("EXPIRED");
  });

  it("leaves a session inside its deadline alone", async () => {
    const [status] = await registry([session()]).listStatuses();
    expect(status?.reason).toBeNull();
  });

  it("never overwrites a reason the session already reported", async () => {
    // The book's own answer outranks our clock: UNAUTHORIZED tells the operator
    // something EXPIRED does not.
    const [status] = await registry([session({ renewAfterMs: NOW - 1, reason: "UNAUTHORIZED" })]).listStatuses();
    expect(status?.reason).toBe("UNAUTHORIZED");
  });
});

describe("why a catalog source refused", () => {
  const withHandle = (handle: unknown, sessions: readonly RedactedSessionStatus[]) =>
    new CatalogSourceRegistry({
      sessions: { listStatuses: async () => ({ sessions }),
        getActiveSecretHandle: async () => handle } as never,
      accounts: {} as never,
      supportedPairs: [{ provider: "BTI", category: "FOOTBALL", alias: "BTI" }] as never,
      clock: { nowMs: () => NOW }
    });

  // One code used to cover an id typo, a book that never signed in, and a
  // session whose secret is gone. They are three different problems with three
  // different answers, and telling them apart is the whole point.
  it("names an id that matches no configured pair", async () => {
    await expect(withHandle(null, []).resolveCatalogSource("catalog-source:SABA:LOL"))
      .rejects.toThrow("CATALOG_SOURCE_UNKNOWN");
  });

  it("names a configured pair with no ACTIVE session behind it", async () => {
    await expect(withHandle(null, [session({ state: "ACTION_REQUIRED" })])
      .resolveCatalogSource("catalog-source:BTI:FOOTBALL"))
      .rejects.toThrow("CATALOG_SOURCE_NO_ACTIVE_SESSION");
  });

  it("names a live session whose secret is not there", async () => {
    // Measured 2026-09-15: this is the door every preflight was hitting.
    await expect(withHandle(null, [session()]).withActiveHandle(
      "catalog-source:BTI:FOOTBALL", "BTI", async () => "unused", "FOOTBALL"))
      .rejects.toThrow("CATALOG_SOURCE_SECRET_UNAVAILABLE");
  });
});
