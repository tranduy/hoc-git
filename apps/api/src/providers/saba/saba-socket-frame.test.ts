import { describe, expect, it } from "vitest";
import { parseSabaSocketFrame } from "./saba-socket-frame.js";

describe("parseSabaSocketFrame", () => {
  it("parses the exact Socket.IO m-event envelope", () => {
    expect(parseSabaSocketFrame('42["m","b5",[["f",0,["type"]],[0,"done"]],17]')).toEqual({
      bridgeId: "b5",
      rows: [["f", 0, ["type"]], [0, "done"]],
      revision: "17"
    });
  });

  it("ignores transport and unrelated application events", () => {
    expect(parseSabaSocketFrame("2")).toBeNull();
    expect(parseSabaSocketFrame("3")).toBeNull();
    expect(parseSabaSocketFrame('40{"sid":"public-value"}')).toBeNull();
    expect(parseSabaSocketFrame('42["init",{"bridge":"b1"}]')).toBeNull();
  });

  it("fails closed for malformed m-event envelopes", () => {
    expect(() => parseSabaSocketFrame('42["m","wrong",[]]')).toThrow("SABA_PUSH_FRAME_INVALID");
    expect(() => parseSabaSocketFrame('42["m","b1"]')).toThrow("SABA_PUSH_FRAME_INVALID");
    expect(() => parseSabaSocketFrame('42["m","b1",{},1]')).toThrow("SABA_PUSH_FRAME_INVALID");
    expect(() => parseSabaSocketFrame('42["m","b1",[]')).toThrow("SABA_PUSH_FRAME_INVALID");
  });

  it("rejects an oversized frame before JSON parsing", () => {
    expect(() => parseSabaSocketFrame(`42${" ".repeat(2 * 1024 * 1024)}`))
      .toThrow("SABA_PUSH_FRAME_INVALID");
  });
});

