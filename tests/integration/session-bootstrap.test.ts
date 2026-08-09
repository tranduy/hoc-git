import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { createFixtureRuntime } from "../../apps/api/src/server.js";
import type { FabetBrowserAutomation } from "../../apps/api/src/sessions/fabet-browser.js";
import { createSessionServices } from "../../apps/api/src/sessions/session-services.js";
import type { SecretProtector, SessionValidator } from "../../apps/api/src/sessions/types.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x11),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x11)
};

const sabaValidator: SessionValidator = {
  provider: "SABA",
  validate: async (secret) => secret.value === "restart-secret-canary" ? { ok: true } : { ok: false, reason: "UNAUTHORIZED" }
};

const automation: FabetBrowserAutomation = {
  login: async () => undefined,
  captureNavigations: async () => [],
  isAuthenticated: async () => true,
  close: async () => undefined
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("session bootstrap integration", () => {
  it("restores a direct provider session after API reconstruction while Fabet is unreachable", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "tool-chenh-session-integration-"));
    directories.push(localAppData);
    const options = {
      localAppData,
      protector,
      automation,
      fetch: async () => { throw new Error("fabet-network-secret-canary"); },
      clock: { nowMs: () => 1_000 },
      idFactory: () => "manual-saba-1",
      validators: [sabaValidator]
    } as const;
    const firstServices = createSessionServices(options);
    const firstApp = buildApp(createFixtureRuntime(100), { sessionServices: firstServices });
    await firstApp.ready();
    const configured = await firstApp.inject({
      method: "POST",
      url: "/api/sessions/manual",
      headers: { origin: "http://127.0.0.1:4311" },
      payload: { provider: "SABA", kind: "TOKEN", secret: "restart-secret-canary" }
    });
    expect(configured.json()).toMatchObject({ state: "ACTIVE", provider: "SABA" });
    await firstApp.close();
    await firstServices.close();

    const secondServices = createSessionServices(options);
    const secondApp = buildApp(createFixtureRuntime(100), { sessionServices: secondServices });
    await secondApp.ready();
    const restored = await secondApp.inject({ method: "GET", url: "/api/sessions" });
    expect(restored.json()).toEqual({ sessions: [expect.objectContaining({ state: "ACTIVE", provider: "SABA" })] });
    const failedDiscovery = await secondApp.inject({
      method: "POST",
      url: "/api/sessions/fabet/discover",
      headers: { origin: "http://127.0.0.1:4311" },
      payload: { entryUrl: "https://fabet.com/" }
    });
    expect(failedDiscovery.statusCode).toBe(503);
    expect((await secondServices.manager.listStatuses()).sessions[0]?.state).toBe("ACTIVE");

    const vault = await readFile(join(localAppData, "tool-chenh", ".auth", "vault", "vault.v1.json"), "utf8");
    expect(vault).not.toMatch(/restart-secret-canary|fabet-network-secret-canary/u);
    await secondApp.close();
    await secondServices.close();
  });
});
