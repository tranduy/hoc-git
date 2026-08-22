import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { SecretVault } from "./secret-vault.js";
import { SessionManager } from "./session-manager.js";
import { SessionValidatorRegistry } from "./validators.js";
import type { ProviderSecret, SecretProtector, SecretRecord, SessionValidator } from "./types.js";

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
  it("preserves the active Fabet session when a background launch refresh fails", async () => {
    const vault = await createVault();
    let failLogin = false;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 100 },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => { if (failLogin) throw new Error("network unavailable"); },
        captureLobbyLaunches: async () => [],
        resetProfile: async () => undefined,
      },
    });
    await manager.configureFabet({ entryUrl: "https://fabet.monster/", trustedHostname: "fabet.monster",
      username: "development-user", password: "development-pass" });
    failLogin = true;

    await expect(manager.refreshFabetLaunches()).rejects.toThrow("network unavailable");

    expect((await manager.listStatuses()).sessions.find((session) => session.id === "fabet"))
      .toMatchObject({ state: "ACTIVE", reason: null });
  });

  it("shares one canonical-root authentication across simultaneous provider auth failures", async () => {
    const vault = await createVault();
    const roots: string[] = [];
    const driver = {
      login: async (input: { entryUrl: string }) => { roots.push(input.entryUrl); },
      captureLobbyLaunches: async () => [],
      resetProfile: async () => undefined,
    };
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 100 },
      idFactory: () => "unused",
      fabetDriver: driver,
    });
    await manager.configureFabet({
      entryUrl: "https://old-mirror.example/",
      trustedHostname: "old-mirror.example",
      username: "development-user",
      password: "development-pass",
    });
    roots.length = 0;

    const statuses = await Promise.all([
      manager.reportProviderFailure({
        credentialSourceId: "fabet",
        providers: ["SABA"],
        signal: { kind: "AUTH_EXPIRED", status: 401 },
      }),
      manager.reportProviderFailure({
        credentialSourceId: "fabet",
        providers: ["IM", "BTI"],
        signal: { kind: "LOGIN_PAGE" },
      }),
    ]);

    expect(roots).toEqual(["https://fabet.monster/"]);
    expect(statuses).toEqual([
      expect.objectContaining({ state: "ACTION_REQUIRED", reason: "PROVIDER_VALIDATION_FAILED" }),
      expect.objectContaining({ state: "ACTION_REQUIRED", reason: "PROVIDER_VALIDATION_FAILED" }),
    ]);
  });

  it.each(["EMPTY_CATALOG", "SCHEMA_ERROR", "TIMEOUT"] as const)(
    "does not login for non-authentication signal %s",
    async (kind) => {
      const vault = await createVault();
      let logins = 0;
      const manager = new SessionManager({
        vault,
        validators: new SessionValidatorRegistry([]),
        clock: { nowMs: () => 100 },
        idFactory: () => "unused",
        fabetDriver: {
          login: async () => { logins += 1; },
          captureLobbyLaunches: async () => [],
          resetProfile: async () => undefined,
        },
      });
      await manager.configureFabet({ entryUrl: "https://fabet.monster/", trustedHostname: "fabet.monster",
        username: "development-user", password: "development-pass" });
      logins = 0;

      await manager.reportProviderFailure({
        credentialSourceId: "fabet",
        providers: ["SABA"],
        signal: { kind },
      });

      expect(logins).toBe(0);
    },
  );

  it("rejects CMD from the Fabet credential recovery workflow", async () => {
    const vault = await createVault();
    const manager = new SessionManager({ vault, validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 100 }, idFactory: () => "unused" });

    await expect(manager.reportProviderFailure({
      credentialSourceId: "fabet",
      providers: ["CMD" as never],
      signal: { kind: "TOKEN_EXPIRED", expiredAtMs: 99 },
    })).rejects.toThrow("CMD");
  });

  it("fails recovery when a freshly captured provider launcher does not validate", async () => {
    const vault = await createVault();
    let captureSequence = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA",
        validate: async () => ({ ok: false, reason: "SCHEMA_CHANGED" }),
      }]),
      clock: { nowMs: () => 100 },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          captureSequence += 1;
          const vaultRecordId = `invalid-saba-launch-${captureSequence}`;
          await vault.save(vaultRecordId, {
            kind: "LAUNCH_URL",
            value: `https://sports.vendor.test/launch?generation=${captureSequence}`,
            capturedAtMs: 100,
          });
          return [{
            category: "FOOTBALL" as const,
            providerHint: "SABA",
            hostname: "sports.vendor.test",
            capturedAtMs: 100,
            vaultRecordId,
          }];
        },
        resetProfile: async () => undefined,
      },
    });
    await manager.configureFabet({
      entryUrl: "https://fabet.monster/",
      trustedHostname: "fabet.monster",
      username: "development-user",
      password: "development-pass",
    });

    await expect(manager.reportProviderFailure({
      credentialSourceId: "fabet",
      providers: ["SABA"],
      signal: { kind: "AUTH_EXPIRED", status: 401 },
    })).resolves.toMatchObject({
      state: "ACTION_REQUIRED",
      reason: "PROVIDER_VALIDATION_FAILED",
    });
  });
  it("persists the explicit Football category for a direct CMD launch", async () => {
    const vault = await createVault();
    const manager = new SessionManager({ vault, validators: new SessionValidatorRegistry([{
      provider: "CMD", validate: async () => ({ ok: true })
    }]), clock: { nowMs: () => 50 }, idFactory: () => "cmd-direct" });

    await expect(manager.configureManual({ provider: "CMD", category: "FOOTBALL", kind: "LAUNCH_URL",
      secret: "https://cmd.example/launch" })).resolves.toMatchObject({
      provider: "CMD", category: "FOOTBALL", state: "ACTIVE"
    });
  });

  it("hydrates session records once instead of decrypting the vault on every status poll", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-chenh-session-cache-"));
    directories.push(directory);
    let batchDecryptions = 0;
    const countingProtector: SecretProtector = {
      protect: protector.protect,
      unprotect: protector.unprotect,
      unprotectMany: async (values) => {
        batchDecryptions += 1;
        return Promise.all(values.map(protector.unprotect));
      }
    };
    const vault = new SecretVault({ directory, protector: countingProtector });
    const validator = new FakeValidator();
    await createManager(vault, validator, { wallClockNowMs: 1 })
      .configureManual({ provider: "SABA", kind: "TOKEN", secret: "cache-canary" });
    const restarted = createManager(vault, validator, { wallClockNowMs: 2 });

    expect((await restarted.listStatuses()).sessions).toHaveLength(1);
    expect((await restarted.listStatuses()).sessions).toHaveLength(1);
    expect(await restarted.getActiveSecretHandle("manual-saba-1")).not.toBeNull();
    expect(batchDecryptions).toBe(1);
  });

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

  it("stores and resets TK88 Chrome independently from Fabet and manual sessions", async () => {
    const vault = await createVault();
    const validator = new FakeValidator();
    const manager = createManager(vault, validator, { wallClockNowMs: 30 });
    const direct = await manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "direct-canary" });
    await manager.configureTk88({ trustedHostname: "tk88.example" });

    expect((await manager.listStatuses()).sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: direct.id, source: "MANUAL_PROVIDER_SESSION" }),
      expect.objectContaining({ id: "tk88", provider: "TK88", source: "TK88_CHROME", secretConfigured: true })
    ]));
    await manager.resetFabet();
    expect((await manager.listStatuses()).sessions.some((session) => session.source === "TK88_CHROME")).toBe(true);
    await manager.resetTk88();
    expect((await manager.listStatuses()).sessions.some((session) => session.source === "TK88_CHROME")).toBe(false);
    expect(await manager.getActiveSecretHandle(direct.id)).not.toBeNull();
  });

  it("opens the managed TK88 portal during registration and keeps browser failures fail-closed", async () => {
    const vault = await createVault();
    const opened: string[] = [];
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 31 },
      idFactory: () => "unused",
      initializeTk88State: async (hostname) => { opened.push(hostname); }
    });

    await expect(manager.configureTk88({ trustedHostname: "TK88.Example" })).resolves.toMatchObject({
      provider: "TK88", trustedHostname: "tk88.example", state: "ACTION_REQUIRED"
    });
    expect(opened).toEqual(["tk88.example"]);

    const unavailable = new SessionManager({
      vault: await createVault(), validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 32 }, idFactory: () => "unused",
      initializeTk88State: async () => { throw new Error("browser-secret-canary"); }
    });
    const status = await unavailable.configureTk88({ trustedHostname: "tk88.example" });
    expect(status).toMatchObject({ state: "INVALID", reason: "UNREACHABLE", secretConfigured: true });
    expect(JSON.stringify(status)).not.toContain("browser-secret-canary");
  });

  it("logs into Fabet and repeats the read-only bootstrap after 24 hours", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let loginCalls = 0;
    const loginEntryUrls: string[] = [];
    let captureCalls = 0;
    let resetCalls = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async (input) => { loginCalls += 1; loginEntryUrls.push(input.entryUrl); },
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
      entryUrl: "https://fabet.monster/",
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
    expect(loginEntryUrls).toEqual(["https://fabet.monster/", "https://fabet.monster/"]);
    expect(captureCalls).toBe(2);
    expect((await manager.listStatuses()).sessions.find((session) => session.provider === "FABET")).toMatchObject({
      state: "ACTIVE", acquiredAtMs: 86_400_040, renewAfterMs: 172_800_040
    });

    await manager.resetFabet();
    expect(resetCalls).toBe(1);
  });

  it("activates a newly captured known Football lounge only after its validator passes", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let validatedSecret = "";
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA",
        validate: async (secret) => {
          validatedSecret = secret.value;
          return { ok: true };
        }
      }]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          await vault.save("fresh-launch", { kind: "LAUNCH_URL",
            value: "https://sports.vendor.test/launch?token=fresh", capturedAtMs: clock.wallClockNowMs });
          return [{ category: "FOOTBALL", providerHint: "SABA", hostname: "sports.vendor.test",
            capturedAtMs: clock.wallClockNowMs, vaultRecordId: "fresh-launch" }];
        },
        resetProfile: async () => undefined
      }
    });

    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });

    expect((await manager.listStatuses()).sessions.find((session) => session.provider === "SABA")).toMatchObject({
      state: "ACTIVE", reason: null, lastValidatedAtMs: 40
    });
    expect(validatedSecret).toContain("https://sports.vendor.test/launch");
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

  it("renews the Fabet parent before its derived one-time Football launches", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let launchVersion = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA", validate: async () => ({ ok: true })
      }]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => { if (launchVersion > 0) await new Promise((resolve) => setTimeout(resolve, 20)); },
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
    await manager.tick();

    expect((await manager.listStatuses()).sessions.find((session) => session.id === launch.id)).toMatchObject({
      state: "ACTIVE", reason: null, acquiredAtMs: 86_400_040, renewAfterMs: 172_800_040
    });
    const handle = await manager.getActiveSecretHandle(launch.id);
    expect(await handle?.withSecret(async (secret) => secret.value)).toBe("https://sports.vendor.test/launch?v=2");
  });

  it("heals a previously verified expired lounge when Fabet captures its replacement URL", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let launchVersion = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA", validate: async () => ({ ok: true })
      }]),
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
    await expect(manager.renew(launch.id)).resolves.toMatchObject({ state: "ACTION_REQUIRED", reason: "EXPIRED" });

    await manager.tick();

    expect((await manager.listStatuses()).sessions.find((session) => session.id === launch.id)).toMatchObject({
      state: "ACTIVE", reason: null, acquiredAtMs: 86_400_040, renewAfterMs: 172_800_040
    });
    expect(launchVersion).toBe(3);
  });

  it("does not refresh Fabet for an expired historical lounge when the newest lounge is active", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let captureCalls = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA", validate: async () => ({ ok: true })
      }]),
      clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          captureCalls += 1;
          const hostname = captureCalls === 1 ? "old.vendor.test" : "new.vendor.test";
          await vault.save("current-launch", { kind: "LAUNCH_URL",
            value: `https://${hostname}/launch?v=${captureCalls}`, capturedAtMs: clock.wallClockNowMs });
          return [{ category: "FOOTBALL", providerHint: "SABA", hostname,
            capturedAtMs: clock.wallClockNowMs, vaultRecordId: "current-launch" }];
        },
        resetProfile: async () => undefined
      }
    });
    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    const historical = (await manager.listStatuses()).sessions.find((session) => session.provider === "SABA")!;
    clock.wallClockNowMs = 86_400_040;
    await manager.renew("fabet");
    await manager.renew(historical.id);

    await manager.tick();

    expect(captureCalls).toBe(2);
    const launches = (await manager.listStatuses()).sessions.filter((session) => session.provider === "SABA");
    expect(launches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: historical.id, state: "ACTION_REQUIRED", reason: "EXPIRED" }),
      expect.objectContaining({ state: "ACTIVE", reason: null, acquiredAtMs: 86_400_040 })
    ]));
  });

  it("ignores expired LoL launches while Football-only collection is enabled", async () => {
    const vault = await createVault();
    let captureCalls = 0;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{
        provider: "SABA", validate: async () => ({ ok: true })
      }]),
      clock: { nowMs: () => 50 },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          captureCalls += 1;
          await vault.save("football-launch", { kind: "LAUNCH_URL",
            value: "https://same.vendor.test/football", capturedAtMs: 50 });
          await vault.save("lol-launch", { kind: "LAUNCH_URL",
            value: "https://same.vendor.test/lol", capturedAtMs: 50 });
          return [
            { category: "FOOTBALL", providerHint: "SABA", hostname: "same.vendor.test",
              capturedAtMs: 50, vaultRecordId: "football-launch" },
            { category: "LOL", providerHint: "SABA", hostname: "same.vendor.test",
              capturedAtMs: 50, vaultRecordId: "lol-launch" }
          ];
        },
        resetProfile: async () => undefined
      }
    });
    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    const lol = (await manager.listStatuses()).sessions.find((session) => session.category === "LOL")!;
    await manager.renew(lol.id);

    await manager.tick();

    expect(captureCalls).toBe(1);
  });

  it("recovers a Fabet renewal interrupted by an API restart", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 40 };
    let loginCalls = 0;
    const driver = {
      login: async () => { loginCalls += 1; },
      captureLobbyLaunches: async () => [],
      resetProfile: async () => undefined
    };
    const create = (): SessionManager => new SessionManager({
      vault, validators: new SessionValidatorRegistry([]), clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused", fabetDriver: driver
    });
    await create().configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    const stored = await vault.load("session-fabet");
    expect(stored).not.toBeNull();
    await vault.save("session-fabet", { ...stored, state: "RENEWING", reason: null } as SecretRecord);

    const restarted = create();
    await restarted.tick();

    expect((await restarted.listStatuses()).sessions.find((session) => session.id === "fabet"))
      .toMatchObject({ state: "ACTIVE", reason: null, acquiredAtMs: 40 });
    expect(loginCalls).toBe(2);
  });

  it("automatically retries a configured Fabet parent left invalid by an earlier process", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 50 };
    let loginCalls = 0;
    const driver = {
      login: async () => { loginCalls += 1; },
      captureLobbyLaunches: async () => [],
      resetProfile: async () => undefined
    };
    const create = (): SessionManager => new SessionManager({
      vault, validators: new SessionValidatorRegistry([]), clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused", fabetDriver: driver
    });
    await create().configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });
    const stored = await vault.load("session-fabet");
    expect(stored).not.toBeNull();
    await vault.save("session-fabet", { ...stored, state: "INVALID", reason: "UNREACHABLE",
      trustedHostname: "fabet.com", secret: { kind: "FABET_CREDENTIALS",
        value: JSON.stringify({ entryUrl: "https://fabet.com/", username: "development-user",
          password: "development-pass" }) }, nextRetryAtMs: null } as SecretRecord);

    const restarted = create();
    await restarted.tick();

    expect((await restarted.listStatuses()).sessions.find((session) => session.id === "fabet"))
      .toMatchObject({ state: "ACTIVE", reason: null, acquiredAtMs: 50,
        trustedHostname: "fabet.monster" });
    expect(JSON.parse(String(((await vault.load("session-fabet")) as Record<string, unknown>).secret &&
      (((await vault.load("session-fabet")) as Record<string, unknown>).secret as Record<string, unknown>).value)))
      .toMatchObject({ entryUrl: "https://fabet.monster/" });
    expect(loginCalls).toBe(2);
  });

  it("does not let an in-flight renewal overwrite newly configured Fabet credentials", async () => {
    const vault = await createVault();
    const clock = { wallClockNowMs: 0 };
    let loginCalls = 0;
    let releaseRenewal!: () => void;
    let renewalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { renewalEntered = resolve; });
    const renewalGate = new Promise<void>((resolve) => { releaseRenewal = resolve; });
    const manager = new SessionManager({
      vault, validators: new SessionValidatorRegistry([]), clock: { nowMs: () => clock.wallClockNowMs },
      idFactory: () => "unused", fabetDriver: {
        login: async () => {
          loginCalls += 1;
          if (loginCalls === 2) { renewalEntered(); await renewalGate; }
        },
        captureLobbyLaunches: async () => [], resetProfile: async () => undefined
      }
    });
    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "old-user",
      password: "old-pass", trustedHostname: "fabet.party" });
    clock.wallClockNowMs = 86_400_000;
    const renewal = manager.tick();
    await entered;
    const replacement = manager.configureFabet({ entryUrl: "https://fabet.monster/", username: "new-user",
      password: "new-pass", trustedHostname: "fabet.monster" });
    const beforeRelease = await Promise.race([
      replacement.then(() => "resolved" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20))
    ]);
    expect(beforeRelease).toBe("pending");
    releaseRenewal();
    await Promise.all([renewal, replacement]);

    const stored = await vault.load("session-fabet");
    expect(JSON.parse(String((stored as Record<string, unknown>).secret &&
      ((stored as Record<string, unknown>).secret as Record<string, unknown>).value))).toMatchObject({
      username: "new-user", password: "new-pass", entryUrl: "https://fabet.monster/"
    });
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

  it("never reuses a SABA launch captured before the current maintenance cycle", async () => {
    const vault = await createVault();
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([]),
      clock: { nowMs: () => 50 },
      idFactory: () => "unused",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          await vault.save("saba-launch", {
            kind: "LAUNCH_URL", value: "https://c0z0ob.bpd3a3fn.com/fresh", capturedAtMs: 50
          });
          return [{ category: "FOOTBALL" as const, providerHint: "SABA" as const,
            hostname: "c0z0ob.bpd3a3fn.com", capturedAtMs: 50, vaultRecordId: "saba-launch" }];
        },
        resetProfile: async () => undefined
      }
    });
    await manager.configureFabet({
      entryUrl: "https://fabet.party/", username: "development-user", password: "development-pass",
      trustedHostname: "fabet.party"
    });

    await expect(manager.withLatestFabetLaunch("SABA", "FOOTBALL", async (url) => url, 51))
      .rejects.toThrow("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
    await expect(manager.withLatestFabetLaunch("SABA", "FOOTBALL", async (url) => url, 50))
      .resolves.toBe("https://c0z0ob.bpd3a3fn.com/fresh");
  });

  it("uses an operator-configured SBOBET launch instead of replacing it with Fabet capture", async () => {
    const vault = await createVault();
    let nowMs = 10;
    const manager = new SessionManager({
      vault,
      validators: new SessionValidatorRegistry([{ provider: "SBOBET", validate: async () => ({ ok: true }) }]),
      clock: { nowMs: () => nowMs },
      idFactory: () => "manual-sbobet",
      fabetDriver: {
        login: async () => undefined,
        captureLobbyLaunches: async () => {
          await vault.save("fabet-sbobet", {
            kind: "LAUNCH_URL", value: "https://zenandfe.com/?token=fabet", capturedAtMs: nowMs
          });
          return [{ category: "FOOTBALL" as const, providerHint: "SBOBET" as const,
            hostname: "zenandfe.com", capturedAtMs: nowMs, vaultRecordId: "fabet-sbobet" }];
        },
        resetProfile: async () => undefined
      }
    });
    await manager.configureManual({ provider: "SBOBET", category: "FOOTBALL", kind: "LAUNCH_URL",
      secret: "https://zenandfe.com/?token=manual&sportId=1&lng=vi" });
    nowMs = 50;
    await manager.configureFabet({ entryUrl: "https://fabet.party/", username: "development-user",
      password: "development-pass", trustedHostname: "fabet.party" });

    await expect(manager.withLatestFabetLaunch("SBOBET", "FOOTBALL", async (url) => url, 50))
      .resolves.toBe("https://zenandfe.com/?token=manual&sportId=1&lng=vi");
  });
});
