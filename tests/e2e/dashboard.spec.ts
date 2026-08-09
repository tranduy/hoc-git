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
