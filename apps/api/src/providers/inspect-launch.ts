import { join, resolve } from "node:path";
import { chromium, type Response } from "playwright";
import { DpapiProtector } from "../sessions/dpapi-protector.js";
import { SecretVault } from "../sessions/secret-vault.js";
import { inspectionControlIsSafe, observeProtocolMetadata, structuralBodyHash, structuralBodyShape, type ProtocolObservation } from "./protocol-inspector.js";

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
  const sessionId = process.argv[2];
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
  const pending = new Set<Promise<void>>();
  const recordResponse = async (response: Response): Promise<void> => {
    const resourceType = response.request().resourceType();
    const transport = resourceType === "xhr" ? "XHR" : resourceType === "fetch" ? "FETCH" :
      resourceType === "document" ? "NAVIGATION" : null;
    if (transport === null) return;
    const observation = observeProtocolMetadata({
      url: response.url(), method: response.request().method(), transport,
      status: response.status(), contentType: response.headers()["content-type"] ?? null
    });
    if (observation === null) return;
    let bodyShapeHash: string | undefined;
    let bodyShape: unknown;
    if (observation.contentType === "application/json") {
      try {
        const body: unknown = await response.json();
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
  context.on("page", (page) => page.on("websocket", (socket) => {
    const observation = observeProtocolMetadata({
      url: socket.url(), method: "GET", transport: "WEBSOCKET", status: 101, contentType: null
    });
    if (observation !== null) observations.set(key(observation), observation);
  }));
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(record.secret.value, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const controls = page.locator("a, button, [role='button'], [onclick]");
    const controlCount = Math.min(await controls.count(), 250);
    for (let index = 0, clicked = 0; index < controlCount && clicked < 12; index += 1) {
      const control = controls.nth(index);
      const label = await control.innerText().catch(() => "");
      if (!inspectionControlIsSafe(label) || !(await control.isVisible().catch(() => false))) continue;
      await control.click({ timeout: 2_000 }).catch(() => undefined);
      clicked += 1;
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(15_000);
    await Promise.allSettled([...pending]);
    process.stdout.write(`${JSON.stringify([...observations.values()], null, 2)}\n`);
  } finally {
    await context.close();
  }
}

void main().catch(() => {
  process.stderr.write("Launch inspection failed without exposing session material.\n");
  process.exitCode = 1;
});
