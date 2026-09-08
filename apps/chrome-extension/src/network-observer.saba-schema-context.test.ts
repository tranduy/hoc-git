import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver, type PersistedSabaWsSnapshots } from "./network-observer.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
const storedBody = '42["m","b1",[["c","c2"],["f",0,["type","matchid","oddsid"]],[0,"reset"],[0,"m",1,55],[0,"done"]],"old-revision"]';
const delta = '42["m","b1",[[0,"o",1,55,2,99]],"fresh-1"]';
const freshBaseline = '42["m","b1",[["c","c2"],[0,"reset"],[0,"m",1,55],[0,"done"]],"fresh-2"]';

function harness(documentMarker = "1000") {
  const forwarded: ChromeBridgeEnvelope[] = [];
  const saved: PersistedSabaWsSnapshots[] = [];
  let rejectContext = false;
  const snapshot: PersistedSabaWsSnapshots = { version: 1, sourceId: source.sourceId,
    documentMarker: "1000", partitions: [{ partition: "1:b1", frames: [{
      url: "wss://sports.example/socket.io/?private=never-forward", body: storedBody,
      streamId: "1", observedAtMs: 100, receivedMonotonicMs: 1
    }] }] };
  const observer = new NetworkObserver({ observerSessionId: "schema-worker", now: () => 10_000,
    monotonicNow: () => 50, loadSabaWsSnapshots: async () => snapshot,
    saveSabaWsSnapshots: async (value) => { saved.push(value); },
    sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        return { result: { value: documentMarker } };
      }
      if (String(params?.expression).includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "today-tab-selected" } } };
      }
      return {};
    }), forward: async (value) => {
      if (rejectContext && value.request.pathnameClass === "/__fieldline_saba_schema_context__") {
        rejectContext = false;
        throw new Error("TEST_FORWARD_FAILED");
      }
      forwarded.push(value);
    } });
  const receive = (body: string) => observer.handleEvent(source, "Network.webSocketFrameReceived", {
    requestId: "existing-provider", response: { opcode: 1, payloadData: body }
  });
  const contexts = () => forwarded.filter(({ request }) =>
    request.pathnameClass === "/__fieldline_saba_schema_context__");
  return { observer, receive, forwarded, contexts, saved, rejectNextContext: () => { rejectContext = true; } };
}

describe("SABA same-document schema bootstrap", () => {
  it("emits only bounded schema after current traffic without making restored history a fresh baseline", async () => {
    const h = harness();
    await h.observer.refreshCatalog(source);
    await h.receive(delta);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(false);
    expect(h.contexts()).toHaveLength(1);
    const context = h.contexts()[0]!;
    expect(context).toMatchObject({ transport: "TAB_STATE", observedAtMs: 10_000,
      receivedMonotonicMs: 50, request: { streamId: "1", resourceType: "Diagnostic" } });
    expect(context.request.replayed).not.toBe(true);
    expect(JSON.parse(context.payload.body)).toEqual({ kind: "SABA_SCHEMA_CONTEXT", bridgeId: "b1",
      rows: [["c", "c2"], ["f", 0, ["type", "matchid", "oddsid"]]], revision: null });
    expect(context.payload.body).not.toContain("old-revision");
    expect(JSON.stringify(h.forwarded)).not.toContain("never-forward");
    await h.receive(delta);
    expect(h.contexts()).toHaveLength(1);
    await h.receive(freshBaseline);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
    await vi.waitFor(() => expect(h.saved.length).toBeGreaterThan(0));
    expect(h.saved.at(-1)).toHaveProperty("schemaContexts");
  });

  it("does not admit a fieldless baseline without any validated schema", async () => {
    const h = harness("different-document");
    await h.observer.refreshCatalog(source);
    await h.receive(freshBaseline);
    expect(h.contexts()).toHaveLength(0);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(false);
  });

  it("retries schema forwarding on the next fresh frame after a transient bridge rejection", async () => {
    const h = harness();
    await h.observer.refreshCatalog(source);
    h.rejectNextContext();
    await expect(h.receive(delta)).rejects.toThrow("TEST_FORWARD_FAILED");
    expect(h.contexts()).toHaveLength(0);
    await h.receive(delta);
    expect(h.contexts()).toHaveLength(1);
  });

  it("resends only schema for a new API bridge epoch on the same current socket", async () => {
    const h = harness();
    await h.observer.refreshCatalog(source);
    await h.receive(delta);
    const firstEpoch = h.contexts()[0]!.sourceEpoch;
    await h.receive(freshBaseline);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(false);
    await h.receive(delta);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(false);
    expect(h.contexts()).toHaveLength(2);
    expect(h.contexts()[1]!.sourceEpoch).not.toBe(firstEpoch);
    expect(h.contexts()[1]!.request.streamId).toBe("1");
    expect(h.contexts()[1]!.payload.body).toBe(h.contexts()[0]!.payload.body);
    await h.receive(freshBaseline);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
  });

  it("clears schema on source retirement and never relabels it for the replacement", async () => {
    const h = harness();
    await h.observer.refreshCatalog(source);
    h.observer.beginSourceEpoch(source.sourceId);
    await h.receive(delta);
    expect(h.contexts()).toHaveLength(0);
    expect(h.observer.hasCompleteSabaBaseline(source.sourceId)).toBe(false);
  });
});
