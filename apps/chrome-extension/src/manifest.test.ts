import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOBBY_HOSTNAMES } from "./lobby-signatures.js";

interface Manifest {
  version?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{ world?: string; js?: string[]; matches?: string[]; include_globs?: string[] }>;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8")) as Manifest;

/** Chrome's host match syntax, reduced to the part the manifest uses. */
function matches(pattern: string, hostname: string): boolean {
  const host = /^https?:\/\/([^/]+)\//u.exec(pattern)?.[1];
  if (host === undefined) return false;
  if (host.startsWith("*.")) {
    const domain = host.slice(2);
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }
  return hostname === host;
}

describe("extension manifest", () => {
  it("keeps provider tabs active with the Chrome debugger permission", () => {
    expect(manifest.version).toBe("0.2.19");
    expect(manifest.permissions).toContain("debugger");
    expect(manifest.permissions).toContain("sessions");
  });

  it("captures through the debugger alone, never through an injected script", () => {
    // Capture regressing into a content script is what this guards. The only
    // script allowed in a provider page is the inert heartbeat, which reads
    // nothing and exists solely to restart a collected service worker.
    for (const entry of manifest.content_scripts ?? []) {
      expect(entry.js).toEqual(["lobby-heartbeat.js"]);
      expect(entry.world).toBeUndefined();
    }
    expect((manifest.content_scripts ?? []).length).toBeLessThanOrEqual(1);
  });

  it("carries the heartbeat into every lobby, since a book whose tab cannot " +
    "reach the worker can never bring it back", () => {
    const patterns = manifest.content_scripts?.[0]?.matches ?? [];
    const uncovered = LOBBY_HOSTNAMES.filter((hostname) =>
      !patterns.some((pattern) => matches(pattern, hostname)));
    expect(uncovered).toEqual([]);
  });

  it("can reach a lobby that was already open when this version arrived", () => {
    // Injecting into a running tab needs the host granted outright; the
    // declarative match alone does not grant it, and without it the books
    // already open at deployment stay without a heartbeat.
    expect(manifest.permissions).toContain("scripting");
    const granted = manifest.host_permissions ?? [];
    const unreachable = LOBBY_HOSTNAMES.filter((hostname) =>
      !granted.some((pattern) => matches(pattern, hostname)));
    expect(unreachable).toEqual([]);
  });
});
