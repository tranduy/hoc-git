import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-early-native-20260908.json", import.meta.url), "utf8"));
const main = (t = fixture.main.t) => ({ t, a: true, data: [], today: [fixture.main.row], f: [] });
const early = (rows = [fixture.early.row], t = fixture.early.t) => ({ t, a: true, today: rows, f: [] });
function envelope(body: unknown, sequence: number, fc = 1, overrides = {}): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "cmd-native:1", sequence, observedAtMs: fixture.early.observedAtMs + sequence,
    receivedMonotonicMs: 1000 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      method: "GET", resourceType: "XHR", providerFunctionCode: fc, cmdFullScope: true,
      observerRequestId: `cmd-observer:request:${sequence}`, requestFrameKey: "cmd-frame",
      requestDocumentKey: "cmd-document", reconcileCutoffSequence: sequence - 1, ...overrides },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}
const catalog = (updates: ReturnType<CmdHttpCatalogAdapter["decode"]>) => updates.at(-1)?.value as ObservedProviderCatalog;

describe("CMD authenticated Early partition", () => {
  it("keeps a newer matching Today row when an older Early request finishes later", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const newer = [...fixture.main.row]; newer[42] = 0.6;
    adapter.decode(envelope({ ...main(fixture.main.t + 1), today: [newer] }, 3));
    const update = adapter.decode(envelope(early([fixture.main.row]), 4, 6, { reconcileCutoffSequence: 1 }));
    expect(catalog(update).quotes.find(q => q.providerEventId === "25403104" && q.marketType === "FT_TOTAL" && q.selection === "OVER"))
      .toMatchObject({ rawOdds: "0.6", sequence: 3, receivedMonotonicMs: 1003 });
  });

  it("keeps a newer matching Early row when an older Today request finishes after migration", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const newer = [...fixture.early.row]; newer[42] = 0.61;
    adapter.decode(envelope(early([newer]), 3, 6));
    const update = adapter.decode(envelope({ ...main(fixture.main.t + 1), today: [fixture.early.row] }, 4, 1,
      { reconcileCutoffSequence: 1 }));
    expect(catalog(update).quotes.find(q => q.providerEventId === "1099097157" && q.marketType === "FT_TOTAL" && q.selection === "OVER"))
      .toMatchObject({ rawOdds: "0.61", sequence: 3, receivedMonotonicMs: 1003 });
  });

  it("retains actual fc6 Early prices and clocks after a newer fc1 Today baseline", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const update = adapter.decode(envelope(early(), 2, 6));
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP" });
    const acquired = catalog(update);
    expect(acquired.events.map(row => row.providerEventId)).toEqual(expect.arrayContaining(["25403104", "1099097157"]));
    const originalQuotes = acquired.quotes.filter(row => row.providerEventId === "1099097157");
    expect(originalQuotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketType: "FT_TOTAL", line: "2", selection: "OVER", rawOdds: "0.93" }),
      expect.objectContaining({ marketType: "FT_TOTAL", line: "2", selection: "UNDER", rawOdds: "0.93" })
    ]));
    const next = catalog(adapter.decode(envelope(main(fixture.main.t + 1), 3)));
    expect(next.quotes.filter(row => row.providerEventId === "1099097157")).toEqual(originalQuotes);
    expect(next.events).toHaveLength(2);
  });

  it("requires exact request scope and current document before admitting Early authority", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    for (const overrides of [{ cmdFullScope: undefined }, { requestDocumentKey: "other-document" },
      { reconcileCutoffSequence: undefined }]) {
      expect(adapter.decode(envelope(early(), 2, 6, overrides))).toEqual([]);
    }
    expect(catalog(adapter.decode(envelope(main(fixture.main.t + 1), 3))).events).toHaveLength(1);
  });

  it("retires only Early-owned events on an authenticated empty Early response", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    adapter.decode(envelope(early(), 2, 6));
    const update = adapter.decode(envelope(early([], fixture.early.t + 1), 3, 6));
    expect(update[0]).toMatchObject({ evidenceMode: "DELTA", authoritativeRemovedEventIds: ["1099097157"] });
    expect(catalog(update).events.map(row => row.providerEventId)).toEqual(["25403104"]);
  });
});
