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
  "DOM_SNAPSHOT",
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

export const CmdSnapshotChunkSchema = z.strictObject({
  schemaVersion: z.literal(2),
  snapshotId: z.string().trim().min(16).max(128).regex(/^[a-z0-9._:-]+$/iu),
  chunkIndex: SafeIntegerSchema,
  chunkCount: z.number().int().min(1).max(64),
  records: z.array(z.unknown()).min(1).max(5_000)
}).superRefine((value, context) => {
  if (value.chunkIndex >= value.chunkCount) {
    context.addIssue({ code: "custom", path: ["chunkIndex"], message: "chunkIndex must be below chunkCount" });
  }
});

export const ChromeNetworkBodyChunkSchema = z.strictObject({
  schemaVersion: z.literal(1),
  snapshotId: z.string().trim().min(16).max(128).regex(/^[a-z0-9._:-]+$/iu),
  chunkIndex: SafeIntegerSchema,
  chunkCount: z.number().int().min(1).max(256),
  bodyEncoding: z.literal("UTF8"),
  bodyFragment: z.string().min(1).superRefine((value, context) => {
    if (new TextEncoder().encode(value).byteLength > 128 * 1024) {
      context.addIssue({ code: "custom", message: "BRIDGE_CHUNK_TOO_LARGE" });
    }
  })
}).superRefine((value, context) => {
  if (value.chunkIndex >= value.chunkCount) {
    context.addIssue({ code: "custom", path: ["chunkIndex"], message: "chunkIndex must be below chunkCount" });
  }
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

const SnapshotRequestMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("REQUEST_SNAPSHOT"),
  sourceId: SourceIdSchema
});

const ReloadSourceMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("RELOAD_SOURCE"),
  sourceId: SourceIdSchema
});

const FreshLaunchUrlSchema = z.string().trim().min(1).max(8192).url().superRefine((value, context) => {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A credential-free HTTPS launch URL is required" });
  }
});

const NavigateSourceMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("NAVIGATE_SOURCE"),
  sourceId: SourceIdSchema,
  url: FreshLaunchUrlSchema
});

const EnsureSourceMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("ENSURE_SOURCE"),
  lobby: ChromeLobbyIdSchema,
  url: FreshLaunchUrlSchema
});

const RestoreSourceMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("RESTORE_SOURCE"),
  lobby: ChromeLobbyIdSchema
});

const OpaqueProviderIdSchema = z.string().trim().min(1).max(512);

const FocusSelectionMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("FOCUS_SELECTION"),
  sourceId: SourceIdSchema,
  providerEventId: OpaqueProviderIdSchema,
  providerMarketId: OpaqueProviderIdSchema,
  providerSelectionId: OpaqueProviderIdSchema
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
  SnapshotRequestMessageSchema,
  ReloadSourceMessageSchema,
  NavigateSourceMessageSchema,
  EnsureSourceMessageSchema,
  RestoreSourceMessageSchema,
  FocusSelectionMessageSchema,
  RejectMessageSchema,
  SourceStateMessageSchema
]);

export type ChromeLobbyId = z.infer<typeof ChromeLobbyIdSchema>;
export type ChromeBridgeTransport = z.infer<typeof ChromeBridgeTransportSchema>;
export type ChromeBridgeEnvelope = z.infer<typeof ChromeBridgeEnvelopeSchema>;
export type CmdSnapshotChunk = z.infer<typeof CmdSnapshotChunkSchema>;
export type ChromeNetworkBodyChunk = z.infer<typeof ChromeNetworkBodyChunkSchema>;
export type ChromeBridgeSourceState = z.infer<typeof ChromeBridgeSourceStateSchema>;
export type ChromeBridgeControlMessage = z.infer<typeof ChromeBridgeControlMessageSchema>;
