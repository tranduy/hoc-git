import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReplayArguments } from "./replay-capture.mjs";

test("parses the replay contract and semantic assertion threshold", () => {
  assert.deepEqual(parseReplayArguments([
    "--capture", "capture.jsonl", "--provider", "cmd", "--assert-semantic-changes", "3"
  ]), { capturePath: "capture.jsonl", provider: "CMD", assertSemanticChanges: 3 });
  assert.throws(() => parseReplayArguments(["--capture", "capture.jsonl", "--provider", "UNKNOWN"]),
    /USAGE/u);
});
