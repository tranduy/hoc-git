import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerCmdHiddenMarketProbeRoute } from "./cmd-hidden-market-probe.js";

describe("CMD hidden market probe route", () => {
  it("runs a validated event probe only on the local admin host", async () => {
    const probe = vi.fn(async (providerEventId: string) => ({ providerEventId, status: "NO_SAFE_CONTROL" as const }));
    const app = Fastify();
    registerCmdHiddenMarketProbeRoute(app, { probe });

    const response = await app.inject({
      method: "POST",
      url: "/api/catalog/cmd-hidden-probe",
      headers: { host: "127.0.0.1:4310" },
      payload: { providerEventId: "25250586" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providerEventId: "25250586", status: "NO_SAFE_CONTROL" });
    expect(probe).toHaveBeenCalledWith("25250586");
    await app.close();
  });

  it("rejects public hosts and malformed event ids before probing", async () => {
    const probe = vi.fn();
    const app = Fastify();
    registerCmdHiddenMarketProbeRoute(app, { probe });

    expect((await app.inject({ method: "POST", url: "/api/catalog/cmd-hidden-probe",
      headers: { host: "live.babiesbo.uk" }, payload: { providerEventId: "25250586" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/catalog/cmd-hidden-probe",
      headers: { host: "127.0.0.1:4310" }, payload: { providerEventId: "" } })).statusCode).toBe(400);
    expect(probe).not.toHaveBeenCalled();
    await app.close();
  });
});
