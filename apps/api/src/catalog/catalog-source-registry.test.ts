import type { Category, ProviderId, RedactedSessionStatus, SessionStatusList } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { CatalogSourceIdentity } from "../accounts/account-registry.js";
import type { ActiveSecretHandle } from "../sessions/types.js";
import { CatalogSourceRegistry } from "./catalog-source-registry.js";

function session(input: Partial<RedactedSessionStatus> & Pick<RedactedSessionStatus, "id" | "provider" | "category">): RedactedSessionStatus {
  return {
    source: "FABET_LOGIN",
    state: "ACTIVE",
    trustedHostname: "provider.test",
    acquiredAtMs: 100,
    lastValidatedAtMs: 100,
    renewAfterMs: 1_000,
    secretConfigured: true,
    reason: null,
    ...input
  };
}

function handle(id: string, provider: string, category: Category | null): ActiveSecretHandle {
  return {
    sessionId: id,
    provider,
    category,
    withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://provider.test/launch" })
  };
}

function registry(sessions: readonly RedactedSessionStatus[]) {
  const handles = new Map(sessions.map((item) => [item.id, handle(item.id, item.provider, item.category)]));
  const delegated: CatalogSourceIdentity = {
    provider: "BTI", category: "FOOTBALL", sessionId: "manual-session", key: "BTI|FOOTBALL|manual-session"
  };
  const resolveCatalogSource = vi.fn(async () => delegated);
  const accounts = {
    resolveCatalogSource,
    async withActiveHandle<T>(_id: string, _provider: ProviderId,
      consume: (value: ActiveSecretHandle) => Promise<T>, _category?: Category): Promise<T> {
      return consume(handle("manual-session", "BTI", "FOOTBALL"));
    }
  };
  return {
    accounts,
    value: new CatalogSourceRegistry({
      sessions: {
        listStatuses: async (): Promise<SessionStatusList> => ({ sessions }),
        getActiveSecretHandle: async (id: string) => handles.get(id) ?? null
      },
      accounts,
      supportedPairs: [
        { provider: "SABA", category: "FOOTBALL", alias: "C-Sports · SABA" },
        { provider: "SABA", category: "LOL", alias: "SABA Esports" }
      ]
    })
  };
}

describe("CatalogSourceRegistry", () => {
  it("can expose a JIT provider catalog only while its Fabet browser anchor is ACTIVE", async () => {
    const sessions = [session({ id: "fabet", provider: "FABET", category: null, acquiredAtMs: 500 })];
    const value = new CatalogSourceRegistry({
      sessions: {
        listStatuses: async (): Promise<SessionStatusList> => ({ sessions }),
        getActiveSecretHandle: async () => null
      },
      accounts: registry([]).accounts,
      supportedPairs: [{ provider: "IM", category: "FOOTBALL", alias: "I-Sports · IM",
        anchorProvider: "FABET", anchorCategory: null }]
    });

    await expect(value.resolveCatalogSource("catalog-source:IM:FOOTBALL")).resolves.toEqual({
      provider: "IM", category: "FOOTBALL", sessionId: "fabet", key: "catalog-source|IM|FOOTBALL"
    });
    await expect(value.listStatuses()).resolves.toEqual([
      expect.objectContaining({ id: "catalog-source:IM:FOOTBALL", provider: "IM", category: "FOOTBALL",
        sessionState: "ACTIVE" })
    ]);
  });

  it("uses the newest exact ACTIVE session and cannot be displaced by a newer unvalidated or legacy session", async () => {
    const { value } = registry([
      session({ id: "older-active", provider: "SABA", category: "FOOTBALL", acquiredAtMs: 100 }),
      session({ id: "newest-active", provider: "SABA", category: "FOOTBALL", acquiredAtMs: 200 }),
      session({ id: "unvalidated-newer", provider: "SABA", category: "FOOTBALL", acquiredAtMs: 300,
        state: "ACTION_REQUIRED", reason: "SCHEMA_CHANGED", lastValidatedAtMs: null }),
      session({ id: "legacy-newest", provider: "SABA", category: null, acquiredAtMs: 400 }),
      session({ id: "wrong-category", provider: "SABA", category: "LOL", acquiredAtMs: 500 })
    ]);

    await expect(value.resolveCatalogSource("catalog-source:SABA:FOOTBALL")).resolves.toEqual({
      provider: "SABA",
      category: "FOOTBALL",
      sessionId: "newest-active",
      key: "catalog-source|SABA|FOOTBALL"
    });
    await expect(value.withActiveHandle("catalog-source:SABA:FOOTBALL", "SABA",
      async (selected) => selected.sessionId, "FOOTBALL")).resolves.toBe("newest-active");
  });

  it("uses a deterministic id tie-break and reports unavailable exact pairs without borrowing another category", async () => {
    const { value } = registry([
      session({ id: "same-time-a", provider: "SABA", category: "FOOTBALL", acquiredAtMs: 200 }),
      session({ id: "same-time-b", provider: "SABA", category: "FOOTBALL", acquiredAtMs: 200 }),
      session({ id: "lol-invalid", provider: "SABA", category: "LOL", acquiredAtMs: 300,
        state: "ACTION_REQUIRED", reason: "EXPIRED" })
    ]);

    expect((await value.resolveCatalogSource("catalog-source:SABA:FOOTBALL")).sessionId).toBe("same-time-b");
    await expect(value.resolveCatalogSource("catalog-source:SABA:LOL"))
      .rejects.toThrow("CATALOG_SOURCE_UNAVAILABLE");
    expect(await value.listStatuses()).toEqual([
      expect.objectContaining({ id: "catalog-source:SABA:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 200 }),
      expect.objectContaining({ id: "catalog-source:SABA:LOL", sessionState: "ACTION_REQUIRED", reason: "EXPIRED" })
    ]);
  });

  it("delegates manual account ids but rejects unsupported logical source identities", async () => {
    const { value, accounts } = registry([]);

    await expect(value.resolveCatalogSource("manual-account")).resolves.toMatchObject({
      provider: "BTI", sessionId: "manual-session"
    });
    expect(accounts.resolveCatalogSource).toHaveBeenCalledWith("manual-account");
    await expect(value.resolveCatalogSource("catalog-source:BTI:LOL"))
      .rejects.toThrow("CATALOG_SOURCE_UNAVAILABLE");
    await expect(value.withActiveHandle("catalog-source:SABA:FOOTBALL", "SBOBET",
      async () => "wrong", "FOOTBALL")).rejects.toThrow("ACCOUNT_PROVIDER_MISMATCH");
  });

  it("binds each logical source to its explicit session strategy without fallback", async () => {
    const sessions = [
      session({ id: "fabet-anchor", provider: "FABET", category: null, source: "FABET_LOGIN", acquiredAtMs: 100 }),
      session({ id: "tk88-anchor", provider: "TK88", category: null, source: "TK88_CHROME", acquiredAtMs: 200 }),
      session({ id: "manual-saba", provider: "SABA", category: "FOOTBALL", source: "MANUAL_PROVIDER_SESSION", acquiredAtMs: 300 }),
      session({ id: "wrong-fabet-as-tk88", provider: "TK88", category: null, source: "FABET_LOGIN", acquiredAtMs: 400 }),
      session({ id: "wrong-tk88-as-fabet", provider: "FABET", category: null, source: "TK88_CHROME", acquiredAtMs: 500 }),
      session({ id: "wrong-fabet-as-direct", provider: "SABA", category: "FOOTBALL", source: "FABET_LOGIN", acquiredAtMs: 600 })
    ];
    const value = new CatalogSourceRegistry({
      sessions: {
        listStatuses: async (): Promise<SessionStatusList> => ({ sessions }),
        getActiveSecretHandle: async () => null
      },
      accounts: registry([]).accounts,
      supportedPairs: [
        { provider: "IM", category: "LOL", alias: "TK88 IM", strategy: "TK88_CHROME",
          anchorProvider: "TK88", anchorCategory: null },
        { provider: "BTI", category: "LOL", alias: "Fabet BTI", strategy: "FABET_LOGIN",
          anchorProvider: "FABET", anchorCategory: null },
        { provider: "SABA", category: "FOOTBALL", alias: "Direct SABA", strategy: "DIRECT_SESSION" }
      ]
    });

    await expect(value.resolveCatalogSource("catalog-source:IM:LOL")).resolves.toMatchObject({ sessionId: "tk88-anchor" });
    await expect(value.resolveCatalogSource("catalog-source:BTI:LOL")).resolves.toMatchObject({ sessionId: "fabet-anchor" });
    await expect(value.resolveCatalogSource("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({ sessionId: "manual-saba" });

    const noTk88 = new CatalogSourceRegistry({
      sessions: {
        listStatuses: async (): Promise<SessionStatusList> => ({ sessions: sessions.filter((item) => item.source !== "TK88_CHROME") }),
        getActiveSecretHandle: async () => null
      },
      accounts: registry([]).accounts,
      supportedPairs: [{ provider: "IM", category: "LOL", alias: "TK88 IM", strategy: "TK88_CHROME",
        anchorProvider: "TK88", anchorCategory: null }]
    });
    await expect(noTk88.resolveCatalogSource("catalog-source:IM:LOL")).rejects.toThrow("CATALOG_SOURCE_UNAVAILABLE");
  });

  it("coalesces repeated redacted session scans across source-key and status reads", async () => {
    let listCalls = 0;
    const sessions = [session({ id: "saba", provider: "SABA", category: "FOOTBALL" })];
    const value = new CatalogSourceRegistry({
      sessions: {
        listStatuses: async (): Promise<SessionStatusList> => { listCalls += 1; return { sessions }; },
        getActiveSecretHandle: async () => null
      },
      accounts: registry([]).accounts,
      supportedPairs: [{ provider: "SABA", category: "FOOTBALL", alias: "SABA", strategy: "FABET_LOGIN" }]
    });

    await Promise.all([
      value.resolveCatalogSource("catalog-source:SABA:FOOTBALL"),
      value.resolveCatalogSource("catalog-source:SABA:FOOTBALL"),
      value.listStatuses()
    ]);
    await value.resolveCatalogSource("catalog-source:SABA:FOOTBALL");
    expect(listCalls).toBe(1);
  });
});
