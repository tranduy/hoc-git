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
