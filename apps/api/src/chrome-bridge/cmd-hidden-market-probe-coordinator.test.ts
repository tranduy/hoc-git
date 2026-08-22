import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { CmdHiddenMarketProbeCoordinator } from "./cmd-hidden-market-probe-coordinator.js";

function resultEnvelope(requestId: string): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, sequence: 2,
    observedAtMs: 1_000, receivedMonotonicMs: 100, transport: "DOM_SNAPSHOT",
    request: { hostname: "cmd.invalid", pathnameClass: "/__fieldline_cmd_hidden_probe__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ requestId, providerEventId: "25250586",
      status: "EXPANDED", beforeMarketIds: ["visible:1"], afterMarketIds: ["hidden:1", "visible:1"],
      clickedControlCount: 1, clickedControls: ["Details"], candidateControls: ["button.detail Details"],
      marketStructures: ["div.Dbox_b2 bt=1 visible=1 label=1/1.5 odds=2"],
      visibleEventIds: ["25250586"], stablePasses: 2,
      httpEvidence: [], websocketEvidence: [] }) } };
}

describe("CmdHiddenMarketProbeCoordinator", () => {
  it("correlates the exact bridge result and ignores a different request", async () => {
    const sent: string[] = [];
    const coordinator = new CmdHiddenMarketProbeCoordinator({
      listSources: () => [{ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeCmdHiddenMarkets: (_sourceId, requestId) => { sent.push(requestId); return true; } },
      idFactory: () => "probe-1",
      timeoutMs: 1_000
    });
    const result = coordinator.probe("25250586");
    coordinator.ingest(resultEnvelope("other"));
    coordinator.ingest(resultEnvelope(sent[0]!));

    await expect(result).resolves.toMatchObject({ status: "EXPANDED", afterMarketIds: ["hidden:1", "visible:1"] });
  });

  it("fails quickly when no live CMD source can accept the command", async () => {
    const coordinator = new CmdHiddenMarketProbeCoordinator({
      listSources: () => [], controlPlane: { probeCmdHiddenMarkets: vi.fn(() => false) }, timeoutMs: 250
    });
    await expect(coordinator.probe("25250586")).rejects.toThrow("CMD_SOURCE_NOT_LIVE");
  });
});
