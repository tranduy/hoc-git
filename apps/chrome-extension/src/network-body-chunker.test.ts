import { describe, expect, it } from "vitest";
import { ChromeNetworkBodyChunkSchema } from "@tool-chenh/contracts";
import { splitNetworkBodyText } from "./network-body-chunker.js";

describe("network body wire sizing", () => {
  it.each(["\"", "\\", "\b\t\n\f\r", "\u0000\u001f", "\ud800x\udfff", "€😀Việt"])(
    "preserves escaped and Unicode text within raw and serialized limits (%s)", sample => {
      const body = sample.repeat(100_000);
      const fragments = splitNetworkBodyText(body);
      expect(fragments.join("")).toBe(body);
      for (const [chunkIndex, bodyFragment] of fragments.entries()) {
        const wrapper = { schemaVersion: 1, snapshotId: "wire-sizing-canary", chunkIndex,
          chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment };
        expect(ChromeNetworkBodyChunkSchema.safeParse(wrapper).success).toBe(true);
        const encoded = JSON.stringify({ payload: { encoding: "UTF8", body: JSON.stringify(wrapper) } });
        expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(256 * 1024);
      }
    });

  it("supports a full 24 MiB body even when escaping requires over 256 fragments", () => {
    const body = "\\".repeat(24 * 1024 * 1024);
    const fragments = splitNetworkBodyText(body);
    expect(fragments.length).toBeGreaterThan(256);
    expect(fragments.length).toBeLessThanOrEqual(1_024);
    expect(fragments.join("")).toBe(body);
  });
});
