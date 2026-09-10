import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { request, type IncomingHttpHeaders } from "node:http";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { installCatalogCompression } from "./catalog-compression.js";
import { streamCatalogJson } from "./catalog-json-stream.js";

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const catalog = { revision: "revision-1", quotes: Array.from({ length: 4_096 }, (_, index) => ({
  id: `quote-${index}`, providerEventId: "event-1", decimalOdds: 1.95, observedAtMs: 123_456
})) };
const expected = JSON.stringify(catalog);

async function setup(onCreate?: (app: FastifyInstance) => void) {
  const app = Fastify();
  apps.push(app);
  app.route({ method: ["GET", "POST"], url: "/api/catalog/accounts/:accountId", handler: (req, reply) => {
    reply.header("etag", '"revision-1-view"').header("x-catalog-revision", "revision-1");
    if (req.headers["if-none-match"] === '"revision-1-view"') return reply.code(304).send();
    return reply.type("application/json; charset=utf-8").send(Readable.from(streamCatalogJson(catalog)));
  } });
  app.get("/api/health", (_req, reply) => reply.type("application/json").send(expected));
  onCreate?.(app);
  // Installation also works on an already listening server, without replacing its handlers.
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  installCatalogCompression(app.server);
  return { app, address };
}

function read(address: string, path: string, headers: Record<string, string>, method = "GET") {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request(`${address}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("catalog HTTP compression", () => {
  it.each(["GET", "POST"])("compresses the complete streamed %s catalog without changing its revision or rows", async (method) => {
    const { address } = await setup();
    const response = await read(address, "/api/catalog/accounts/BTI?nativeDetail=counts", { "accept-encoding": "gzip" }, method);
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.headers.vary).toContain("Accept-Encoding");
    expect(response.headers.etag).toBe('"revision-1-view"');
    expect(response.headers["x-catalog-revision"]).toBe("revision-1");
    expect(gunzipSync(response.body).toString()).toBe(expected);
    expect(response.body.length).toBeLessThan(Buffer.byteLength(expected) / 5);
  });

  it("negotiates Brotli for Chrome and installs only once", async () => {
    const { app, address } = await setup();
    const count = app.server.listenerCount("request");
    installCatalogCompression(app.server);
    expect(app.server.listenerCount("request")).toBe(count);
    const response = await read(address, "/api/catalog/accounts/BTI", { "accept-encoding": "gzip, deflate, br" });
    expect(response.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(response.body).toString()).toBe(expected);
  });

  it("keeps conditional responses empty", async () => {
    const { address } = await setup();
    const response = await read(address, "/api/catalog/accounts/BTI", {
      "accept-encoding": "gzip", "if-none-match": '"revision-1-view"'
    });
    expect(response.status).toBe(304);
    expect(response.body.length).toBe(0);
    expect(response.headers["content-encoding"]).toBeUndefined();
  });

  it("preserves identity clients and unrelated HTTP endpoints", async () => {
    const { address } = await setup();
    for (const [path, encoding] of [["/api/catalog/accounts/BTI", "identity"], ["/api/health", "gzip"]]) {
      const response = await read(address, path!, { "accept-encoding": encoding! });
      expect(response.headers["content-encoding"]).toBeUndefined();
      expect(response.body.toString()).toBe(expected);
    }
  });

  it("serves subsequent catalogs after an interrupted client", async () => {
    let produced = 0;
    let closed = false;
    const chunk = randomBytes(32_768).toString("hex");
    const { address } = await setup((app) => {
      app.get("/api/catalog/accounts/slow", (_req, reply) => reply.type("application/json").send(
        Readable.from((async function* () {
          try {
            for (; produced < 1_000; produced++) { yield chunk; await delay(1); }
          } finally { closed = true; }
        })())
      ));
    });
    await new Promise<void>((resolve, reject) => {
      const req = request(`${address}/api/catalog/accounts/slow`, { headers: { "accept-encoding": "gzip" } }, (res) => {
        res.once("data", () => { res.destroy(); resolve(); });
      });
      req.on("error", reject);
      req.end();
    });
    await expect.poll(() => closed).toBe(true);
    expect(produced).toBeLessThan(1_000);
    const response = await read(address, "/api/catalog/accounts/BTI", { "accept-encoding": "gzip" });
    expect(gunzipSync(response.body).toString()).toBe(expected);
  });
});
