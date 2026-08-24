import type { FastifyInstance } from "fastify";
import type { Runtime } from "../runtime.js";

const expectedProviderStatuses = new Set([
  "SABA\u0000FOOTBALL",
  "IM\u0000FOOTBALL",
  "SABA\u0000LOL",
  "IM\u0000LOL"
]);

const buildIdentityPattern = /^sha256:[a-f0-9]{64}$/u;

export function registerHealthRoute(app: FastifyInstance, runtime: Runtime,
  buildIdentityValue?: string): void {
  const buildIdentity = typeof buildIdentityValue === "string" && buildIdentityPattern.test(buildIdentityValue)
    ? buildIdentityValue : null;
  app.get("/api/health", async (_request, reply) => {
    const snapshot = runtime.getSnapshot();
    const statusIdentities = new Set(snapshot.providerStatuses.map((provider) =>
      `${provider.provider}\u0000${provider.category}`));
    const allExpectedProvidersLive = snapshot.providerStatuses.length === expectedProviderStatuses.size
      && statusIdentities.size === expectedProviderStatuses.size
      && [...expectedProviderStatuses].every((identity) => statusIdentities.has(identity))
      && snapshot.providerStatuses.every((provider) => provider.status === "LIVE");

    return reply.send({
      status: allExpectedProvidersLive ? "ok" : "degraded",
      mode: "OBSERVE",
      executionReady: false,
      buildIdentity,
      revision: snapshot.revision,
      providerStatuses: snapshot.providerStatuses
    });
  });
}
