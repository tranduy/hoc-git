import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { SecretVault } from "./secret-vault.js";
import { SessionManager } from "./session-manager.js";
import { SessionValidatorRegistry } from "./validators.js";
import type { ProviderSecret, SecretProtector, SessionValidator } from "./types.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x44),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x44)
};

async function createVault(): Promise<SecretVault> {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-session-"));
  directories.push(directory);
  return new SecretVault({ directory, protector });
}

class FakeValidator implements SessionValidator {
  readonly provider = "SABA";
  validateResult: Awaited<ReturnType<SessionValidator["validate"]>> = { ok: true };
  renewCalls = 0;
  allowRenew = true;

  async validate(_secret: ProviderSecret): Promise<Awaited<ReturnType<SessionValidator["validate"]>>> {
    return this.validateResult;
  }

  async renew(secret: ProviderSecret): Promise<ProviderSecret> {
    if (!this.allowRenew) throw new Error("renew unavailable");
    this.renewCalls += 1;
    return { ...secret, value: `${secret.value}-renewed` };
  }
}

function createManager(vault: SecretVault, validator: FakeValidator, clock: { wallClockNowMs: number }) {
  return new SessionManager({
    vault,
    validators: new SessionValidatorRegistry([validator]),
    clock: { nowMs: () => clock.wallClockNowMs },
    idFactory: () => "manual-saba-1"
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SessionManager", () => {
  it("reclassifies a stored launch only after the target provider validates it", async () => {
    const vault = await createVault();
    const cmd: SessionValidator = { provider: "CMD", validate: async () => ({ ok: false, reason: "SCHEMA_CHANGED" }) };
    const sbobet: SessionValidator = { provider: "SBOBET", validate: async (secret) =>
      secret.kind === "LAUNCH_URL" ? { ok: true } : { ok: false, reason: "SCHEMA_CHANGED" } };
    const manager = new SessionManager({ vault, validators: new SessionValidatorRegistry([cmd, sbobet]),
      clock: { nowMs: () => 10 }, idFactory: () => "launch-1" });
    await manager.configureManual({ provider: "CMD", kind: "LAUNCH_URL", secret: "https://zenandfe.test/start" });

    await expect(manager.reclassify("launch-1", "SBOBET")).resolves.toMatchObject({ provider: "SBOBET", state: "ACTIVE" });
    const handle = await manager.getActiveSecretHandle("launch-1");
    expect(handle?.provider).toBe("SBOBET");
  });

  it("forces exactly one renewal at the 24-hour boundary", async () => {
    const vault = await createVault();
    const validator = new FakeValidator();
    const clock = { wallClockNowMs: 0 };
    const manager = createManager(vault, validator, clock);
    await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "manual-canary" });

    clock.wallClockNowMs = 86_400_000;
    await Promise.all([manager.tick(), manager.tick(), manager.tick()]);

    expect(validator.renewCalls).toBe(1);
    await expect(manager.listStatuses()).resolves.toEqual({ sessions: [expect.objectContaining({
      state: "ACTIVE",
      acquiredAtMs: 86_400_000,
      renewAfterMs: 172_800_000
    })] });
  });

  it("marks a non-refreshable manual session action-required at expiry", async () => {
    const vault = await createVault();
    const validator: SessionValidator = {
      provider: "BTI",
      validate: async () => ({ ok: true })
    };
    const clock = { wallClockNowMs: 5 };
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([validator]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "manual-bti-1"
    });
    const configured = await manager.configureManual({ provider: "BTI", kind: "LAUNCH_URL", secret: "https://bti.test/?session=canary" });

    clock.wallClockNowMs = 86_400_005;
    await manager.tick();

    expect(await manager.getActiveSecretHandle(configured.id)).toBeNull();
    expect(await manager.listStatuses()).toEqual({ sessions: [expect.objectContaining({
      state: "ACTION_REQUIRED", reason: "EXPIRED"
    })] });
  });

  it("withdraws the active secret handle while validation is in flight", async () => {
    const vault = await createVault();
    let releaseValidation: (() => void) | undefined;
    let signalValidationEntered: (() => void) | undefined;
    const validationEntered = new Promise<void>((resolve) => { signalValidationEntered = resolve; });
    let validationCalls = 0;
    const validator: SessionValidator = {
      provider: "SABA",
      validate: async () => {
        validationCalls += 1;
        if (validationCalls === 1) return { ok: true };
        signalValidationEntered?.();
        await new Promise<void>((resolve) => { releaseValidation = resolve; });
        return { ok: true };
      }
    };
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([validator]),
      clock: { nowMs: () => 100 },
      idFactory: () => "manual-saba-1"
    });
    const configured = await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "manual-canary" });

    const validating = manager.validate(configured.id);
    await validationEntered;
    expect(await manager.getActiveSecretHandle(configured.id)).toBeNull();
    releaseValidation?.();
    await validating;
    expect(await manager.getActiveSecretHandle(configured.id)).not.toBeNull();
  });

  it("never exposes secret material in statuses or errors", async () => {
    const vault = await createVault();
    const validator = new FakeValidator();
    validator.validateResult = { ok: false, reason: "UNAUTHORIZED" };
    validator.allowRenew = false;
    const manager = createManager(vault, validator, { wallClockNowMs: 1 });

    await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "status-secret-canary" });

    expect(JSON.stringify(await manager.listStatuses())).not.toContain("status-secret-canary");
    expect(await manager.listStatuses()).toEqual({ sessions: [expect.objectContaining({
      state: "ACTION_REQUIRED", reason: "UNAUTHORIZED", secretConfigured: true
    })] });
  });

  it("classifies validator exceptions without leaking their message", async () => {
    const vault = await createVault();
    const validator: SessionValidator = {
      provider: "SABA",
      validate: async () => { throw new Error("validator-secret-canary"); }
    };
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([validator]),
      clock: { nowMs: () => 10 },
      idFactory: () => "manual-saba-1"
    });

    const status = await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "input-secret-canary" });

    expect(status).toMatchObject({ state: "INVALID", reason: "UNREACHABLE" });
    expect(JSON.stringify(status)).not.toMatch(/validator-secret-canary|input-secret-canary/u);
  });

  it("persists an active direct session across manager reconstruction", async () => {
    const vault = await createVault();
    const validator = new FakeValidator();
    const clock = { wallClockNowMs: 20 };
    const first = createManager(vault, validator, clock);
    const configured = await first.configureManual({ provider: "SABA", kind: "TOKEN", secret: "restart-canary" });

    const second = createManager(vault, validator, clock);
    expect(await second.listStatuses()).toEqual({ sessions: [expect.objectContaining({ state: "ACTIVE" })] });
    const handle = await second.getActiveSecretHandle(configured.id);
    expect(await handle?.withSecret(async (secret) => secret.value)).toBe("restart-canary");
  });

  it("Fabet reset does not delete a direct provider session", async () => {
    const vault = await createVault();
    const validator = new FakeValidator();
    const manager = createManager(vault, validator, { wallClockNowMs: 30 });
    const direct = await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "direct-canary" });
    await manager.configureFabet({
      entryUrl: "https://fabet.party/",
      username: "development-user",
      password: "development-pass",
      trustedHostname: "fabet.party"
    });

    await manager.resetFabet();

    expect(await manager.getActiveSecretHandle(direct.id)).not.toBeNull();
    expect((await manager.listStatuses()).sessions).toHaveLength(1);
    expect((await manager.listStatuses()).sessions[0]?.source).toBe("MANUAL_PROVIDER_SESSION");
  });

  it("logs into Fabet and repeats the read-only bootstrap after 24 hours", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let loginCalls = 0;
    let captureCalls = 0;
    let resetCalls = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => { loginCalls += 1; },
        captureLobbyLaunches: async () => {
          captureCalls += 1;
          await vault.save("launch-1", {
            kind: "LAUNCH_URL",
            value: "https://sports.vendor.test/launch?token=provider-secret-canary",
            capturedAtMs: clock.wallClockNowMs
          });
          return [{
            category: "FOOTBALL" as const,
            providerHint: "SABA",
            hostname: "sports.vendor.test",
            capturedAtMs: clock.wallClockNowMs,
            vaultRecordId: "launch-1"
          }];
        },
        resetProfile: async () => { resetCalls += 1; }
      }
    });

    const configured = await manager.configureFabet({
      entryUrl: "https://fabet.party/",
      username: "development-user",
      password: "development-pass",
      trustedHostname: "fabet.party"
    });
    expect(configured).toMatchObject({ state: "ACTIVE", reason: null });
    expect(loginCalls).toBe(1);
    expect(captureCalls).toBe(1);
    expect(await vault.load("launch-1")).toBeNull();
    expect(await manager.listStatuses()).toEqual({ sessions: [
      expect.objectContaining({ provider: "FABET", state: "ACTIVE" }),
      expect.objectContaining({
        provider: "SABA",
        source: "FABET_LOGIN",
        state: "ACTION_REQUIRED",
        trustedHostname: "sports.vendor.test",
        reason: "SCHEMA_CHANGED"
      })
    ] });

    clock.wallClockNowMs = 86_400_040;
    await manager.tick();
    expect(loginCalls).toBe(2);
    expect(captureCalls).toBe(2);
    expect((await manager.listStatuses()).sessions.find((session) => session.provider === "FABET")).toMatchObject({
      state: "ACTIVE", acquiredAtMs: 86_400_040, renewAfterMs: 172_800_040
    });

    await manager.resetFabet();
    expect(resetCalls).toBe(1);
  });

  it("keeps an exact verified lounge active when Fabet refreshes its one-time launch", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let launchVersion = 0;
    const validator = new FakeValidator();
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([validator]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          launchVersion += 1;
          await vault.save("current-launch", { kind: "LAUNCH_URL",
            value: `https://sports.vendor.test/launch?v=${launchVersion}`, capturedAtMs: clock.wallClockNowMs });
          return [{ category: "FOOTBALL", providerHint: "SABA", hostname: "sports.vendor.test",
            capturedAtMs: clock.wallClockNowMs, vaultRecordId: "current-launch" }];
        },
        resetProfile: async () => undefined
      }
    });
    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    const launch = (await manager.listStatuses()).sessions.find((session) => session.provider === "SABA")!;
    await manager.validate(launch.id);

    clock.wallClockNowMs = 86_400_040;
    await manager.renew("fabet");

    expect((await manager.listStatuses()).sessions.find((session) => session.id === launch.id)).toMatchObject({
      state: "ACTIVE", reason: null, acquiredAtMs: 86_400_040, renewAfterMs: 172_800_040
    });
    const handle = await manager.getActiveSecretHandle(launch.id);
    expect(await handle?.withSecret(async (secret) => secret.value)).toBe("https://sports.vendor.test/launch?v=2");
  });

  it("keeps Football and LoL launches separate when provider and hostname are identical", async () => {
    const vault = await createVault();
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 50 },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          await vault.save("football-launch", { kind: "LAUNCH_URL", value: "https://same.vendor.test/football", capturedAtMs: 50 });
          await vault.save("lol-launch", { kind: "LAUNCH_URL", value: "https://same.vendor.test/lol", capturedAtMs: 50 });
          return [
            { category: "FOOTBALL", providerHint: "SABA", hostname: "same.vendor.test", capturedAtMs: 50, vaultRecordId: "football-launch" },
            { category: "LOL", providerHint: "SABA", hostname: "same.vendor.test", capturedAtMs: 50, vaultRecordId: "lol-launch" }
          ];
        },
        resetProfile: async () => undefined
      }
    });

    await manager.configureFabet({
      entryUrl: "https://fabet.party/", username: "development-user", password: "development-pass",
      trustedHostname: "fabet.party"
    });

    const launches = (await manager.listStatuses()).sessions.filter((session) => session.provider === "SABA");
    expect(launches).toHaveLength(2);
    expect(launches.map((session) => session.category).sort()).toEqual(["FOOTBALL", "LOL"]);
    expect(new Set(launches.map((session) => session.id)).size).toBe(2);
  });

  it("rehydrates the saved Fabet login before acquiring a provider popup after restart", async () => {
    const vault = await createVault();
    const first = new SessionManager({ vault, validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 60 }, idFactory: () => "unused", fabetDriver: {
        login: async () => undefined, captureLobbyLaunches: async () => [], resetProfile: async () => undefined
      } });
    await first.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    let ready = false; let loginCalls = 0;
    const second = new SessionManager({ vault, validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 60 }, idFactory: () => "unused", fabetDriver: {
        login: async () => { ready = true; loginCalls += 1; }, captureLobbyLaunches: async () => [],
        resetProfile: async () => undefined,
        withProviderPage: async (_provider, _category, consume) => {
          if (!ready) throw Object.assign(new Error("NOT_AUTHENTICATED"), { code: "NOT_AUTHENTICATED" });
          return consume({} as Page);
        }
      } });

    await expect(second.withFabetProviderPage("SABA", "FOOTBALL", async () => "live-popup"))
      .resolves.toBe("live-popup");
    expect(loginCalls).toBe(1);
  });
});
