import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerBetHistoryRoute } from "./bet-history.js";

describe("bet history route", () => {
  it("returns own history and clamps an invalid limit", async () => {
    const app = Fastify();
    const limits: number[] = [];
    registerBetHistoryRoute(app, { list: async (limit) => { limits.push(limit); return { storageState: "READY", records: [] }; } });
    expect((await app.inject({ method: "GET", url: "/api/bet-history?limit=20" })).json())
      .toEqual({ storageState: "READY", records: [] });
    await app.inject({ method: "GET", url: "/api/bet-history?limit=bad" });
    expect(limits).toEqual([20, 100]);
  });

  it("returns an unavailable empty view when reading storage fails", async () => {
    const app = Fastify();
    registerBetHistoryRoute(app, { list: async () => { throw new Error("private path"); } });
    const response = await app.inject({ method: "GET", url: "/api/bet-history" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ storageState: "UNAVAILABLE", records: [] });
  });
});
