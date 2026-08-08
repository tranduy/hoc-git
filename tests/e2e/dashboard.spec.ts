import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

async function expectNoExecutionControls(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /arm|bet|place|submit|wager/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /arm|bet|place|submit|wager/i })).toHaveCount(0);
  await expect(page.locator('input[type="password"], input[name*="credential" i], input[name*="token" i]')).toHaveCount(0);
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
  await expect(page.getByText("READ ONLY").first()).toBeVisible();
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
  const mapping = page.locator("details.mapping-row").first();
  await mapping.locator("summary").click();
  await expect(mapping.getByRole("table", { name: /mapping evidence/i })).toBeVisible();
  await expect(mapping.getByRole("columnheader", { name: "Gate" })).toBeVisible();
  await expect(mapping.getByText(/PASS|FAIL/).first()).toBeVisible();
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
  const connections: WebSocketRoute[] = [];
  await page.routeWebSocket("**/api/realtime", (socket) => {
    connections.push(socket);
    socket.connectToServer();
  });
  await page.goto("/opportunities");
  await expect(page.getByText("READ ONLY").first()).toBeVisible();

  const firstConnection = connections[0];
  expect(firstConnection).toBeDefined();
  await firstConnection!.close({ code: 1012, reason: "fixture reconnect test" });
  await expect(page.getByRole("alert").getByRole("heading", { name: "Connection disconnected" })).toBeVisible();
  await expect(page.getByText("READ ONLY")).toHaveCount(0);
  await expectNoExecutionControls(page);

  await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
  expect(connections.length).toBeGreaterThan(1);
  await expect(page.getByText("READ ONLY").first()).toBeVisible();
});
