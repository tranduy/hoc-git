import { join, resolve } from "node:path";
import { chromium, type Page, type Response } from "playwright";
import { DpapiProtector } from "../sessions/dpapi-protector.js";
import { SecretVault } from "../sessions/secret-vault.js";
import {
  clickSafeStructuralCategories,
  collectSafeControlShapes,
  findApiOriginFromPage,
  findAccessTokenFrame
} from "./browser-protocol-inspector.js";
import {
  inspectionControlLabel,
  extractReadOnlyApiPathTemplates,
  attachWebSocketProtocolObserver,
  observedTransportForResourceType,
  observeProtocolMetadata,
  protocolObservationSummary,
  profileProbeIsSafe,
  profileProbeAvailability,
  extractTrustedApiOrigin,
  selectProfileApiOrigin,
  structuralBodyHash,
  structuralBodyShape,
  structuralWebSocketFrameShape,
  type ProtocolObservation
} from "./protocol-inspector.js";

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

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const sessionId = argumentsList.find((argument) => !argument.startsWith("--"));
  const summaryOnly = argumentsList.includes("--summary");
  const scriptEndpointsOnly = argumentsList.includes("--script-endpoints");
  const webSocketShapesOnly = argumentsList.includes("--websocket-shapes");
  const controlShapesOnly = argumentsList.includes("--control-shapes");
  const profileShapesOnly = argumentsList.includes("--profile-shapes");
  const localAppData = process.env.LOCALAPPDATA;
  if (sessionId === undefined || !/^[A-Za-z0-9._-]{1,128}$/u.test(sessionId) || !localAppData) {
    throw new Error("Usage: npm run inspect:launch -- <redacted-session-id>");
  }
  const root = resolve(join(localAppData, "tool-chenh", ".auth"));
  const vault = new SecretVault({ directory: join(root, "vault"), protector: new DpapiProtector() });
  const record = await vault.load(`session-${sessionId}`);
  if (!inspectable(record)) throw new Error("Inspectable launch session not found");
  const context = await chromium.launchPersistentContext(join(root, "browser-profiles", "fabet-inspector"), {
    headless: false, acceptDownloads: false
  });
  const observations = new Map<string, ProtocolObservation & { readonly bodyShape?: unknown }>();
  const scriptEndpoints = new Set<string>();
  const webSocketShapes = new Set<string>();
  const controlShapes = new Set<string>();
  const profileShapes: unknown[] = [];
  let apiBackendOrigin: string | null = null;
  let observedSettingsOrigin: string | null = null;
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
    if (observation.pathTemplate === "/api/Config/GetSettings") {
      try { observedSettingsOrigin = `${new URL(response.url()).origin}/api`; } catch { observedSettingsOrigin = null; }
    }
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
        if (observation.pathTemplate === "/api/Config/GetSettings") {
          apiBackendOrigin = extractTrustedApiOrigin(body);
        }
        bodyShapeHash = structuralBodyHash(body);
        bodyShape = structuralBodyShape(body);
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
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(record.secret.value, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (profileShapesOnly) {
      await page.waitForTimeout(5_000);
      await Promise.allSettled([...pending]);
      const tokenFrame = await findAccessTokenFrame(page);
      const accessToken = tokenFrame === null
        ? null
        : await tokenFrame.evaluate(() => sessionStorage.getItem("at")).catch(() => null);
      const hasAccessToken = typeof accessToken === "string" && accessToken.length > 0;
      if (apiBackendOrigin === null && tokenFrame !== null) {
        apiBackendOrigin = await findApiOriginFromPage(page);
      }
      const baseUrl = selectProfileApiOrigin({
        declaredOrigin: apiBackendOrigin,
        observedSettingsOrigin
      });
      const availability = profileProbeAvailability({ hasApiOrigin: baseUrl !== null, hasAccessToken });
      if (availability !== "READY") profileShapes.push({ availability });
      const probes = [
        { endpoint: "/Customer/Balance", method: "POST" },
        { endpoint: "/CashMember/GetUserInfo", method: "GET" }
      ] as const;
      if (availability === "READY" && baseUrl !== null && accessToken !== null && probes.every((probe) => profileProbeIsSafe({
        baseUrl, ...probe, seenOrigins: [baseUrl]
      }))) {
        const responses: Array<{ endpoint: string; method: string; status: number | null; body: unknown }> = [];
        for (const request of probes) {
          try {
            const response = await context.request.fetch(`${baseUrl}${request.endpoint}`, {
              method: request.method,
              headers: { Accept: "application/json", Authorization: `bearer ${accessToken}` },
              failOnStatusCode: false,
              timeout: 10_000
            });
            let body: unknown = null;
            try { body = await response.json(); } catch { body = null; }
            responses.push({ endpoint: request.endpoint, method: request.method, status: response.status(), body });
          } catch {
            responses.push({ endpoint: request.endpoint, method: request.method, status: null, body: null });
          }
        }
        for (const response of responses) profileShapes.push({
          endpoint: response.endpoint,
          method: response.method,
          status: response.status,
          bodyShapeHash: structuralBodyHash(response.body),
          bodyShape: structuralBodyShape(response.body)
        });
      }
    }
    if (controlShapesOnly) {
      await page.waitForTimeout(5_000);
      for (const shape of await collectSafeControlShapes(page)) controlShapes.add(JSON.stringify(shape));
    }
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
    await clickSafeStructuralCategories(page).catch(() => undefined);
    await page.waitForTimeout(15_000);
    await Promise.allSettled([...pending]);
    const output = profileShapesOnly
      ? profileShapes
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
