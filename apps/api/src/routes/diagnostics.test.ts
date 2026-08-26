import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { PipelineDiagnostic } from "../diagnostics/pipeline-telemetry.js";
import { registerDiagnosticRoutes } from "./diagnostics.js";

const diagnostic: PipelineDiagnostic = {
  accountId: "catalog-source:CMD:FOOTBALL", lobby: "CMD", nowMs: 1,
  firstFailingHop: "HOP1_TAB", hops: [
    { hop: "HOP1_TAB", ok: false, detail: { sourceId: null, tabId: null } },
    ...(["HOP2_ATTACH", "HOP3_ENVELOPE", "HOP4_ADAPTER", "HOP5_AUTHORITY", "HOP6_FEED",
      "HOP7_CATALOG", "HOP8_SEMANTIC"] as const).map((hop) => ({ hop, ok: false, detail: {} }))
  ]
};

describe("pipeline diagnostic routes", () => {
  it("serves all accounts and one account without invoking a mutating operation", async () => {
    const app = Fastify();
    const list = vi.fn(async () => [diagnostic]);
    const get = vi.fn(async (accountId: string) => accountId === diagnostic.accountId ? diagnostic : null);
    registerDiagnosticRoutes(app, { list, get });

    const all = await app.inject({ method: "GET", url: "/api/diag/pipeline" });
    const one = await app.inject({ method: "GET", url: `/api/diag/pipeline/${diagnostic.accountId}` });
    const missing = await app.inject({ method: "GET", url: "/api/diag/pipeline/unknown" });

    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({ accounts: [diagnostic] });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toEqual(diagnostic);
    expect(missing.statusCode).toBe(404);
    expect(list).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("fails closed without exposing internal errors", async () => {
    const app = Fastify();
    registerDiagnosticRoutes(app, {
      list: async () => { throw new Error("secret-bearing-error"); },
      get: async () => { throw new Error("secret-bearing-error"); }
    });

    const response = await app.inject({ method: "GET", url: "/api/diag/pipeline" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "PIPELINE_DIAGNOSTICS_UNAVAILABLE" });
    expect(response.body).not.toContain("secret-bearing-error");
    await app.close();
  });
});
