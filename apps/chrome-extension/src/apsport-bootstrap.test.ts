import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { apsportBootstrapFailure } from "./apsport-bootstrap.js";

async function bootstrapPage(input: { url: string; language?: string; resource?: string;
  hints?: readonly string[]; rejectedCommand?: { method: string; message: string } }) {
  const collect = vi.fn(async () => undefined);
  const forwarded: unknown[] = [];
  const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
    if (method === input.rejectedCommand?.method) throw Error(input.rejectedCommand.message);
    if (method === "Page.getFrameTree") return { frameTree: { frame: {
      id: "ap-frame", loaderId: "ap-loader", url: input.url
    } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 91 };
    if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldlineApsportBootstrap")) {
      const evaluate = new Function("location", "document", "performance", "Intl", "URL",
        `return ${String(params?.expression)}`);
      return { result: { value: evaluate({ href: input.url }, {
        documentElement: { lang: input.language ?? "" },
        querySelectorAll: () => (input.hints ?? []).map((href) => ({ href }))
      }, { getEntriesByType: () => input.resource ? [{ name: input.resource }] : [] },
      { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Asia/Bangkok" }) }) }, URL) } };
    }
    return {};
  });
  const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => {
    forwarded.push(JSON.parse(envelope.payload.body));
  },
    collectApsportCatalog: collect, observerSessionId: "ap-bootstrap-test" });
  await observer.refreshCatalog({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 });
  await observer.heartbeat({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 },
    new URL(input.url).hostname);
  return { collect, sendCommand, forwarded };
}

describe("APSPORT page bootstrap evidence", () => {
  it.each(["pacific.agenate.com", "pacific.racern.com", "sport.asportsb.com"])(
    "can reuse the existing authenticated API resource on registered AP page %s", async (host) => {
      const { collect, sendCommand } = await bootstrapPage({ url: `https://${host}/?lng=vi`,
        resource: "https://spbui.agenate.com/be-ui/pac/api/v3/events" });
      expect(collect).toHaveBeenCalledOnce();
      expect(collect).toHaveBeenCalledWith(expect.objectContaining({ template: {
        origin: "https://spbui.agenate.com", headers: { "content-type": "application/json",
          lng: "vi", tz: "Asia/Bangkok" }, body: { mno: 2, si: 1, mg: 1 }
      } }));
      expect(sendCommand.mock.calls.some((call) => call[1] === "Page.reload")).toBe(false);
    });

  it("uses the current document language when the AP page no longer has launch query parameters", async () => {
    const { collect } = await bootstrapPage({ url: "https://pacific.agenate.com/sports",
      language: "vi", hints: ["https://spbui.agenate.com"] });
    expect(collect).toHaveBeenCalledOnce();
  });

  it("can rebuild in the API origin itself after the resource timing buffer is empty", async () => {
    const { collect } = await bootstrapPage({ url: "https://spbui.agenate.com/?lng=vi" });
    expect(collect).toHaveBeenCalledOnce();
  });

  it.each([
    { url: "https://unrelated.example/?lng=vi", resource: "https://spbui.agenate.com/be-ui/pac/api/v3/events" },
    { url: "https://pacific.agenate.com/?lng=vi", resource: "https://spbui.agenate.com.attacker.test/be-ui/pac/api/v3/events" },
    { url: "https://pacific.agenate.com/?lng=vi", resource: "https://spbui.agenate.com/unrelated" },
    { url: "https://pacific.agenate.com/?lng=vi" },
    { url: "https://pacific.agenate.com/", hints: ["https://spbui.agenate.com"] },
    { url: "https://pacific.agenate.com/?lng=../../vi", language: "vi", hints: ["https://spbui.agenate.com"] }
  ])("does not invent an origin or language from missing or invalid evidence: $url", async (input) => {
    const { collect } = await bootstrapPage(input);
    expect(collect).not.toHaveBeenCalled();
  });

  it.each([
    { url: "https://unrelated.example/?lng=vi", reason: "APSPORT_BOOTSTRAP_PAGE_UNSUPPORTED" },
    { url: "https://pacific.agenate.com/", reason: "APSPORT_BOOTSTRAP_LANGUAGE_MISSING" },
    { url: "https://pacific.agenate.com/?lng=vi", reason: "APSPORT_BOOTSTRAP_ORIGIN_MISSING" }
  ])("publishes the actual failed bootstrap gate $reason without exposing page data", async ({ url, reason }) => {
    const { forwarded } = await bootstrapPage({ url });
    const diagnostic = forwarded.find((value) => typeof value === "object" && value !== null &&
      "kind" in value && value.kind === "WS_ATTACH") as { catalogShape: string };
    expect(diagnostic.catalogShape).toContain(reason);
    expect(diagnostic.catalogShape).not.toContain(url);
  });

  it("does not let an unrelated shell-frame error hide the useful provider-frame failure", () => {
    expect(apsportBootstrapFailure({ reason: "APSPORT_BOOTSTRAP_ORIGIN_MISSING" },
      { reason: "APSPORT_BOOTSTRAP_PAGE_UNSUPPORTED" }))
      .toEqual({ reason: "APSPORT_BOOTSTRAP_ORIGIN_MISSING" });
    expect(apsportBootstrapFailure({ reason: "APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE" },
      { reason: "secret-page-text" }))
      .toEqual({ reason: "APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE" });
  });

  it.each([
    { method: "Page.getFrameTree", message: "Debugger is not attached to the tab with id: 7",
      expected: "FRAME_TREE:DETACHED", counts: "contexts=0 frames=0 worlds=0" },
    { method: "Page.createIsolatedWorld", message: "No frame for given id found",
      expected: "WORLD_CREATE:FRAME_GONE", counts: "contexts=0 frames=1 worlds=0" },
    { method: "Runtime.evaluate", message: "frame-command-timeout",
      expected: "WORLD_EVALUATE:TIMEOUT", counts: "contexts=0 frames=1 worlds=1" }
  ])("publishes the failing Chrome command stage $expected", async ({ method, message, expected, counts }) => {
    const { forwarded } = await bootstrapPage({ url: "https://pacific.agenate.com/?lng=vi",
      rejectedCommand: { method, message } });
    const diagnostic = forwarded.find((value) => typeof value === "object" && value !== null &&
      "kind" in value && value.kind === "WS_ATTACH") as { catalogShape: string };
    expect(diagnostic.catalogShape).toContain(expected);
    expect(diagnostic.catalogShape).toContain(counts);
    expect(diagnostic.catalogShape).not.toContain(message);
  });

  it("runs the safe browser and renderer probes only after frame-tree timeout", async () => {
    const timedOut = await bootstrapPage({ url: "https://pacific.agenate.com/?lng=vi",
      rejectedCommand: { method: "Page.getFrameTree", message: "frame-command-timeout" } });
    expect(timedOut.sendCommand).toHaveBeenCalledWith(7, "Target.getTargetInfo");
    expect(timedOut.sendCommand).toHaveBeenCalledWith(7, "Runtime.getIsolateId");
    expect(JSON.stringify(timedOut.forwarded)).toContain("probe[target=NO_RESULT");
    const detached = await bootstrapPage({ url: "https://pacific.agenate.com/?lng=vi",
      rejectedCommand: { method: "Page.getFrameTree", message: "Debugger is not attached" } });
    expect(detached.sendCommand.mock.calls.some((call) => call[1] === "Target.getTargetInfo")).toBe(false);
  });
});
