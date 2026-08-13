import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";
import { DomainDiscovery } from "../sessions/domain-discovery.js";
import { SecretVault } from "../sessions/secret-vault.js";
import { SessionManager } from "../sessions/session-manager.js";
import { TrustedDomainStore } from "../sessions/trusted-domain-store.js";
import type { SecretProtector } from "../sessions/types.js";
import { SessionValidatorRegistry } from "../sessions/validators.js";

const directories: string[] = [];
const apps: Array<ReturnType<typeof buildApp>> = [];
const protector: SecretProtector = {
  protect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x77),
  unprotect: async (value) => Uint8Array.from(value, (byte) => byte ^ 0x77)
};

async function createServices() {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-routes-"));
  directories.push(directory);
  const vault = new SecretVault({ directory, protector });
  const trustStore = new TrustedDomainStore({ vault, clock: { nowMs: () => 100 } });
  const manager = new SessionManager({
    vault,
    validators: new SessionValidatorRegistry([]),
    clock: { nowMs: () => 100 },
    idFactory: () => "manual-1",
    fabetDriver: {
      login: async () => undefined,
      captureLobbyLaunches: async () => [],
      resetProfile: async () => undefined
    },
    resetFabetState: async () => trustStore.resetFabetHosts()
  });
  const discovery = new DomainDiscovery({
    trustStore,
    fetch: async (input) => String(input) === "https://fabet.com/"
      ? new Response(null, { status: 302, headers: { location: "https://fabet.party/" } })
      : new Response("ok", { status: 200 })
  });
  return { manager, discovery, trustStore };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("session routes", () => {
  it("registers and resets TK88 Chrome independently without exposing profile material", async () => {
    const services = await createServices();
    const app = buildApp(createFixtureRuntime(100), { sessionServices: services });
    apps.push(app);
    await app.ready();
    const headers = { origin: "http://127.0.0.1:4311" };

    const configured = await app.inject({
      method: "POST", url: "/api/sessions/tk88/configure", headers,
      payload: { trustedHostname: "tk88.example" }
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({
      id: "tk88", provider: "TK88", source: "TK88_CHROME", trustedHostname: "tk88.example",
      state: "ACTION_REQUIRED", secretConfigured: true
    });
    expect(configured.body).not.toContain("managed-profile");
    expect(configured.headers["cache-control"]).toBe("no-store");

    expect((await app.inject({
      method: "POST", url: "/api/sessions/tk88/reset", headers,
      payload: { confirmation: "NO" }
    })).statusCode).toBe(400);
    expect((await services.manager.listStatuses()).sessions).toHaveLength(1);

    expect((await app.inject({
      method: "POST", url: "/api/sessions/fabet/reset", headers,
      payload: { confirmation: "RESET_FABET" }
    })).statusCode).toBe(200);
    expect((await services.manager.listStatuses()).sessions).toHaveLength(1);

    expect((await app.inject({
      method: "POST", url: "/api/sessions/tk88/reset", headers,
      payload: { confirmation: "RESET_TK88" }
    })).statusCode).toBe(200);
    expect(await services.manager.listStatuses()).toEqual({ sessions: [] });
  });

  it("discovers, trusts, configures, and resets Fabet without returning secrets", async () => {
    const services = await createServices();
    const app = buildApp(createFixtureRuntime(100), { sessionServices: services });
    apps.push(app);
    await app.ready();
    const headers = { origin: "http://127.0.0.1:4311" };

    const discovered = await app.inject({
      method: "POST", url: "/api/sessions/fabet/discover", headers,
      payload: { entryUrl: "https://fabet.com/" }
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json()).toMatchObject({ finalHostname: "fabet.party", trusted: false });

    expect((await app.inject({
      method: "POST", url: "/api/sessions/fabet/trust", headers,
      payload: { hostname: "fabet.party" }
    })).statusCode).toBe(200);

    const configured = await app.inject({
      method: "POST", url: "/api/sessions/fabet/configure", headers,
      payload: {
        entryUrl: "https://fabet.party/",
        trustedHostname: "fabet.party",
        username: "route-user-canary",
        password: "route-password-canary"
      }
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({ provider: "FABET", state: "ACTIVE", secretConfigured: true });
    expect(configured.body).not.toMatch(/route-user-canary|route-password-canary/u);
    expect(configured.headers["cache-control"]).toBe("no-store");

    const cancelled = await app.inject({
      method: "POST", url: "/api/sessions/fabet/reset", headers,
      payload: { confirmation: "NO" }
    });
    expect(cancelled.statusCode).toBe(400);
    expect((await services.manager.listStatuses()).sessions).toHaveLength(1);

    const reset = await app.inject({
      method: "POST", url: "/api/sessions/fabet/reset", headers,
      payload: { confirmation: "RESET_FABET" }
    });
    expect(reset.statusCode).toBe(200);
    expect(await services.manager.listStatuses()).toEqual({ sessions: [] });
    expect(await services.trustStore.list()).toEqual([]);
  });

  it("accepts direct session material but fails closed without a provider validator", async () => {
    const services = await createServices();
    const app = buildApp(createFixtureRuntime(100), { sessionServices: services });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/manual",
      headers: { origin: "http://127.0.0.1:4311" },
      payload: { provider: "SABA", kind: "TOKEN", secret: "manual-route-secret-canary" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: "SABA", state: "ACTION_REQUIRED", reason: "SCHEMA_CHANGED" });
    expect(response.body).not.toContain("manual-route-secret-canary");
  });

  it("rejects unknown fields, secret query routes, oversized bodies, and foreign origins", async () => {
    const services = await createServices();
    const app = buildApp(createFixtureRuntime(100), { sessionServices: services });
    apps.push(app);
    const origin = { origin: "http://127.0.0.1:4311" };

    expect((await app.inject({
      method: "POST", url: "/api/sessions/manual", headers: origin,
      payload: { provider: "SABA", kind: "TOKEN", secret: "x", extra: true }
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: "GET", url: "/api/sessions/manual?token=query-secret-canary", headers: origin
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "POST", url: "/api/sessions/manual", headers: { origin: "https://evil.example" },
      payload: { provider: "SABA", kind: "TOKEN", secret: "x" }
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "POST", url: "/api/sessions/manual", headers: origin,
      payload: { provider: "SABA", kind: "TOKEN", secret: "x".repeat(40_000) }
    })).statusCode).toBe(413);
  });
});
