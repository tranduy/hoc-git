import {
  AppSnapshotSchema,
  CategorySchema,
  type AppSnapshot,
  type Category,
  type MappingStatus
} from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";
import type { Runtime } from "../runtime.js";

interface SnapshotQuery {
  readonly category?: Category;
}

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: CategorySchema.options }
  }
} as const;

function mappingCounts(
  items: readonly { readonly mappingStatus: MappingStatus }[]
): AppSnapshot["counts"]["mappings"] {
  return {
    VERIFIED: items.filter((item) => item.mappingStatus === "VERIFIED").length,
    REVIEW_REQUIRED: items.filter((item) => item.mappingStatus === "REVIEW_REQUIRED").length,
    REJECTED: items.filter((item) => item.mappingStatus === "REJECTED").length
  };
}

function filterSnapshot(snapshot: AppSnapshot, category: Category): AppSnapshot {
  const events = snapshot.events.filter((event) => event.category === category);
  const markets = snapshot.markets.filter((market) => market.category === category);
  const opportunities = snapshot.opportunities.filter((opportunity) =>
    opportunity.category === category);
  const filtered = {
    ...snapshot,
    providerStatuses: snapshot.providerStatuses.filter((status) => status.category === category),
    events,
    markets,
    opportunities,
    blockedDiagnostics: snapshot.blockedDiagnostics.filter((diagnostic) =>
      diagnostic.category === category),
    counts: {
      FOOTBALL: category === "FOOTBALL"
        ? { events: events.length, markets: markets.length }
        : { events: 0, markets: 0 },
      LOL: category === "LOL"
        ? { events: events.length, markets: markets.length }
        : { events: 0, markets: 0 },
      mappings: mappingCounts([...events, ...markets]),
      opportunities: opportunities.length
    }
  };
  return AppSnapshotSchema.parse(filtered);
}

export function registerSnapshotRoute(app: FastifyInstance, runtime: Runtime): void {
  app.get<{ Querystring: SnapshotQuery }>(
    "/api/snapshot",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      const snapshot = runtime.getSnapshot();
      const body = request.query.category === undefined
        ? AppSnapshotSchema.parse(snapshot)
        : filterSnapshot(snapshot, request.query.category);
      return reply.send(body);
    }
  );
}
