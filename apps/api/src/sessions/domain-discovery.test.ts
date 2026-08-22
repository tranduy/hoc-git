import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DomainDiscovery } from "./domain-discovery.js";
import { SecretVault } from "./secret-vault.js";
import { TrustedDomainStore } from "./trusted-domain-store.js";
import type { SecretProtector } from "./types.js";

const directories: string[] = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x33),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x33)
};

async function createTrustStore(nowMs = 10): Promise<TrustedDomainStore> {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-domain-"));
  directories.push(directory);
  return new TrustedDomainStore({
    vault: new SecretVault({ directory, protector }),
    clock: { nowMs: () => nowMs }
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("DomainDiscovery", () => {
  it("follows redirects without forwarding credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const store = await createTrustStore();
    const discovery = new DomainDiscovery({
      trustStore: store,
      fetch: async (input, init = {}) => {
        calls.push({ url: String(input), init });
        return calls.length === 1
          ? new Response(null, { status: 302, headers: { location: "https://fabet.party/login" } })
          : new Response("ok", { status: 200 });
      }
    });

    const result = await discovery.discover("https://fabet.com/");

    expect(result).toEqual({
      requestedUrl: "https://fabet.com/",
      finalUrl: "https://fabet.party/login",
      finalHostname: "fabet.party",
      trusted: false
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit" });
      expect(JSON.stringify(call.init)).not.toMatch(/authorization|cookie|password|token/u);
    }
  });

  it("reports exact persisted trust and rejects sibling hosts", async () => {
    const store = await createTrustStore(25);
    await store.approve("fabet.party");
    expect(await store.isTrusted("fabet.party")).toBe(true);
    expect(await store.isTrusted("login.fabet.party")).toBe(false);
    expect(await store.list()).toEqual([{ hostname: "fabet.party", approvedAtMs: 25 }]);
  });

  it("persists exact trust across store reconstruction and can reset it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tool-chenh-domain-"));
    directories.push(directory);
    const vault = new SecretVault({ directory, protector });
    await new TrustedDomainStore({ vault, clock: { nowMs: () => 50 } }).approve("fabet.party");
    const second = new TrustedDomainStore({ vault, clock: { nowMs: () => 60 } });
    expect(await second.isTrusted("fabet.party")).toBe(true);
    await second.resetFabetHosts();
    expect(await second.list()).toEqual([]);
  });

  it.each([
    "http://fabet.com/",
    "https://user:pass@fabet.com/",
    "file:///fabet.com"
  ])("rejects unsafe entry URL %s", async (entryUrl) => {
    const discovery = new DomainDiscovery({ trustStore: await createTrustStore(), fetch });
    await expect(discovery.discover(entryUrl)).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it("rejects a redirect downgrade", async () => {
    const discovery = new DomainDiscovery({
      trustStore: await createTrustStore(),
      fetch: async () => new Response(null, { status: 302, headers: { location: "http://fabet.party/" } })
    });
    await expect(discovery.discover("https://fabet.com/")).rejects.toMatchObject({ code: "INSECURE_REDIRECT" });
  });

  it("caps redirect chains and redacts network failures", async () => {
    let count = 0;
    const discovery = new DomainDiscovery({
      trustStore: await createTrustStore(),
      fetch: async () => {
        count += 1;
        return new Response(null, { status: 302, headers: { location: `https://hop${count}.example/` } });
      }
    });
    await expect(discovery.discover("https://fabet.com/")).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    const failed = new DomainDiscovery({
      trustStore: await createTrustStore(),
      fetch: async () => { throw new Error("network-secret-canary"); }
    });
    await expect(failed.discover("https://fabet.com/")).rejects.toMatchObject({ code: "UNREACHABLE" });
    await expect(failed.discover("https://fabet.com/")).rejects.not.toThrow(/network-secret-canary/u);
  });
});
