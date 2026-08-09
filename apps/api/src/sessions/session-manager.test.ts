import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
