import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkBodyAssembler } from "./network-body-assembler.js";

function envelope(index: number, count = 2, fragment = index === 0 ? "{\"StatusCode\":" : "100}"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8, sequence: index,
    observedAtMs: 1_000 + index, receivedMonotonicMs: 50 + index, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1,
      snapshotId: "network-8-request-abcdef", chunkIndex: index, chunkCount: count,
      bodyEncoding: "UTF8", bodyFragment: fragment }) }
  };
}

describe("NetworkBodyAssembler", () => {
  it("returns an HTTP envelope only after every ordered chunk arrives", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0))).toBeNull();
    expect(assembler.ingest(envelope(1))).toMatchObject({
      lobby: "IM", transport: "HTTP_RESPONSE", payload: { encoding: "UTF8", body: "{\"StatusCode\":100}" }
    });
  });

  it("fails closed when chunk metadata conflicts", () => {
    const assembler = new NetworkBodyAssembler();
    expect(assembler.ingest(envelope(0))).toBeNull();
    expect(assembler.ingest({ ...envelope(1), request: { ...envelope(1).request, pathnameClass: "/wrong" } })).toBeNull();
    expect(assembler.ingest(envelope(1))).toBeNull();
  });
});
