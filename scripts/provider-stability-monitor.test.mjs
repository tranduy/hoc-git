import assert from "node:assert/strict";
import test from "node:test";
import { classify, summarize, updateHistory } from "./provider-stability-monitor.mjs";

function diagnostic(overrides = {}) {
  return {
    firstFailingHop: overrides.firstFailingHop ?? null,
    hops: [
      { hop: "HOP6_FEED", detail: { state: overrides.feedState ?? "LIVE" } },
      { hop: "HOP7_CATALOG", detail: { snapshotState: overrides.snapshotState ?? "FRESH",
        events: overrides.events ?? 10 } },
      { hop: "HOP8_SEMANTIC", detail: { quoteChanges60s: overrides.quoteChanges60s ?? 5 } }
    ]
  };
}

test("a book counts as usable only when its session is active and its catalog fresh", () => {
  assert.equal(classify(diagnostic(), { sessionState: "ACTIVE" }).usable, true);
  assert.equal(classify(diagnostic(), { sessionState: "ACTION_REQUIRED" }).usable, false);
  assert.equal(classify(diagnostic({ snapshotState: "STALE" }), { sessionState: "ACTIVE" }).usable, false);
  assert.equal(classify(diagnostic(), undefined).usable, false);
});

test("a missing diagnostic is reported rather than throwing", () => {
  const sample = classify(undefined, undefined);
  assert.equal(sample.usable, false);
  assert.equal(sample.events, 0);
  assert.equal(sample.quoteChanges60s, 0);
});

test("flaps count transitions, not states", () => {
  const history = new Map();
  const sample = (usable) => ({ provider: "SABA", usable, quoteChanges60s: usable ? 3 : 0 });

  assert.equal(updateHistory(history, sample(true)), false, "first sample cannot be a flap");
  assert.equal(updateHistory(history, sample(true)), false);
  assert.equal(updateHistory(history, sample(false)), true);
  assert.equal(updateHistory(history, sample(false)), false);
  assert.equal(updateHistory(history, sample(true)), true);

  assert.deepEqual(summarize(history), [
    { provider: "SABA", upPercent: 60, changingPercent: 60, flaps: 2, samples: 5 }
  ]);
});

test("a book that is up but never changing is separated from one that is changing", () => {
  const history = new Map();
  updateHistory(history, { provider: "BTI", usable: true, quoteChanges60s: 0 });
  updateHistory(history, { provider: "BTI", usable: true, quoteChanges60s: 0 });

  assert.deepEqual(summarize(history), [
    { provider: "BTI", upPercent: 100, changingPercent: 0, flaps: 0, samples: 2 }
  ]);
});
