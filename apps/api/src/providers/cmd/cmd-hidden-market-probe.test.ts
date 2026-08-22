import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CmdHiddenMarketProbe, summarizeCmdProtocolFrame } from "./cmd-hidden-market-probe.js";

describe("CmdHiddenMarketProbe", () => {
  let browser: Browser;

  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("opens only the exact event detail and expands safe controls to a fixed point", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="c-match" data-matchid="other">
        <button class="c-match__detail">Details</button>
      </div>
      <div class="c-match" data-matchid="25250586">
        <button class="c-match__detail" aria-label="View details">Vietnam Malaysia</button>
        <button class="c-odds" data-moid="visible:1" onclick="document.body.dataset.unsafe='1'">0.90</button>
      </div>
      <script>
        document.querySelector('[data-matchid="25250586"] .c-match__detail').onclick = () => {
          const row = document.querySelector('[data-matchid="25250586"]');
          if (row.querySelector('[data-moid="hidden:1"]')) return;
          row.insertAdjacentHTML('beforeend', '<div class="c-match__odds-group"><i class="c-odds" data-moid="hidden:1">0.88</i></div><button class="show-more">Show more</button>');
          row.querySelector('.show-more').onclick = (event) => {
            event.currentTarget.remove();
            row.insertAdjacentHTML('beforeend', '<div class="c-match__odds-group"><i class="c-odds" data-moid="hidden:2">0.86</i></div>');
          };
        };
      </script>
    `);
    const probe = new CmdHiddenMarketProbe({
      withProviderPage: async (_provider, _category, consume) => consume(page),
      settleMs: 1,
      timeoutMs: 2_000
    });

    const result = await probe.probe("25250586");

    expect(result).toMatchObject({
      providerEventId: "25250586",
      status: "EXPANDED",
      beforeMarketIds: ["visible:1"],
      afterMarketIds: ["hidden:1", "hidden:2", "visible:1"],
      clickedControlCount: 2,
      stablePasses: 2
    });
    expect(await page.locator("body").getAttribute("data-unsafe")).toBeNull();
    expect(await page.locator('[data-matchid="other"] [aria-expanded="true"]').count()).toBe(0);
    await page.close();
  });

  it("returns EVENT_NOT_FOUND without clicking a different event", async () => {
    const page = await browser.newPage();
    await page.setContent('<div class="c-match" data-matchid="other"><button class="c-match__detail" onclick="document.body.dataset.clicked=\'1\'">Details</button></div>');
    const probe = new CmdHiddenMarketProbe({
      withProviderPage: async (_provider, _category, consume) => consume(page),
      settleMs: 1,
      timeoutMs: 500
    });

    await expect(probe.probe("missing")).resolves.toMatchObject({ status: "EVENT_NOT_FOUND" });
    expect(await page.locator("body").getAttribute("data-clicked")).toBeNull();
    await page.close();
  });

  it("times out while acquiring the provider page instead of leaving the HTTP request hanging", async () => {
    const probe = new CmdHiddenMarketProbe({
      withProviderPage: async () => new Promise<never>(() => undefined),
      settleMs: 1,
      timeoutMs: 250
    });

    await expect(probe.probe("25250586")).rejects.toThrow("CMD_HIDDEN_PROBE_TIMEOUT");
  });
});

describe("summarizeCmdProtocolFrame", () => {
  it("keeps structural subscription evidence and removes credentials", () => {
    const result = summarizeCmdProtocolFrame(JSON.stringify({
      command: "subscribe",
      channel: "/event/25250586/markets",
      eventId: "25250586",
      token: "secret-token",
      nested: { authorization: "bearer secret", marketGroup: 7 }
    }), "25250586", "SENT");

    expect(result).toEqual({
      direction: "SENT",
      byteLength: 162,
      eventIdReferenced: true,
      jsonKeys: ["channel", "command", "eventId", "marketGroup", "nested"],
      channelPaths: ["/event/25250586/markets"]
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
