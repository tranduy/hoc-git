import { join, resolve } from "node:path";
import { chromium, type Page, type Response } from "playwright";
import { DpapiProtector } from "../sessions/dpapi-protector.js";
import { SecretVault } from "../sessions/secret-vault.js";
import {
  clickSafeStructuralCategories,
  clickSafeStructuralCategory,
  collectCmdCatalogShapes,
  collectCmdCatalogNavigation,
  extractCmdCatalogRecords,
  findCmdCatalogPage,
  collectSafeControlShapes,
  findProviderRuntimeFrame,
  inspectExactCmdTicket,
  probeReadOnlyProfileThroughRuntime,
  readProviderAccountStore
} from "./browser-protocol-inspector.js";
import {
  inspectionControlLabel,
  extractReadOnlyApiPathTemplates,
  attachWebSocketProtocolObserver,
  observedTransportForResourceType,
  observeProtocolMetadata,
  protocolObservationSummary,
  structuralBodyHash,
  structuralBodyShape,
  structuralBodyShapeAtDepth,
  structuralWebSocketFrameShape,
  type ProtocolObservation
} from "./protocol-inspector.js";
import { extractImCatalogRecords } from "./im/im-catalog-source.js";

interface InspectableSessionRecord {
  readonly secret: { readonly kind: "LAUNCH_URL"; readonly value: string };
}

function inspectable(value: unknown): value is InspectableSessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const secret = (value as Record<string, unknown>).secret;
  return typeof secret === "object" && secret !== null &&
    (secret as Record<string, unknown>).kind === "LAUNCH_URL" &&
    typeof (secret as Record<string, unknown>).value === "string";
}

function key(observation: ProtocolObservation & { readonly bodyShapeHash?: string }): string {
  return JSON.stringify(observation);
}

function safeAccountStoreReadiness(value: unknown): Record<string, string> {
  const root = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const bal = typeof root.Bal === "object" && root.Bal !== null && !Array.isArray(root.Bal)
    ? root.Bal as Record<string, unknown> : {};
  const balanceText = typeof bal.BCredit === "string" || typeof bal.BCredit === "number"
    ? String(bal.BCredit).trim() : "";
  const currencyText = typeof (bal.Curr ?? root.Curr) === "string" ? String(bal.Curr ?? root.Curr).trim() : "";
  const labels = [root.DisplayUserName, root.LicUserName, root.Name, root.Nick]
    .filter((item): item is string => typeof item === "string");
  return {
    balance: balanceText.length === 0 ? "EMPTY" : /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balanceText)
      ? "VALID_DECIMAL" : /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(balanceText) ? "VALID_GROUPED_DECIMAL" : "OTHER",
    currency: currencyText.length === 0 ? "EMPTY" : /^[A-Za-z]{3,8}$/u.test(currencyText) ? "VALID_CODE" : "OTHER",
    label: labels.some((item) => item.trim().length > 0) ? "PRESENT" : "EMPTY"
  };
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const sessionId = argumentsList.find((argument) => !argument.startsWith("--"));
  const summaryOnly = argumentsList.includes("--summary");
  const scriptEndpointsOnly = argumentsList.includes("--script-endpoints");
  const webSocketShapesOnly = argumentsList.includes("--websocket-shapes");
  const controlShapesOnly = argumentsList.includes("--control-shapes");
  const profileShapesOnly = argumentsList.includes("--profile-shapes");
  const ticketShapeOnly = argumentsList.includes("--ticket-shape");
  const catalogShapesOnly = argumentsList.includes("--catalog-shapes");
  const catalogRecordsOnly = argumentsList.includes("--catalog-records");
  const catalogNavigationOnly = argumentsList.includes("--catalog-navigation");
  const imCatalogShapeOnly = argumentsList.includes("--im-catalog-shape");
  const imCatalogRecordsOnly = argumentsList.includes("--im-catalog-records");
  const localAppData = process.env.LOCALAPPDATA;
  if (sessionId === undefined || !/^[A-Za-z0-9._-]{1,128}$/u.test(sessionId) || !localAppData) {
    throw new Error("Usage: npm run inspect:launch -- <redacted-session-id>");
  }
  const root = resolve(join(localAppData, "tool-chenh", ".auth"));
  const vault = new SecretVault({ directory: join(root, "vault"), protector: new DpapiProtector() });
  const record = await vault.load(`session-${sessionId}`);
  if (!inspectable(record)) throw new Error("Inspectable launch session not found");
  const context = await chromium.launchPersistentContext(join(root, "browser-profiles", "fabet-inspector"), {
    headless: true, acceptDownloads: false
  });
  const observations = new Map<string, ProtocolObservation & { readonly bodyShape?: unknown }>();
  const scriptEndpoints = new Set<string>();
  const webSocketShapes = new Set<string>();
  const controlShapes = new Set<string>();
  const profileShapes: unknown[] = [];
  const catalogRecords: unknown[] = [];
  const imCatalogRecords: unknown[] = [];
  let catalogNavigation: unknown[] = [];
  const pending = new Set<Promise<void>>();
  const recordResponse = async (response: Response): Promise<void> => {
    const resourceType = response.request().resourceType();
    const transport = observedTransportForResourceType(resourceType);
    if (transport === null) return;
    const observation = observeProtocolMetadata({
      url: response.url(), method: response.request().method(), transport,
      status: response.status(), contentType: response.headers()["content-type"] ?? null
    });
    if (observation === null) return;
    if ((imCatalogShapeOnly || imCatalogRecordsOnly) && observation.pathTemplate !== "/api/GetIndexMatchV2") return;
    if (scriptEndpointsOnly && observation.transport === "SCRIPT") {
      try {
        const source = (await response.text()).slice(0, 10_000_000);
        for (const endpoint of extractReadOnlyApiPathTemplates(source)) scriptEndpoints.add(endpoint);
      } catch { /* A failed bundle read contributes no endpoint. */ }
    }
    let bodyShapeHash: string | undefined;
    let bodyShape: unknown;
    if (observation.contentType === "application/json") {
      try {
        const body: unknown = await response.json();
        if (imCatalogRecordsOnly) imCatalogRecords.push(...extractImCatalogRecords(body).slice(0, 40));
        bodyShapeHash = structuralBodyHash(body);
        bodyShape = imCatalogShapeOnly ? structuralBodyShapeAtDepth(body, 16) : structuralBodyShape(body);
      } catch { bodyShapeHash = undefined; }
    }
    const safe = bodyShapeHash === undefined ? observation : { ...observation, bodyShapeHash, bodyShape };
    observations.set(key(safe), safe);
  };
  context.on("response", (response) => {
    const operation = recordResponse(response).finally(() => pending.delete(operation));
    pending.add(operation);
  });
  const attachPage = (page: Page): void => {
    attachWebSocketProtocolObserver(page, (observation) => observations.set(key(observation), observation));
    if (webSocketShapesOnly) page.on("websocket", (socket) => {
      const recordFrame = (direction: "IN" | "OUT", payload: unknown): void => {
        webSocketShapes.add(JSON.stringify({ direction, shape: structuralWebSocketFrameShape(payload) }));
      };
      socket.on("framereceived", (frame) => recordFrame("IN", frame.payload));
      socket.on("framesent", (frame) => recordFrame("OUT", frame.payload));
    });
  };
  for (const page of context.pages()) attachPage(page);
  context.on("page", attachPage);
  try {
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(record.secret.value, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (catalogRecordsOnly || catalogShapesOnly || catalogNavigationOnly || controlShapesOnly || ticketShapeOnly) {
      await page.waitForTimeout(5_000);
      page = await findCmdCatalogPage(context.pages()) ?? page;
    }
    if (profileShapesOnly) {
      await page.waitForTimeout(5_000);
      await Promise.allSettled([...pending]);
      const runtimeFrame = await findProviderRuntimeFrame(page);
      const probes = [
        { endpoint: "/Customer/Balance", method: "POST", timeoutMs: 10_000 },
        { endpoint: "/CashMember/GetUserInfo", method: "GET", timeoutMs: 10_000 }
      ] as const;
      if (runtimeFrame === null) {
        profileShapes.push({ availability: "NO_PROVIDER_RUNTIME" });
      } else {
        const accountStore = await readProviderAccountStore(runtimeFrame);
        profileShapes.push({
          source: "ACCOUNT_STORE",
          readiness: safeAccountStoreReadiness(accountStore),
          bodyShapeHash: structuralBodyHash(accountStore),
          bodyShape: structuralBodyShape(accountStore)
        });
        for (const probe of probes) {
          const response = await probeReadOnlyProfileThroughRuntime(runtimeFrame, probe);
          profileShapes.push({
            endpoint: probe.endpoint,
            method: probe.method,
            status: response.status,
            httpStatus: response.httpStatus,
            bodyShapeHash: structuralBodyHash(response.body),
            bodyShape: structuralBodyShape(response.body)
          });
        }
      }
    }
    if (controlShapesOnly) {
      await page.waitForTimeout(5_000);
      for (const shape of await collectSafeControlShapes(page)) controlShapes.add(JSON.stringify(shape));
    }
    if (catalogNavigationOnly) {
      await clickSafeStructuralCategory(page, "1", 2_000).catch(() => false);
      catalogNavigation = [...await collectCmdCatalogNavigation(page)];
    }
    if (!catalogRecordsOnly && !catalogNavigationOnly && !ticketShapeOnly) {
      const controls = page.locator("a, button, [role='button'], [onclick], [aria-label], [title]");
      const controlCount = Math.min(await controls.count(), 250);
      for (let index = 0, clicked = 0; index < controlCount && clicked < 12; index += 1) {
        const control = controls.nth(index);
        const label = inspectionControlLabel([
          await control.innerText().catch(() => ""),
          await control.getAttribute("aria-label").catch(() => null) ?? "",
          await control.getAttribute("title").catch(() => null) ?? ""
        ]);
        if (label === null || !(await control.isVisible().catch(() => false))) continue;
        await control.click({ timeout: 2_000 }).catch(() => undefined);
        clicked += 1;
        await page.waitForTimeout(1_000);
      }
    }
    if (catalogRecordsOnly) {
      for (const sportId of ["1", "43"] as const) {
        if (await clickSafeStructuralCategory(page, sportId, 15_000).catch(() => false)) {
          catalogRecords.push(...await extractCmdCatalogRecords(page, 3, sportId));
        }
      }
    } else if (!ticketShapeOnly) {
      await clickSafeStructuralCategories(page).catch(() => undefined);
    }
    let ticketShape: unknown = null;
    if (ticketShapeOnly) {
      await clickSafeStructuralCategory(page, "1", 2_000).catch(() => false);
      const records = await extractCmdCatalogRecords(page, 100, "1", ["1"]);
      outer: for (const record of records) {
        for (const group of record.groups) {
          if (group.betTypeIds.length !== 1 || group.betTypeIds[0] !== "1" || group.odds.length !== 2) continue;
          const ids = [...new Set(group.odds.map((odd) => odd.marketOddsId))];
          const lines = group.odds.map((odd) => odd.lineText).filter((line): line is string => line !== undefined && line !== null);
          if (ids.length !== 1 || ids[0] === undefined || !lines.some((line) => /^-?\d+\.5$/u.test(line.trim()))) continue;
          ticketShape = { matchId: record.matchId, marketOddsId: ids[0], selection: "HOME",
            evidence: await inspectExactCmdTicket(page, { matchId: record.matchId, marketOddsId: ids[0], selection: "HOME" }) };
          break outer;
        }
      }
    }
    await page.waitForTimeout(15_000);
    await Promise.allSettled([...pending]);
    const output = ticketShapeOnly
      ? ticketShape
      : imCatalogRecordsOnly
      ? imCatalogRecords
      : profileShapesOnly
      ? profileShapes
      : catalogNavigationOnly
        ? catalogNavigation
      : catalogRecordsOnly
        ? catalogRecords
      : catalogShapesOnly
        ? await collectCmdCatalogShapes(page)
      : controlShapesOnly
        ? [...controlShapes].sort().map((value) => JSON.parse(value) as unknown)
        : webSocketShapesOnly
        ? [...webSocketShapes].sort().map((value) => JSON.parse(value) as unknown)
        : scriptEndpointsOnly
        ? [...scriptEndpoints].sort()
        : summaryOnly
        ? [...observations.values()].map(protocolObservationSummary)
        : [...observations.values()];
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await context.close();
  }
}

void main().catch(() => {
  process.stderr.write("Launch inspection failed without exposing session material.\n");
  process.exitCode = 1;
});
