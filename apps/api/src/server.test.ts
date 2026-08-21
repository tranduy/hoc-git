import { describe, expect, it } from "vitest";
import { localWarpAuthEnabled } from "./server.js";

describe("localWarpAuthEnabled", () => {
  it("keeps WARP disabled unless the operator explicitly enables it", () => {
    expect(localWarpAuthEnabled(undefined)).toBe(false);
    expect(localWarpAuthEnabled("0")).toBe(false);
    expect(localWarpAuthEnabled("1")).toBe(true);
  });
});
