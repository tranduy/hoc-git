import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import {
  capturedTopLevelNavigation,
  FabetBrowserDriver,
  launcherLabelFromCard,
  safeLauncherAssetName,
  launcherTextIsSafe,
  providerLaunchUrlFromResponseBody,
  PlaywrightFabetAutomation,
  shouldBlockExternalProviderNavigation,
  isProviderLaunchResponseForCurrentCard,
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
  authenticatedUrlValue: string | null = null;
  providerPageCalls: Array<{ lobbyUrl: string; provider: "SABA"; category: "FOOTBALL" | "LOL" }> = [];

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

  async authenticatedUrl(): Promise<string> {
    return this.authenticatedUrlValue ?? this.loginCalls.at(-1)?.entryUrl ?? "https://fabet.party/";
  }

  async withProviderPage<T>(input: { lobbyUrl: string; provider: "SABA"; category: "FOOTBALL" | "LOL" },
    consume: (page: Page) => Promise<T>): Promise<T> {
    this.providerPageCalls.push(input);
    return consume({} as Page);
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
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  })));
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
  it("blocks only external top-level provider navigation while preserving the launch API request", () => {
    expect(shouldBlockExternalProviderNavigation(
      "https://fabet.party", "https://sports.vendor.test/one-time-launch", true
    )).toBe(true);
    expect(shouldBlockExternalProviderNavigation(
      "https://fabet.party", "https://fabet.party/api/v3/game-url", true
    )).toBe(false);
    expect(shouldBlockExternalProviderNavigation(
      "https://fabet.party", "https://cdn.vendor.test/card.webp", false
    )).toBe(false);
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
        label: "APSPORT"
      }, {
        url: "https://sbobet.vendor.test/start?session=sbobet-secret-canary",
        label: "K-SPORTS"
      }, {
        url: "https://imesports.techplay.com/esportsitev2/index.html?token=im-secret-canary",
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
      expect.objectContaining({ category: "LOL", providerHint: "APSPORT", hostname: "esports.vendor.test" }),
      expect.objectContaining({ category: "LOL", providerHint: "SBOBET", hostname: "sbobet.vendor.test" }),
      expect.objectContaining({ category: "LOL", providerHint: "IM", hostname: "imesports.techplay.com" })
    ]);
    expect(JSON.stringify(launches)).not.toMatch(/launch-secret-canary|esports-secret-canary|im-secret-canary/u);
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

  it("uses the trusted final origin after Fabet redirects to its current domain", async () => {
    const context = await setup();
    await context.trustStore.approve("fabet.com");
    await context.trustStore.approve("fabet.party");
    context.automation.authenticatedUrlValue = "https://fabet.party/home";
    const driver = new FabetBrowserDriver({ ...context, clock: { nowMs: () => 30 }, idFactory: () => "1" });

    await driver.login({ entryUrl: "https://fabet.com/", username: "development-user", password: "development-pass" });
    await driver.captureLobbyLaunches();

    expect(context.automation.lobbyCalls).toEqual([
      "https://fabet.party/lobby-the-thao?type=livesports",
      "https://fabet.party/lobby-the-thao?type=esports"
    ]);
  });

  it("derives the SABA lobby from the authenticated Fabet origin for just-in-time use", async () => {
    const context = await setup();
    await context.trustStore.approve("fabet.party");
    context.automation.authenticatedUrlValue = "https://fabet.party/home";
    const driver = new FabetBrowserDriver({ ...context, clock: { nowMs: () => 30 }, idFactory: () => "1" });
    await driver.login({ entryUrl: "https://fabet.party/", username: "development-user", password: "development-pass" });

    await expect(driver.withProviderPage("SABA", "FOOTBALL", async () => "provider-result"))
      .resolves.toBe("provider-result");
    expect(context.automation.providerPageCalls.at(-1)).toEqual({
      lobbyUrl: "https://fabet.party/lobby-the-thao?type=livesports", provider: "SABA", category: "FOOTBALL"
    });
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

  it("uses the card name and thumbnail to disambiguate generic esports launchers", () => {
    expect(launcherLabelFromCard("C-Sports", "/game/sabaport.webp")).toBe("C-Sports");
    expect(launcherLabelFromCard("Esports", "/game/saba_esportss_landscape.avif")).toBe("SABA-SPORTS");
    expect(launcherLabelFromCard("Esports", "/game/bti_esportss_landscape.avif")).toBe("BTI");
    expect(launcherLabelFromCard("T-Sports", "/game/tpsports_landscape.webp")).toBe("APSPORT");
    expect(launcherLabelFromCard("T-Sports", "/game/tsports_landscape.avif")).toBe("BTI");
  });

  it("keeps only a bounded asset basename for launcher diagnostics", () => {
    expect(safeLauncherAssetName("https://cdn.test/game/t_sport.png?token=secret-canary")).toBe("t_sport.png");
    expect(safeLauncherAssetName("/game/AP-Sports_2.webp")).toBe("AP-Sports_2.webp");
    expect(safeLauncherAssetName("data:text/plain,secret-canary")).toBeNull();
  });

  it("accepts only the provider launch field from the game-url response shape", () => {
    expect(providerLaunchUrlFromResponseBody({ data: { url: "https://provider.test/launch" } }))
      .toBe("https://provider.test/launch");
    expect(providerLaunchUrlFromResponseBody({ url: "https://provider.test/wrong-level" })).toBeNull();
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
  it("reports an expired Fabet login instead of waiting for missing lobby cards", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><button>Đăng nhập</button>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const automation = new PlaywrightFabetAutomation({
      profilePath: join(await setup().then((value) => value.directory), "logged-out-profile"), headless: true
    });
    try {
      await expect(automation.withProviderPage({ lobbyUrl: `http://127.0.0.1:${address.port}/lobby`,
        provider: "SABA", category: "FOOTBALL" }, async () => undefined))
        .rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 5_000);

  it("clicks the real SABA lobby card and reuses the popup in the Fabet browser context", async () => {
    let launchCount = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url === "/provider") {
        launchCount += 1;
        response.end("<!doctype html><title>SABA live</title><main>Provider ready</main>");
        return;
      }
      const card = `<div class="game-item lobby">
        <img class="game-item__thumb" src="/game/sabaport.webp"><p class="game-item__name">SABA-SPORTS</p>
        <div class="game-item__play-btn"><button onclick="window.open('http://localhost:${(server.address() as { port: number }).port}/provider')">Play</button></div>
      </div>`;
      response.end(`<!doctype html><div class="game-item lobby">
        <p class="game-item__name">C-SPORTS</p><div class="game-item__play-btn"><button>Play</button></div>
      </div>${card}${card}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const profilePath = join(await setup().then((value) => value.directory), "provider-popup-profile");
    const automation = new PlaywrightFabetAutomation({ profilePath, headless: true });
    const lobbyUrl = `http://127.0.0.1:${address.port}/lobby`;
    let activeConsumers = 0;
    let maximumActiveConsumers = 0;
    const consume = async <T>(operation: () => Promise<T>): Promise<T> => {
      activeConsumers += 1;
      maximumActiveConsumers = Math.max(maximumActiveConsumers, activeConsumers);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return await operation();
      } finally {
        activeConsumers -= 1;
      }
    };
    try {
      const [body, title] = await Promise.all([
        automation.withProviderPage({ lobbyUrl, provider: "SABA", category: "FOOTBALL" },
          async (page) => consume(async () => page.locator("main").innerText())),
        automation.withProviderPage({ lobbyUrl, provider: "SABA", category: "FOOTBALL" },
          async (page) => consume(async () => page.title()))
      ]);
      expect(body).toBe("Provider ready");
      expect(title).toBe("SABA live");
      await expect(automation.withProviderPage({ lobbyUrl, provider: "SABA", category: "FOOTBALL" },
        async (page) => page.title())).resolves.toBe("SABA live");
      expect(launchCount).toBe(1);
      expect(maximumActiveConsumers).toBe(1);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);

  it("discards a failed SABA popup so the next read clicks a fresh lobby launch", async () => {
    let launchCount = 0;
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url === "/provider") {
        launchCount += 1;
        response.end("<!doctype html><main>Provider ready</main>");
        return;
      }
      response.end(`<!doctype html><div class="game-item lobby">
        <img class="game-item__thumb" src="/game/sabaport.webp"><p class="game-item__name">SABA-SPORTS</p>
        <div class="game-item__play-btn"><button onclick="window.open('http://localhost:${(server.address() as { port: number }).port}/provider')">Play</button></div>
      </div>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const automation = new PlaywrightFabetAutomation({
      profilePath: join(await setup().then((value) => value.directory), "failed-popup-profile"), headless: true
    });
    const input = { lobbyUrl: `http://127.0.0.1:${address.port}/lobby`, provider: "SABA" as const,
      category: "FOOTBALL" as const };
    try {
      await expect(automation.withProviderPage(input, async () => { throw new Error("SOURCE_EXPIRED"); }))
        .rejects.toThrow("SOURCE_EXPIRED");
      await expect(automation.withProviderPage(input, async (page) => page.locator("main").innerText()))
        .resolves.toBe("Provider ready");
      expect(launchCount).toBe(2);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);

  it("captures a provider launch returned by the lobby game-url API", async () => {
    const lobby = createServer((request, response) => {
      if (request.url === "/api/v3/game-url") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: { url: "https://example.com/api-launch" } }));
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<div class="game-item lobby"><img class="game-item__thumb" src="/game/saba_esportss_landscape.avif"><p class="game-item__name">Esports</p><div class="game-item__play-btn"><button onclick="fetch('/api/v3/game-url')">Play</button></div></div>`);
  });

    await new Promise<void>((resolve) => lobby.listen(0, "127.0.0.1", resolve));
    const lobbyAddress = lobby.address();
    if (lobbyAddress === null || typeof lobbyAddress === "string") throw new Error("lobby server did not bind");
    const profilePath = join(await setup().then((value) => value.directory), "api-card-profile");
    const automation = new PlaywrightFabetAutomation({ profilePath, headless: true });
    try {
      await expect(automation.captureNavigations(`http://127.0.0.1:${lobbyAddress.port}/`)).resolves.toEqual([
        { label: "SABA-SPORTS", url: "https://example.com/api-launch" }
      ]);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) =>
        lobby.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);

  it("does not attribute a delayed launcher response to the next provider card", () => {
    const previousRequest = { url: () => "https://fabet.party/api/v3/game-url", method: () => "GET" };
    const currentRequest = { url: () => "https://fabet.party/api/v3/game-url", method: () => "GET" };
    const response = { url: () => previousRequest.url(), ok: () => true, request: () => previousRequest };

    expect(isProviderLaunchResponseForCurrentCard(
      "https://fabet.party", response, new Set([currentRequest])
    )).toBe(false);
    expect(isProviderLaunchResponseForCurrentCard(
      "https://fabet.party", response, new Set([previousRequest])
    )).toBe(true);
  });

  it("waits for a delayed SPA login form before submitting credentials", async () => {
    let submitted = 0;
    const server = createServer((request, response) => {
      if (request.url === "/submitted") {
        submitted += 1;
        response.writeHead(204).end();
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><body><main>Loading</main><script>
        setTimeout(() => {
          document.body.innerHTML = '<button id="open">Đăng Nhập</button><section id="modal" hidden><input autocomplete="username"><input type="password"><button id="submit">Đăng Nhập</button></section>';
          document.querySelector('#open').onclick = () => { document.querySelector('#modal').hidden = false; };
          document.querySelector('#submit').onclick = () => fetch('/submitted').then(() => {
            setTimeout(() => { document.body.innerHTML = '<button>Nạp Tiền</button>'; }, 400);
          });
        }, 300);
      </script></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const profilePath = join(await setup().then((value) => value.directory), "delayed-login-profile");
    const automation = new PlaywrightFabetAutomation({ profilePath, headless: true });
    try {
      await automation.login({
        entryUrl: `http://127.0.0.1:${address.port}/`, username: "development-user", password: "development-pass"
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(submitted).toBe(1);
      expect(await automation.isAuthenticated()).toBe(true);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);

  it("does not report authenticated before the SPA renders its delayed login control", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><body><main>Loading</main><script>
        setTimeout(() => {
          const button = document.createElement('button');
          button.textContent = 'Đăng Nhập';
          document.body.append(button);
        }, 300);
      </script></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server did not bind");
    const profilePath = join(await setup().then((value) => value.directory), "delayed-profile");
    const automation = new PlaywrightFabetAutomation({ profilePath, headless: true });
    try {
      await automation.login({
        entryUrl: `http://127.0.0.1:${address.port}/`, username: "development-user", password: "development-pass"
      });
      expect(await automation.isAuthenticated()).toBe(false);
    } finally {
      await automation.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  }, 20_000);

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
        <div class="modal dynamic__modal" style="position:fixed;inset:0;z-index:12;background:white">
          <span class="icon-close-btn" onclick="this.parentElement.remove()">Close</span>
          <label>Không hiển thị lại</label>
        </div>
        <div class="swal2-container" style="position:fixed;inset:0;z-index:11;background:white">Notice</div>
        <script>
          setTimeout(() => document.querySelector('.swal2-container').remove(), 300);
          setTimeout(() => { const popup=document.createElement('div');popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Thông báo khuyến mãi');popup.style='position:fixed;inset:0;z-index:10;background:white';popup.innerHTML='<button aria-label="Close" onclick="this.parentElement.remove()">Close</button>';document.body.append(popup); }, 100);
        </script>
        <input id="search" type="text" placeholder="Tìm kiếm">
        <button id="open" onclick="document.querySelector('#modal').hidden=false">Đăng nhập</button>
        <section id="modal" hidden>
          <input id="username" type="text" placeholder="Tên đăng nhập">
          <input id="password" type="password">
          <button onclick="{const valid=document.querySelector('#username').value==='development-user'&&document.querySelector('#password').value==='development-pass'&&document.querySelector('#search').value==='';if(valid)fetch('/submitted').then(()=>{document.querySelector('#open').remove();document.querySelector('#modal').remove();const deposit=document.createElement('button');deposit.textContent='Nạp Tiền';document.body.append(deposit)})}">Đăng nhập</button>
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
