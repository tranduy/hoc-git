import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("keeps provider tabs active with the Chrome debugger permission", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8")) as {
      version?: string;
      permissions?: string[];
      content_scripts?: Array<{ world?: string; js?: string[]; matches?: string[]; include_globs?: string[] }>;
    };
    expect(manifest.version).toBe("0.2.18");
    expect(manifest.permissions).toContain("debugger");
    expect(manifest.permissions).toContain("sessions");
    expect(manifest.content_scripts).toBeUndefined();
  });
});
