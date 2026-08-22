import { describe, expect, it, vi } from "vitest";
import { MultiProviderCatalogReader } from "./multi-provider-catalog.js";

describe("MultiProviderCatalogReader", () => {
  it("restarts every registered reader without stopping the process", async () => {
    const closeSaba = vi.fn(async () => undefined);
    const closeCmd = vi.fn(async () => undefined);
    const reader = new MultiProviderCatalogReader({ sources: {
      resolveCatalogSource: async () => { throw new Error("NOT_USED"); }
    }, readers: [
      { provider: "SABA", category: "FOOTBALL", reader: { provider: "SABA", read: vi.fn() }, cancel: closeSaba },
      { provider: "CMD", category: "FOOTBALL", reader: { provider: "CMD", read: vi.fn() }, cancel: closeCmd }
    ] });

    await reader.restartAll();

    expect(closeSaba).toHaveBeenCalledOnce();
    expect(closeCmd).toHaveBeenCalledOnce();
  });
  it("exposes browser-aware request and stale-while-revalidate deadlines", () => {
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => { throw new Error("NOT_USED"); } },
      readers: []
    });

    expect(reader.requestTimeoutMs).toBe(15_000);
    expect(reader.responseCacheMaxAgeMs).toBe(1_000);
    expect(reader.snapshotFreshnessMaxAgeMs).toBe(60_000);
    expect(reader.failureRetryBaseMs).toBe(60_000);
    expect(reader.failureRetryMaxMs).toBe(600_000);
  });

  it("derives a configured logical source key without scanning session storage", async () => {
    const resolveCatalogSource = vi.fn(async () => { throw new Error("SLOW_SESSION_SCAN"); });
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource },
      readers: [{ provider: "SABA", category: "FOOTBALL",
        reader: { provider: "SABA", read: async () => { throw new Error("NOT_USED"); } } }]
    });

    await expect(reader.sourceKey("catalog-source:SABA:FOOTBALL"))
      .resolves.toBe("catalog-source|SABA|FOOTBALL");
    expect(resolveCatalogSource).not.toHaveBeenCalled();
  });

  it("routes an account to the reader matching its verified provider", async () => {
    const cmdRead = vi.fn(async () => { throw new Error("WRONG_READER"); });
    const sabaCatalog = { provider: "SABA", category: "FOOTBALL", accountId: "saba-1" };
    const sabaRead = vi.fn(async () => sabaCatalog);
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "FOOTBALL",
        sessionId: "session-saba", key: "SABA|FOOTBALL|session-saba" }) },
      readers: [
        { provider: "CMD", category: "FOOTBALL", reader: { provider: "CMD", read: cmdRead } },
        { provider: "SABA", category: "FOOTBALL", reader: { provider: "SABA", read: sabaRead } }
      ]
    } as never);

    await expect(reader.read("saba-1")).resolves.toBe(sabaCatalog);
    expect(cmdRead).not.toHaveBeenCalled();
    expect(sabaRead).toHaveBeenCalledWith("saba-1");
  });

  it("fails closed when no verified reader owns the account", async () => {
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "LOL",
        sessionId: "session-saba", key: "SABA|LOL|session-saba" }) },
      readers: [{ provider: "SABA", category: "FOOTBALL",
        reader: { provider: "SABA", read: async () => { throw new Error("WRONG_READER"); } } }]
    } as never);
    await expect(reader.read("unknown")).rejects.toThrow("CATALOG_UNAVAILABLE");
  });

  it("cancels only the browser reader that owns the timed-out source", async () => {
    let sabaOpen = true;
    let sbobetOpen = true;
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "FOOTBALL",
        sessionId: "session-saba", key: "SABA|FOOTBALL|session-saba" }) },
      readers: [
        { provider: "SABA", category: "FOOTBALL", reader: { provider: "SABA",
          read: async () => { throw new Error("NOT_USED"); } }, cancel: async () => { sabaOpen = false; } },
        { provider: "SBOBET", category: "FOOTBALL", reader: { provider: "SBOBET",
          read: async () => { throw new Error("NOT_USED"); } }, cancel: async () => { sbobetOpen = false; } }
      ]
    } as never);

    await reader.cancel("saba-1");
    expect(sabaOpen).toBe(false);
    expect(sbobetOpen).toBe(true);
  });

  it("serializes heavyweight browser startup to cap transient RAM", async () => {
    let active = 0;
    let highest = 0;
    const releases: Array<() => void> = [];
    const providers = ["SABA", "IM", "SBOBET", "APSPORT"] as const;
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async (id: string) => {
        const provider = providers.find((candidate) => id.includes(candidate))!;
        return { provider, category: "FOOTBALL", sessionId: id, key: id };
      } },
      readers: providers.map((provider) => ({ provider, category: "FOOTBALL" as const, reader: { provider,
        read: async (accountId: string) => {
          active += 1; highest = Math.max(highest, active);
          await new Promise<void>((resolve) => releases.push(resolve));
          active -= 1;
          return { provider, category: "FOOTBALL", accountId } as never;
        } } }))
    });

    const reads = providers.map((provider) => reader.read(`catalog-source:${provider}:FOOTBALL`));
    for (let index = 0; index < providers.length; index += 1) {
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      releases.shift()!();
    }
    await expect(Promise.all(reads)).resolves.toHaveLength(4);
    expect(highest).toBe(1);
  });

  it("reports an authentication-specific reader failure for background recovery", async () => {
    const failures: unknown[] = [];
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "FOOTBALL",
        sessionId: "fabet", key: "SABA|FOOTBALL" }) },
      readers: [{ provider: "SABA", category: "FOOTBALL", reader: { provider: "SABA",
        read: async () => { throw new Error("FABET_PROVIDER_NOT_AUTHENTICATED"); } } }],
      onAuthenticationFailure: async (failure) => { failures.push(failure); },
    });

    await expect(reader.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("CATALOG_UNAVAILABLE");
    await vi.waitFor(() => expect(failures).toEqual([{
      credentialSourceId: "fabet",
      providers: ["SABA"],
      signal: { kind: "LOGIN_PAGE" },
    }]));
  });

  it.each(["EMPTY_CATALOG", "SCHEMA_ERROR", "TIMEOUT"])(
    "does not report non-authentication reader failure %s",
    async (reason) => {
      const callback = vi.fn();
      const reader = new MultiProviderCatalogReader({
        sources: { resolveCatalogSource: async () => ({ provider: "BTI", category: "FOOTBALL",
          sessionId: "fabet", key: "BTI|FOOTBALL" }) },
        readers: [{ provider: "BTI", category: "FOOTBALL", reader: { provider: "BTI",
          read: async () => { throw new Error(reason); } } }],
        onAuthenticationFailure: callback,
      });

      await expect(reader.read("catalog-source:BTI:FOOTBALL")).rejects.toThrow("CATALOG_UNAVAILABLE");
      expect(callback).not.toHaveBeenCalled();
    },
  );
});
