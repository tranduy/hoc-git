import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderProfileReader } from "../providers/provider-capabilities.js";
import { SecretVault } from "../sessions/secret-vault.js";
import type { ActiveSecretHandle, SecretProtector } from "../sessions/types.js";
import { AccountRegistry } from "./account-registry.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x31),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x31)
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup(options: {
  profileReadTimeoutMs?: number;
  readProfile?: ProviderProfileReader["readProfile"];
  getActiveSecretHandle?: (id: string) => Promise<ActiveSecretHandle | null>;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-account-"));
  directories.push(directory);
  const vault = new SecretVault({ directory, protector });
  const clock = { value: 1_000 };
  const statuses = ["session-a", "session-b"].map((id) => ({
    id, provider: "CMD", source: "MANUAL_PROVIDER_SESSION" as const, state: "ACTIVE" as const,
    category: "FOOTBALL" as const,
    trustedHostname: null, acquiredAtMs: 1, lastValidatedAtMs: 1, renewAfterMs: 99_999,
    secretConfigured: true, reason: null
  }));
  const handles = new Map<string, ActiveSecretHandle>(statuses.map((status) => [status.id, {
    sessionId: status.id,
    provider: "CMD",
    category: status.category,
    withSecret: async (consume) => consume({ kind: "TOKEN", value: `${status.id}-secret-canary` })
  }]));
  let nextId = 0;
  const registry = new AccountRegistry({
    vault,
    sessions: {
      listStatuses: async () => ({ sessions: statuses }),
      getActiveSecretHandle: options.getActiveSecretHandle ?? (async (id) => handles.get(id) ?? null)
    },
    readers: [{
      provider: "CMD",
      capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"],
      readProfile: options.readProfile ?? (async (handle) => handle.withSecret(async (secret) => ({
        redactedLabel: handle.sessionId === "session-a" ? "A***1" : "B***2",
        currency: "VND",
        balance: secret.value.startsWith("session-") ? "100000" : "0",
        asOfMs: clock.value
      })))
    }],
    clock: { nowMs: () => clock.value },
    idFactory: () => `account-${++nextId}`,
    ...(options.profileReadTimeoutMs === undefined ? {} : { profileReadTimeoutMs: options.profileReadTimeoutMs })
  });
  return { vault, clock, registry };
}

describe("AccountRegistry", () => {
  it("supports two redacted accounts on the same provider and survives reconstruction", async () => {
    const context = await setup();
    const first = await context.registry.register({ sessionId: "session-a", alias: "CMD one", provider: "CMD" });
    const second = await context.registry.register({ sessionId: "session-b", alias: "CMD two", provider: "CMD" });
    await context.registry.refresh(first.id);
    await context.registry.refresh(second.id);

    const publicJson = JSON.stringify(await context.registry.listStatuses());
    expect(publicJson).not.toMatch(/secret-canary|TOKEN/u);
    expect(JSON.parse(publicJson)).toEqual([
      expect.objectContaining({ alias: "CMD one", provider: "CMD", balance: "100000", profileState: "FRESH" }),
      expect.objectContaining({ alias: "CMD two", provider: "CMD", balance: "100000", profileState: "FRESH" })
    ]);
  });

  it("marks profile evidence stale after thirty seconds", async () => {
    const context = await setup();
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });
    await context.registry.refresh(account.id);
    context.clock.value = 31_001;
    expect((await context.registry.listStatuses())[0]).toMatchObject({ profileState: "STALE" });
  });

  it("clears the public error reason after a successful profile refresh", async () => {
    const context = await setup();
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });

    expect(account).toMatchObject({ profileState: "UNAVAILABLE", reason: "SCHEMA_CHANGED" });
    expect(await context.registry.refresh(account.id)).toMatchObject({
      sessionState: "ACTIVE",
      profileState: "FRESH",
      reason: null
    });
  });

  it("fails closed within the configured deadline when a profile reader hangs", async () => {
    const context = await setup({
      profileReadTimeoutMs: 10,
      readProfile: async () => new Promise<never>(() => undefined)
    });
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });

    await expect(context.registry.refresh(account.id)).resolves.toMatchObject({
      profileState: "UNAVAILABLE",
      reason: "UNREACHABLE"
    });
  });

  it("applies the same deadline while acquiring an active session handle", async () => {
    const context = await setup({
      profileReadTimeoutMs: 10,
      getActiveSecretHandle: async () => new Promise<never>(() => undefined)
    });
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });

    await expect(context.registry.refresh(account.id)).resolves.toMatchObject({
      profileState: "UNAVAILABLE",
      reason: "UNREACHABLE"
    });
  });

  it("coalesces concurrent refreshes for the same account", async () => {
    let reads = 0;
    const context = await setup({
      readProfile: async () => {
        reads += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          redactedLabel: "A***1",
          currency: "VND",
          balance: "100000",
          asOfMs: 1_000
        };
      }
    });
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });

    const [first, second] = await Promise.all([
      context.registry.refresh(account.id),
      context.registry.refresh(account.id)
    ]);

    expect(reads).toBe(1);
    expect(first).toEqual(second);
  });

  it("rejects an unknown or mismatched provider identity", async () => {
    const context = await setup();
    await expect(context.registry.register({ sessionId: "session-a", alias: "Unknown", provider: "UNKNOWN" as "CMD" }))
      .rejects.toThrow("PROVIDER_IDENTITY_REQUIRED");
    await expect(context.registry.register({ sessionId: "session-a", alias: "Wrong", provider: "SABA" }))
      .rejects.toThrow("PROVIDER_IDENTITY_MISMATCH");
  });

  it("keeps profile unavailable when the session has no active handle", async () => {
    const context = await setup();
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });
    const unavailable = new AccountRegistry({
      vault: context.vault,
      sessions: {
        listStatuses: async () => ({ sessions: [{
          id: "session-a", provider: "CMD", source: "MANUAL_PROVIDER_SESSION", state: "INVALID",
          category: null,
          trustedHostname: null, acquiredAtMs: 1, lastValidatedAtMs: 1, renewAfterMs: 2,
          secretConfigured: true, reason: "EXPIRED"
        }] }),
        getActiveSecretHandle: async () => null
      },
      readers: [], clock: { nowMs: () => 1_000 }, idFactory: () => "unused"
    });
    expect(await unavailable.refresh(account.id)).toMatchObject({ profileState: "UNAVAILABLE", reason: "EXPIRED" });
  });

  it("opens the active secret only for the account's verified provider", async () => {
    const context = await setup();
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });

    await expect(context.registry.withActiveHandle(account.id, "SABA", async () => "wrong"))
      .rejects.toThrow("ACCOUNT_PROVIDER_MISMATCH");
    await expect(context.registry.withActiveHandle(account.id, "CMD", async (handle) => handle.sessionId))
      .resolves.toBe("session-a");
  });

  it("rejects the wrong catalog category before opening the provider secret", async () => {
    const context = await setup();
    const account = await context.registry.register({ sessionId: "session-a", alias: "Main", provider: "CMD" });
    let consumed = false;

    await expect(context.registry.withActiveHandle(account.id, "CMD", async () => {
      consumed = true; return "wrong";
    }, "LOL")).rejects.toThrow("ACCOUNT_CATEGORY_MISMATCH");
    expect(consumed).toBe(false);
    await expect(context.registry.withActiveHandle(account.id, "CMD", async () => "football", "FOOTBALL"))
      .resolves.toBe("football");
  });

  it("resolves duplicate account aliases to one redacted catalog source identity", async () => {
    const context = await setup();
    const first = await context.registry.register({ sessionId: "session-a", alias: "Primary", provider: "CMD" });
    const second = await context.registry.register({ sessionId: "session-a", alias: "Secondary", provider: "CMD" });

    const firstSource = await context.registry.resolveCatalogSource(first.id);
    const secondSource = await context.registry.resolveCatalogSource(second.id);

    expect(firstSource).toEqual({
      provider: "CMD", category: "FOOTBALL", sessionId: "session-a",
      key: "CMD|FOOTBALL|session-a"
    });
    expect(secondSource).toEqual(firstSource);
    expect(JSON.stringify(firstSource)).not.toMatch(/secret-canary|TOKEN/u);
  });
});
