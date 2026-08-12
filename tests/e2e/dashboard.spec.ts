import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

async function expectNoExecutionControls(page: Page): Promise<void> {
  const forbiddenName = /\b(?:arm|submit|execute|confirm|place(?:\s+a)?\s+bet|bet|wager|buy|log[\s-]?in|credential|account|member|session|cookie|authorization|token|password)\b/i;
  for (const role of ["button", "link", "textbox", "checkbox", "radio", "combobox", "spinbutton"] as const) {
    await expect(page.getByRole(role, { name: forbiddenName })).toHaveCount(0);
  }
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("label").filter({ hasText: forbiddenName })).toHaveCount(0);
  await expect(page.locator([
    'input[type="password" i]',
    'input[name*="credential" i]',
    'input[id*="credential" i]',
    'input[name*="account" i]',
    'input[id*="account" i]',
    'input[name*="member" i]',
    'input[id*="member" i]',
    'input[name*="session" i]',
    'input[id*="session" i]',
    'input[name*="cookie" i]',
    'input[id*="cookie" i]',
    'input[name*="authorization" i]',
    'input[id*="authorization" i]',
    'input[name*="token" i]',
    'input[id*="token" i]',
    'input[name*="password" i]',
    'input[id*="password" i]',
    'input[autocomplete="username" i]',
    'input[autocomplete="current-password" i]'
  ].join(", "))).toHaveCount(0);
}

test("operator can inspect separate Football and LoL opportunities", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Football" }).click();
  await expect(page.getByRole("heading", { name: "Football" })).toBeVisible();
  await expect(page.getByText("FULL_TIME").first()).toBeVisible();
  await expect(page.getByText("MAP_3")).toHaveCount(0);

  await page.getByRole("link", { name: "LoL" }).click();
  await expect(page.getByRole("heading", { name: "LoL" })).toBeVisible();
  await expect(page.getByText("MAP_3").first()).toBeVisible();
  await expect(page.getByText("FULL_TIME")).toHaveCount(0);

  await page.getByRole("link", { name: "Opportunities" }).click();
  await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
  const cards = page.locator("article.opportunity-card");
  const footballCard = cards.filter({ has: page.getByText("FOOTBALL", { exact: true }) });
  const lolCard = cards.filter({ has: page.getByText("LOL", { exact: true }) });
  await expect(footballCard).toHaveCount(1);
  await expect(footballCard.getByText("READ ONLY", { exact: true })).toBeVisible();
  await expect(footballCard.getByText("FT_TOTAL", { exact: true })).toBeVisible();
  await expect(footballCard.getByText("Full time", { exact: true })).toBeVisible();
  await expect(lolCard).toHaveCount(1);
  await expect(lolCard.getByText("READ ONLY", { exact: true })).toBeVisible();
  await expect(lolCard.getByText("SERIES_WINNER", { exact: true })).toBeVisible();
  await expect(lolCard.getByText("Series", { exact: true })).toBeVisible();
  expect(await footballCard.getAttribute("aria-label")).not.toBe(await lolCard.getAttribute("aria-label"));
  await expect(page.getByText("Worst-case profit").first()).toBeVisible();
  await expect(page.getByText("Raw odds (DECIMAL)").first()).toBeVisible();
  await expect(page.getByText("Effective decimal").first()).toBeVisible();
  await expect(page.getByText("Exact stake").first()).toBeVisible();
  await expect(page.getByText("Outcome payout").first()).toBeVisible();
  await expect(page.getByText("Source time").first()).toBeVisible();
  await expect(page.getByLabel(/^Exact stake: /).first()).toHaveAttribute("title", /\d/);
  await expectNoExecutionControls(page);
});

test("operator can inspect mapping evidence without approval controls", async ({ page }) => {
  await page.goto("/mappings");
  await expect(page.getByRole("heading", { name: "Mapping Review" })).toBeVisible();
  const mappings = page.locator("details.mapping-row");
  expect(await mappings.count()).toBeGreaterThan(1);
  for (let index = 0; index < 2; index += 1) {
    const mapping = mappings.nth(index);
    await mapping.locator("summary").click();
    const table = mapping.getByRole("table", { name: /mapping evidence/i });
    await expect(table).toBeVisible();
    for (const heading of ["Gate", "Expected", "Actual", "Result", "Reason"]) {
      await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const evidence = table.locator("tbody tr").first().locator("td");
    await expect(evidence.nth(1)).not.toHaveText("");
    await expect(evidence.nth(2)).not.toHaveText("");
    await expect(evidence.nth(3)).toHaveText(/^(?:PASS|FAIL)$/u);
    await expect(evidence.nth(4)).not.toHaveText("");
  }
  await expectNoExecutionControls(page);
});

test("responsive navigation remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveCSS("position", "fixed");
  await expect(navigation.getByRole("link", { name: "Mapping Review" })).toBeVisible();
  await navigation.getByRole("link", { name: "LoL" }).click();
  await expect(page.getByRole("heading", { name: "LoL" })).toBeVisible();
});

test("operator can configure sessions and cancel a Fabet reset", async ({ page }) => {
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fabet login" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Direct provider session" })).toBeVisible();
  await expect(page.getByLabel("Reachable Fabet URL")).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  await page.getByRole("button", { name: "Reset Fabet session" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset Fabet session?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("disconnection fails closed and the local feed reconnects", async ({ page }) => {
  const connections: Array<{ readonly client: WebSocketRoute; readonly heldServerMessages: string[] }> = [];
  await page.routeWebSocket("**/api/realtime", (socket) => {
    const server = socket.connectToServer();
    const heldServerMessages: string[] = [];
    if (connections.length > 0) {
      server.onMessage((message) => heldServerMessages.push(message.toString()));
    }
    connections.push({ client: socket, heldServerMessages });
  });
  await page.goto("/opportunities");
  await expect(page.getByText("READ ONLY").first()).toBeVisible();

  const firstConnection = connections[0]?.client;
  expect(firstConnection).toBeDefined();
  await firstConnection!.close({ code: 1012, reason: "fixture reconnect test" });
  await expect(page.getByRole("alert").getByRole("heading", { name: "Connection disconnected" })).toBeVisible();
  await expect(page.getByText("READ ONLY")).toHaveCount(0);
  await expectNoExecutionControls(page);

  await expect.poll(() => connections.length, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.getByRole("alert").getByRole("heading", { name: "Validating live connection" })).toBeVisible();
  await expect(page.getByText("READ ONLY")).toHaveCount(0);

  const reconnected = connections[1]!;
  await expect.poll(() => reconnected.heldServerMessages.length).toBeGreaterThan(0);
  for (const message of reconnected.heldServerMessages) reconnected.client.send(message);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("READ ONLY").first()).toBeVisible();
});

test("top profitable exact tickets stay read-only and open the exact row", async ({ page }) => {
  let profitable = false;
  let boosted = false;
  const requests: string[] = [];
  const now = Date.now();
  const account = (id: string, provider: "SABA" | "SBOBET") => ({ id, alias: `${provider} fixture`, provider,
    category: "FOOTBALL", sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "fixture-profile",
    currency: "VND", balance: "500000", balanceAsOfMs: now, capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"], reason: null });
  const accounts = [account("saba-fixture", "SABA"), account("sbobet-fixture", "SBOBET")];
  const catalog = (id: string) => {
    const provider = id === "saba-fixture" ? "SABA" as const : "SBOBET" as const;
    const eventId = `${provider}-event`;
    const marketId = `${provider}-market`;
    const odds = !profitable ? ["1.8", "1.8"] : provider === "SABA"
      ? [boosted ? "2.4" : "2.2", "1.2"] : ["1.2", boosted ? "3.2" : "3"];
    return { dataMode: "LIVE", accountId: id, provider, category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
      events: [{ provider, category: "FOOTBALL", providerEventId: eventId, competition: "Exact Test League",
        seasonStage: null, startAtUtcMs: now + 60_000, participantA: "Alpha United", participantB: "Beta City",
        eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
        fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
      markets: [{ provider, category: "FOOTBALL", providerEventId: eventId, providerMarketId: marketId,
        marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
        settlementProfile: "football-regulation-including-added-time", status: "OPEN" }],
      quotes: (["HOME", "AWAY"] as const).map((selection, index) => ({ provider, category: "FOOTBALL",
        providerEventId: eventId, providerMarketId: marketId, providerSelectionId: `${provider}-${selection}`,
        marketType: "FT_AH", scope: "FULL_TIME", selection, line: "-0.5", rawOdds: odds[index],
        rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: Date.now(),
        receivedMonotonicMs: 1, sequence: 1 })) };
  };
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.route("**/api/accounts", (route) => route.fulfill({ json: { accounts } }));
  await page.route("**/api/accounts/*/refresh", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    await route.fulfill({ json: accounts.find((candidate) => candidate.id === id) });
  });
  await page.route("**/api/catalog/accounts/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    await route.fulfill({ json: catalog(id) });
  });
  await page.route("**/api/preflight/provider", async (route) => {
    const request = route.request().postDataJSON();
    const provider = request.accountId === "saba-fixture" ? "SABA" : "SBOBET";
    const verifiedAtMs = Date.now() - 100;
    const constraint = { currency: "VND", minStake: "30000", maxStake: "500000", stakeStep: "5000",
      balance: "500000", feeType: "NONE", feeRate: null, verifiedAsOfMs: verifiedAtMs, expiresAtMs: verifiedAtMs + 3_000 };
    await route.fulfill({ json: { accountId: request.accountId, provider,
      providerEventId: request.providerEventId, providerMarketId: request.providerMarketId,
      providerSelectionId: request.providerSelectionId, selection: request.selection, line: request.line,
      decimalOdds: request.expectedDecimalOdds, quoteStatus: "OPEN", limitEvidence: {
        currency: constraint.currency, minStake: constraint.minStake, maxStake: constraint.maxStake,
        stakeStep: constraint.stakeStep, balance: constraint.balance, verifiedAsOfMs: verifiedAtMs,
        expiresAtMs: constraint.expiresAtMs },
      constraint, eligible: true, reasons: [] } });
  });

  await page.goto("/lol-live");
  await expect(page.getByRole("heading", { name: "LoL Live Price Gaps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Football Live Price Gaps" })).toHaveCount(0);
  await page.goto("/football-live");
  await expect(page.getByRole("heading", { name: "Football Live Price Gaps" })).toBeVisible();
  await expect(page.getByText("Alpha United vs Beta City", { exact: true })).toBeVisible();
  const row = page.getByRole("row", { name: /Ticket FT_AH/u });
  await expect(row).toHaveClass(/ranked-ticket-row--neutral/u);
  expect(await page.getByRole("row", { name: /Ticket /u }).count()).toBeLessThanOrEqual(5);

  profitable = true;
  await expect.poll(() => requests.filter((path) => path === "/api/preflight/provider").length,
    { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(row).toHaveClass(/ranked-ticket-row--profitable/u, { timeout: 10_000 });
  await expect(row.getByText(/Stake 100,000 VND/u)).toBeVisible();
  await expect(row.getByText(/If Alpha United wins/u)).toBeVisible();
  await expect(row.getByText(/If Beta City wins/u)).toBeVisible();
  await expect(row.getByText(/Guaranteed /u)).toBeVisible();
  await expect(row.getByText(/ROI /u)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const tableDimensions = await page.locator(".ranked-ticket-table-wrap").first().evaluate((element) => ({
    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    parentWidth: element.parentElement?.clientWidth ?? null, viewportWidth: window.innerWidth
  }));
  expect(tableDimensions.scrollWidth).toBeGreaterThan(tableDimensions.clientWidth);
  const firstToast = page.getByRole("button", { name: /Open profitable ticket Alpha United vs Beta City/u });
  await expect(firstToast).toBeVisible();
  await expect(firstToast).toHaveCount(0, { timeout: 7_000 });

  boosted = true;
  const secondToast = page.getByRole("button", { name: /Open profitable ticket Alpha United vs Beta City/u });
  await expect(secondToast).toBeVisible({ timeout: 10_000 });
  await secondToast.click();
  await expect(page).toHaveURL(/ticket=FT_AH%7CFULL_TIME%7C-0\.5/u);
  await expect(page.getByRole("row", { name: /Ticket FT_AH/u })).toHaveClass(/ranked-ticket-row--highlight/u);
  expect(requests.some((path) => path.startsWith("/api/execution") ||
    /\/(?:arm|submit|wager)(?:\/|$)/iu.test(path))).toBe(false);
});
