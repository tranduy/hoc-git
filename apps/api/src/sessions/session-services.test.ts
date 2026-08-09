import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSessionServices } from "./session-services.js";
import type { FabetBrowserAutomation } from "./fabet-browser.js";
import type { SecretProtector } from "./types.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x66),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x66)
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("createSessionServices", () => {
  it("persists encrypted state below local app data and closes browser resources", async () => {
    const localAppData = await mkdtemp(join(tmpdir(), "tool-chenh-services-"));
    directories.push(localAppData);
    let closed = 0;
    const automation: FabetBrowserAutomation = {
      login: async () => undefined,
      captureNavigations: async () => [],
      isAuthenticated: async () => true,
      close: async () => { closed += 1; }
    };
    const services = createSessionServices({
      localAppData,
      protector,
      automation,
      fetch: async () => new Response("ok"),
      clock: { nowMs: () => 100 },
      idFactory: () => "manual-1"
    });

    await services.manager.configureManual({ provider: "SABA", kind: "TOKEN", secret: "factory-secret-canary" });

    const vaultFile = join(localAppData, "tool-chenh", ".auth", "vault", "vault.v1.json");
    expect(await readFile(vaultFile, "utf8")).not.toContain("factory-secret-canary");
    await services.close();
    expect(closed).toBe(1);
  });

  it("rejects an empty local application-data root", () => {
    expect(() => createSessionServices({ localAppData: "", protector })).toThrowError("LOCAL_APP_DATA_REQUIRED");
  });
});
