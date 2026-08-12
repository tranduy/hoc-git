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
});
