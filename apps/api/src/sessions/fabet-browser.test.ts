import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  capturedTopLevelNavigation,
  FabetBrowserDriver,
  launcherTextIsSafe,
  PlaywrightFabetAutomation,
  type CapturedNavigation,
  type FabetBrowserAutomation
} from "./fabet-browser.js";
import { SecretVault } from "./secret-vault.js";
import { TrustedDomainStore } from "./trusted-domain-store.js";
import type { SecretProtector } from "./types.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x22),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x22)
};

class FakeAutomation implements FabetBrowserAutomation {
  loginCalls: Array<{ entryUrl: string; username: string; password: string }> = [];
  lobbyCalls: string[] = [];
  closed = false;
  authenticated = true;
  launches: Record<string, CapturedNavigation[]> = {};

  async login(input: { entryUrl: string; username: string; password: string }): Promise<void> {
    this.loginCalls.push(input);
  }

  async captureNavigations(lobbyUrl: string): Promise<readonly CapturedNavigation[]> {
    this.lobbyCalls.push(lobbyUrl);
    return this.launches[lobbyUrl] ?? [];
  }

  async isAuthenticated(): Promise<boolean> {
    return this.authenticated;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-browser-"));
  directories.push(directory);
  const vault = new SecretVault({ directory: join(directory, "vault"), protector });
  const trustStore = new TrustedDomainStore({ vault, clock: { nowMs: () => 10 } });
  const automation = new FakeAutomation();
  const profilesRoot = join(directory, "profiles");
  return { directory, vault, trustStore, automation, profilesRoot };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FabetBrowserDriver", () => {
  it("binds only a safe launcher label to an external top-level provider URL", () => {
    expect(capturedTopLevelNavigation(
      "https://fabet.party", "SABA-SPORTS", "https://sports.vendor.test/launch?token=secret-canary"
    )).toEqual({ url: "https://sports.vendor.test/launch?token=secret-canary", label: "SABA-SPORTS" });
    expect(capturedTopLevelNavigation(
      "https://fabet.party", "SABA-SPORTS", "https://secure.livechatinc.com/customer/action"
    )).toBeNull();
    expect(capturedTopLevelNavigation(
      "https://fabet.party", "Deposit", "https://sports.vendor.test/launch"
    )).toBeNull();
  });
  it("blocks credential transmission until the exact hostname is trusted", async () => {
    const context = await setup();
    const driver = new FabetBrowserDriver({ ...context, clock: { nowMs: () => 20 }, idFactory: () => "1" });

    await expect(driver.login({
      entryUrl: "https://fabet.party/", username: "development-user", password: "development-pass"
    })).rejects.toMatchObject({ code: "DOMAIN_APPROVAL_REQUIRED" });

    expect(context.automation.loginCalls).toEqual([]);
  });

  it("visits both lobbies and stores raw launch URLs only in the vault", async () => {
    const context = await setup();
    await context.trustStore.approve("fabet.party");
    context.automation.launches = {
      "https://fabet.party/lobby-the-thao?type=livesports": [{
        url: "https://sports.vendor.test/launch?token=launch-secret-canary",
        label: "SABA-SPORTS"
      }],
      "https://fabet.party/lobby-the-thao?type=esports": [{
        url: "https://esports.vendor.test/start?session=esports-secret-canary",
        label: "ESPORTS"
      }]
    };
    let id = 0;
    const driver = new FabetBrowserDriver({
      ...context,
      clock: { nowMs: () => 30 },
      idFactory: () => String(++id)
    });
    await driver.login({ entryUrl: "https://fabet.party/", username: "development-user", password: "development-pass" });

    const launches = await driver.captureLobbyLaunches();

    expect(launches).toEqual([
      expect.objectContaining({ category: "FOOTBALL", providerHint: "SABA", hostname: "sports.vendor.test" }),
      expect.objectContaining({ category: "LOL", providerHint: "UNKNOWN", hostname: "esports.vendor.test" })
    ]);
    expect(JSON.stringify(launches)).not.toMatch(/launch-secret-canary|esports-secret-canary/u);
    expect(await context.vault.load(launches[0]!.vaultRecordId)).toEqual({
      kind: "LAUNCH_URL",
      value: "https://sports.vendor.test/launch?token=launch-secret-canary",
      capturedAtMs: 30
    });
    expect(context.automation.lobbyCalls).toEqual([
      "https://fabet.party/lobby-the-thao?type=livesports",
      "https://fabet.party/lobby-the-thao?type=esports"
    ]);
  });

  it.each([
    ["SABA-SPORTS", true],
    ["BTI", true],
    ["APSPORT", true],
    ["Đặt cược", false],
    ["Confirm Bet", false],
    ["Nạp tiền", false],
    ["", false]
  ])("classifies launcher text %s without allowing wager controls", (label, expected) => {
    expect(launcherTextIsSafe(label)).toBe(expected);
  });

  it("deletes only its isolated profile after reset", async () => {
    const context = await setup();
    const profile = join(context.profilesRoot, "fabet");
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "state"), "browser-secret-canary", "utf8");
    const sibling = join(context.profilesRoot, "keep");
    await mkdir(sibling, { recursive: true });
    const driver = new FabetBrowserDriver({ ...context, clock: { nowMs: () => 1 }, idFactory: () => "1" });

    await driver.resetProfile();

    expect(context.automation.closed).toBe(true);
    await expect(stat(profile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(sibling)).resolves.toBeDefined();
  });
});

describe("PlaywrightFabetAutomation", () => {
  it("opens the login modal and submits the visible form", async () => {
    let submitted = 0;
    const server = createServer((request, response) => {
      if (request.url === "/submitted") {
        submitted += 1;
        response.writeHead(204).end();
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><body>
        <button id="open" onclick="document.querySelector('#modal').hidden=false">Đăng nhập</button>
        <section id="modal" hidden>
          <input autocomplete="username">
          <input type="password">
          <button onclick="fetch('/submitted').then(()=>{document.querySelector('#open').remove();document.querySelector('#modal').remove()})">Đăng nhập</button>
        </section>
      </body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const profilePath = join(await setup().then((value) => value.directory), "real-profile");
    const automation = new PlaywrightFabetAutomation({ profilePath, headless: true });
    try {
      await automation.login({
        entryUrl: `http://127.0.0.1:${address.port}/`,
        username: "development-user",
        password: "development-pass"
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(submitted).toBe(1);
      expect(await automation.isAuthenticated()).toBe(true);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);
});
