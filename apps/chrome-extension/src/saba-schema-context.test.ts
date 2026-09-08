import { describe, expect, it } from "vitest";
import { SabaSchemaContextCache } from "./saba-schema-context.js";

const frame = (bridgeId: string, rows: readonly unknown[], revision: unknown = "revision-secret"): string =>
  `42${JSON.stringify(["m", bridgeId, rows, revision])}`;

const catalogFields = ["type", "matchid", "oddsid", "leagueid"] as const;

describe("SabaSchemaContextCache", () => {
  it("exports only a reduced logical channel and catalog field schema, never row values or revision", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [
      ["c", "c2", { private: "channel-secret" }],
      ["f", 0, catalogFields],
      [0, "reset"], [0, "m", 1, "private-team-value"], [0, "done"]
    ]));

    expect(cache.exportContexts()).toEqual([{
      bridgeId: "b1", rows: [["c", "c2"], ["f", 0, catalogFields]], revision: null
    }]);
    const exported = JSON.stringify(cache.exportContexts());
    expect(exported).not.toContain("channel-secret");
    expect(exported).not.toContain("private-team-value");
    expect(exported).not.toContain("revision-secret");
    expect(cache.size).toBe(1);
  });

  it("resolves sparse numeric aliases with the decoder offset-and-index algorithm", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b3", [["c", "c4"], ["f", 0, ["type", "matchid", "oddsid"]]]));
    cache.remember(frame("b3", [["c", "c4"], ["f", 4, [4, 6]]]));

    expect(cache.exportContexts()).toEqual([{
      bridgeId: "b3", rows: [
        ["c", "c4"], ["f", 0, ["type", "matchid", "oddsid"]],
        ["f", 4, ["type", "matchid"]]
      ], revision: null
    }]);
  });

  it("keeps schema across fieldless reset and done frames", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, catalogFields]]));
    const before = cache.exportContexts();

    cache.remember(frame("b1", [[0, "reset"], [0, "done"]], "later-revision"));

    expect(cache.exportContexts()).toEqual(before);
  });

  it("invalidates a known bridge when a fresh explicit channel has no known schema", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, catalogFields]]));
    expect(cache.hasBridgeContext("b1")).toBe(true);

    cache.remember(frame("b1", [["c", "c3"], [0, "reset"], [0, "done"]]));

    expect(cache.hasBridgeContext("b1")).toBe(false);
    expect(cache.exportContexts()).toEqual([]);
  });

  it("infers a fresh fieldless bridge only from one unique known catalog-table shape", () => {
    const unique = new SabaSchemaContextCache();
    unique.remember(frame("b1", [["c", "c2"], ["f", 0, ["type", "matchid"]]]));
    unique.remember(frame("b2", [[0, "reset"], [0, "done"]]));
    expect(unique.hasBridgeContext("b2")).toBe(true);
    expect(unique.exportContexts().find(({ bridgeId }) => bridgeId === "b2")?.rows[0])
      .toEqual(["c", "c2"]);

    const ambiguous = new SabaSchemaContextCache();
    ambiguous.remember(frame("b1", [["c", "c2"], ["f", 0, ["type", "matchid"]]]));
    ambiguous.remember(frame("b3", [["c", "c4"], ["f", 0, ["type", "oddsid"]]]));
    ambiguous.remember(frame("b2", [[0, "reset"], [0, "done"]]));
    expect(ambiguous.hasBridgeContext("b2")).toBe(false);

    ambiguous.remember(frame("b1", [["c", "c9"], [0, "reset"]]));
    expect(ambiguous.hasBridgeContext("b1")).toBe(false);
  });

  it("uses the exact bridge id as the bounded fallback logical channel when c is absent", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b9", [["f", 0, ["type", "oddsid"]]]));

    expect(cache.exportContexts()).toEqual([{
      bridgeId: "b9", rows: [["c", "b9"], ["f", 0, ["type", "oddsid"]]], revision: null
    }]);
  });

  it("allows a fresh valid field table to replace a conflicting table on the same channel", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, ["type", "matchid"]]]));
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, ["type", "oddsid"]]]));

    expect(cache.exportContexts()).toEqual([{
      bridgeId: "b1", rows: [["c", "c2"], ["f", 0, ["type", "oddsid"]]], revision: null
    }]);
  });

  it.each([
    ["unknown alias", frame("b1", [["c", "c2"], ["f", 4, [99]]])],
    ["unsafe bridge id", frame("bridge-secret", [["c", "c2"], ["f", 0, catalogFields]])],
    ["overlong bridge id", frame(`b${"1".repeat(33)}`, [["c", "c2"], ["f", 0, catalogFields]])],
    ["unsafe channel id", frame("b1", [["c", "private-channel"], ["f", 0, catalogFields]])],
    ["unsafe field name", frame("b1", [["c", "c2"], ["f", 0, ["type", "match-id"]]])],
    ["malformed row", frame("b1", [["c", "c2"], null, ["f", 0, catalogFields]])],
    ["column overflow", frame("b1", [["c", "c2"], ["f", 512, ["type"]]])],
    ["body overflow", `42${" ".repeat(4 * 1024 * 1024)}`]
  ])("rejects %s atomically", (_label, invalid) => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, catalogFields]]));
    const before = cache.exportContexts();

    cache.remember(invalid);

    expect(cache.exportContexts()).toEqual(before);
  });

  it("bounds retained bridge and logical table contexts at 64", () => {
    const cache = new SabaSchemaContextCache();
    for (let index = 1; index <= 64; index += 1) {
      cache.remember(frame(`b${index}`, [["c", `c${index}`], ["f", 0, ["type", "matchid"]]]));
    }
    expect(cache.size).toBe(64);

    cache.remember(frame("b65", [["c", "c65"], ["f", 0, ["type", "oddsid"]]]));

    expect(cache.size).toBe(64);
    expect(cache.exportContexts().some(({ bridgeId }) => bridgeId === "b65")).toBe(false);
  });

  it("accepts 65,536 raw rows but rejects a larger frame without mutation", () => {
    const cache = new SabaSchemaContextCache();
    const maximumRows = [["c", "c2"], ["f", 0, catalogFields],
      ...Array.from({ length: 65_534 }, () => [0])];
    cache.remember(frame("b1", maximumRows));
    expect(cache.hasBridgeContext("b1")).toBe(true);
    const before = cache.exportContexts();

    cache.remember(frame("b1", [...maximumRows, [0]]));

    expect(cache.exportContexts()).toEqual(before);
  });

  it("rejects more than 512 f rows and more than 512 restored context rows atomically", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, catalogFields]]));
    const before = cache.exportContexts();
    cache.remember(frame("b1", [["c", "c2"],
      ...Array.from({ length: 513 }, () => ["f", 0, ["type", "matchid"]])]));
    expect(cache.exportContexts()).toEqual(before);

    cache.restore([{ bridgeId: "b2", revision: null, rows: [["c", "c3"],
      ...Array.from({ length: 512 }, () => ["f", 0, ["type", "matchid"]])] }]);
    expect(cache.exportContexts()).toEqual(before);
  });

  it("restores only strict sanitized schema contexts and rejects the whole invalid batch atomically", () => {
    const source = new SabaSchemaContextCache();
    source.remember(frame("b1", [["c", "c2"], ["f", 0, catalogFields]]));
    const restored = new SabaSchemaContextCache();
    restored.restore(source.exportContexts());
    expect(restored.exportContexts()).toEqual(source.exportContexts());

    const before = restored.exportContexts();
    restored.restore([
      { bridgeId: "b3", rows: [["c", "c4"], ["f", 0, ["type", "leagueid"]]], revision: null },
      { bridgeId: "b5", rows: [["c", "c6"], [0, "private-value"]], revision: null }
    ]);
    expect(restored.exportContexts()).toEqual(before);
    restored.restore([{ bridgeId: "b7", rows: [["c", "c8"], ["f", 0, [4]]], revision: null }]);
    expect(restored.exportContexts()).toEqual(before);
    restored.restore([{ bridgeId: "b7", rows: [["c", "c8"], ["f", 0, catalogFields]],
      revision: "not-null" }]);
    expect(restored.exportContexts()).toEqual(before);
  });

  it("ignores a well-formed unrelated non-catalog schema without retaining its data", () => {
    const cache = new SabaSchemaContextCache();
    cache.remember(frame("b1", [["c", "c2"], ["f", 0, ["token", "balance"]],
      [0, "account-secret", 1, 999_999]]));

    expect(cache.size).toBe(0);
    expect(cache.exportContexts()).toEqual([]);
  });
});
