import { describe, expect, it } from "vitest";
import { splitUtf8Text, utf8ByteLength } from "./utf8-length.js";

const encoder = new TextEncoder();
const samples = ["", "ascii only", "tiếng Việt có dấu", "emoji 😀🎉 and ¥€", "߿ࠀ￿",
  "lone surrogate \ud83d end", "x".repeat(10_000) + "😀".repeat(100)];

describe("utf8ByteLength", () => {
  it("matches TextEncoder for ASCII, multi-byte, surrogate pairs and lone surrogates", () => {
    for (const sample of samples) expect(utf8ByteLength(sample)).toBe(encoder.encode(sample).byteLength);
  });
});

describe("splitUtf8Text", () => {
  it("returns the input unchanged when it fits", () => {
    expect(splitUtf8Text("tiếng Việt", 1_000)).toEqual(["tiếng Việt"]);
    expect(splitUtf8Text("", 10)).toEqual([""]);
  });

  it("produces fragments within the byte limit that concatenate to the original without splitting a pair", () => {
    for (const sample of samples) {
      for (const maxBytes of [4, 7, 16, 1_000]) {
        const fragments = splitUtf8Text(sample, maxBytes);
        expect(fragments.join("")).toBe(sample);
        let offset = 0;
        for (const fragment of fragments) {
          expect(encoder.encode(fragment).byteLength).toBeLessThanOrEqual(maxBytes);
          offset += fragment.length;
          const last = fragment.charCodeAt(fragment.length - 1);
          const next = sample.charCodeAt(offset);
          const splitsPair = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
          expect(splitsPair).toBe(false);
        }
      }
    }
  });

  it("fails closed when a single character cannot fit", () => {
    expect(() => splitUtf8Text("😀", 3)).toThrow("BRIDGE_PAYLOAD_INVALID");
  });
});
