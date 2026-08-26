import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { parseRecordArguments, sanitizeBridgeEnvelope } from "./record-capture.mjs";

test("parses bounded recorder arguments", () => {
  assert.deepEqual(parseRecordArguments(["--provider", "cmd", "--duration-ms", "2000",
    "--wait-for-socket-ms", "3000", "--cdp", "http://127.0.0.1:9222", "--output", "capture.jsonl"], {}), {
    provider: "CMD", durationMs: 2_000, waitForSocketMs: 3_000,
    cdpUrl: "http://127.0.0.1:9222", output: resolve("capture.jsonl")
  });
});

test("redacts sensitive fields before writing a bridge envelope", () => {
  const sanitized = sanitizeBridgeEnvelope({ version: 1, kind: "NETWORK", lobby: "CMD",
    sourceId: "chrome:CMD:7", tabId: 7, sequence: 1, observedAtMs: 1,
    transport: "HTTP_RESPONSE", request: {}, payload: { encoding: "UTF8",
      body: JSON.stringify({ events: [1], token: "secret", nested: { cookie: "secret", price: "0.91" } }) } });
  assert.deepEqual(JSON.parse(sanitized.payload.body), { events: [1], nested: { price: "0.91" } });
});
