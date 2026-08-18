import type { BrowserContext, Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { Tk88BrowserAutomation, type Tk88LoungeIdentity } from "./tk88-browser.js";

class FakePage {
  readonly navigations: string[] = [];
  closed = false;
  currentUrl = "about:blank";
  failNavigation = false;
  providerIdentity: string | null = null;

  isClosed(): boolean { return this.closed; }
  url(): string { return this.currentUrl; }
  async goto(url: string): Promise<null> {
    this.navigations.push(url);
    if (this.failNavigation) throw new Error(`secret navigation failed: ${url}?token=canary`);
    this.currentUrl = url;
    return null;
  }
}

class FakeContext {
  readonly pagesCreated: FakePage[] = [];
  closed = false;
  async newPage(): Promise<Page> {
    const page = new FakePage();
    this.pagesCreated.push(page);
    return page as unknown as Page;
  }
  pages(): Page[] { return this.pagesCreated as unknown as Page[]; }
  async close(): Promise<void> { this.closed = true; }
}

const football: Tk88LoungeIdentity = {
  provider: "SABA", category: "FOOTBALL", portalUrl: "https://tk88.example/sports",
  trustedHostname: "tk88.example", launcherLabel: "C-SPORTS"
};
const esports: Tk88LoungeIdentity = {
  provider: "IM", category: "LOL", portalUrl: "https://tk88.example/esports",
  trustedHostname: "tk88.example", launcherLabel: "ESPORTS"
};

describe("Tk88BrowserAutomation", () => {
  it("reuses one persistent context and one independent page per exact lounge", async () => {
    const context = new FakeContext();
    const launch = vi.fn(async () => context as unknown as BrowserContext);
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88", launch
    });

    const first = await browser.withLoungePage(football, async (page) => page.url());
    const second = await browser.withLoungePage(football, async (page) => page.url());
    const third = await browser.withLoungePage(esports, async (page) => page.url());

    expect(first).toBe(football.portalUrl);
    expect(second).toBe(football.portalUrl);
    expect(third).toBe(esports.portalUrl);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(context.pagesCreated).toHaveLength(2);
    expect(context.pagesCreated[0]?.navigations).toEqual([football.portalUrl]);
    expect(context.pagesCreated[1]?.navigations).toEqual([esports.portalUrl]);
  });

  it("allows different lounges to read concurrently but serializes the same lounge", async () => {
    const context = new FakeContext();
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext
    });
    let releaseFootball!: () => void;
    const footballHold = new Promise<void>((resolve) => { releaseFootball = resolve; });
    let footballEntered = false;
    let esportsEntered = false;

    const first = browser.withLoungePage(football, async () => { footballEntered = true; await footballHold; });
    await vi.waitFor(() => expect(footballEntered).toBe(true));
    const other = browser.withLoungePage(esports, async () => { esportsEntered = true; });
    await vi.waitFor(() => expect(esportsEntered).toBe(true));

    let secondSameEntered = false;
    const secondSame = browser.withLoungePage(football, async () => { secondSameEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondSameEntered).toBe(false);
    releaseFootball();
    await Promise.all([first, other, secondSame]);
    expect(secondSameEntered).toBe(true);
  });

  it("fails closed with a redacted error when navigation fails", async () => {
    const context = new FakeContext();
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext
    });
    const pending = browser.withLoungePage(football, async () => "unreachable");
    await vi.waitFor(() => expect(context.pagesCreated).toHaveLength(1));
    context.pagesCreated[0]!.failNavigation = true;
    context.pagesCreated[0]!.currentUrl = "about:blank";

    await expect(browser.withLoungePage(football, async () => "not returned"))
      .rejects.toThrowError("TK88_LOUNGE_UNAVAILABLE");
    await pending;
  });

  it("preserves a provider decoder failure after safe navigation", async () => {
    const context = new FakeContext();
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext
    });
    await expect(browser.withLoungePage(football, async () => { throw new Error("PROVIDER_SCHEMA_CHANGED"); }))
      .rejects.toThrowError("PROVIDER_SCHEMA_CHANGED");
  });

  it("uses only one uniquely verified existing provider page and never navigates it", async () => {
    const context = new FakeContext();
    const unrelated = await context.newPage() as unknown as FakePage;
    unrelated.currentUrl = "https://tk88.example/sports";
    const cmd = await context.newPage() as unknown as FakePage;
    cmd.currentUrl = "https://provider.example/opaque-launch";
    cmd.providerIdentity = "CMD|FOOTBALL";
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext,
      verifyProviderPage: async (provider, category, page) =>
        (page as unknown as FakePage).providerIdentity === `${provider}|${category}`
    });

    await expect(browser.withVerifiedProviderPage("CMD", "FOOTBALL", async (page) => page.url()))
      .resolves.toBe("https://provider.example/opaque-launch");
    expect(unrelated.navigations).toEqual([]);
    expect(cmd.navigations).toEqual([]);
  });

  it("fails closed when no page or multiple pages claim the same provider identity", async () => {
    const context = new FakeContext();
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext,
      verifyProviderPage: async (provider, category, page) =>
        (page as unknown as FakePage).providerIdentity === `${provider}|${category}`
    });

    await context.newPage();
    await expect(browser.withVerifiedProviderPage("CMD", "FOOTBALL", async () => "wrong"))
      .rejects.toThrowError("TK88_PROVIDER_PAGE_UNAVAILABLE");

    const first = context.pagesCreated[0]!;
    first.providerIdentity = "CMD|FOOTBALL";
    const second = await context.newPage() as unknown as FakePage;
    second.providerIdentity = "CMD|FOOTBALL";
    await expect(browser.withVerifiedProviderPage("CMD", "FOOTBALL", async () => "wrong"))
      .rejects.toThrowError("TK88_PROVIDER_PAGE_AMBIGUOUS");
  });

  it("opens only the exact trusted TK88 root in the managed profile", async () => {
    const context = new FakeContext();
    const browser = new Tk88BrowserAutomation({
      profilePath: "C:/local/tool-chenh/.auth/browser-profiles/tk88",
      launch: async () => context as unknown as BrowserContext
    });

    await expect(browser.openPortal("TK88.Example")).resolves.toBeUndefined();
    expect(context.pagesCreated).toHaveLength(1);
    expect(context.pagesCreated[0]?.navigations).toEqual(["https://tk88.example/"]);
    await expect(browser.openPortal("tk88.example/path"))
      .rejects.toThrowError("TK88_PORTAL_CONFIG_INVALID");
  });
});
