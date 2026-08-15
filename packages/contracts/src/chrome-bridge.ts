import { z } from "zod";

export const CHROME_BRIDGE_MAX_PAYLOAD_BYTES = 256 * 1024;

const SafeIntegerSchema = z.number().int().safe().nonnegative();
const TimestampSchema = z.number().finite().nonnegative();
const SourceIdSchema = z.string().trim().min(1).max(128);

export const ChromeLobbyIdSchema = z.enum([
  "IM",
  "BTI",
  "TSPORT",
  "KSPORT",
  "SABA",
  "CMD",
  "SBO"
]);

export const ChromeBridgeTransportSchema = z.enum([
  "WS_FRAME",
  "HTTP_RESPONSE",
  "TAB_STATE"
]);

const SanitizedRequestSchema = z.strictObject({
  hostname: z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/iu),
  pathnameClass: z.string().trim().min(1).max(512).startsWith("/"),
  resourceType: z.string().trim().min(1).max(64)
});

const BridgePayloadSchema = z.strictObject({
  encoding: z.enum(["UTF8", "BASE64"]),
  body: z.string().superRefine((value, context) => {
    if (new TextEncoder().encode(value).byteLength > CHROME_BRIDGE_MAX_PAYLOAD_BYTES) {
      context.addIssue({ code: "custom", message: "BRIDGE_PAYLOAD_TOO_LARGE" });
    }
  })
});

export const ChromeBridgeEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("NETWORK"),
  lobby: ChromeLobbyIdSchema,
  sourceId: SourceIdSchema,
  tabId: SafeIntegerSchema,
  sequence: SafeIntegerSchema,
  observedAtMs: TimestampSchema,
  receivedMonotonicMs: TimestampSchema,
  transport: ChromeBridgeTransportSchema,
  request: SanitizedRequestSchema,
  payload: BridgePayloadSchema
});

const HelloMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("HELLO"),
  installationId: z.string().trim().min(1).max(128)
});

const AckMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("ACK"),
  sourceId: SourceIdSchema,
  sequence: SafeIntegerSchema
});

const RejectMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("REJECT"),
  sourceId: SourceIdSchema.nullable(),
  sequence: SafeIntegerSchema.nullable(),
  reason: z.enum([
    "UNAUTHORIZED",
    "MALFORMED",
    "PAYLOAD_TOO_LARGE",
    "DUPLICATE",
    "OUT_OF_ORDER",
    "SEQUENCE_GAP"
  ])
});

export const ChromeBridgeSourceStateSchema = z.enum([
  "ATTACHED",
  "LIVE",
  "STALE",
  "ERROR",
  "DISCONNECTED"
]);

const SourceStateMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("SOURCE_STATE"),
  lobby: ChromeLobbyIdSchema,
  sourceId: SourceIdSchema,
  state: ChromeBridgeSourceStateSchema,
  observedAtMs: TimestampSchema,
  reason: z.string().trim().min(1).max(256).nullable()
});

export const ChromeBridgeControlMessageSchema = z.discriminatedUnion("kind", [
  HelloMessageSchema,
  AckMessageSchema,
  RejectMessageSchema,
  SourceStateMessageSchema
]);

export type ChromeLobbyId = z.infer<typeof ChromeLobbyIdSchema>;
export type ChromeBridgeTransport = z.infer<typeof ChromeBridgeTransportSchema>;
export type ChromeBridgeEnvelope = z.infer<typeof ChromeBridgeEnvelopeSchema>;
export type ChromeBridgeSourceState = z.infer<typeof ChromeBridgeSourceStateSchema>;
export type ChromeBridgeControlMessage = z.infer<typeof ChromeBridgeControlMessageSchema>;
