import compression from "compression";
import type { Server } from "node:http";
import { constants } from "node:zlib";

const installed = new WeakSet<Server>();

/** Compress large catalog streams before they reach the socket, with bounded streaming backpressure. */
export function installCatalogCompression(server: Server): void {
  if (installed.has(server)) return;
  const compress = compression({
    level: constants.Z_BEST_SPEED,
    brotli: { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } },
    threshold: 1_024,
    filter: (req, res) => res.statusCode === 200 && compression.filter(req, res)
  });
  // This middleware uses only Node request/response APIs. Its synchronous setup must run
  // before Fastify's existing handler; attaching it also supports a server already listening.
  server.prependListener("request", (req, res) => {
    if ((req.method !== "GET" && req.method !== "POST") ||
      !/^\/api\/catalog\/accounts\/[^/?]+(?:\?|$)/.test(req.url ?? "")) return;
    compress(req as Parameters<typeof compress>[0], res as Parameters<typeof compress>[1], () => {});
  });
  installed.add(server);
}
