import { z } from "zod";

export const CHROME_BRIDGE_MAX_PAYLOAD_BYTES = 256 * 1024;

const SafeIntegerSchema = z.number().int().safe().nonnegative();
const TimestampSchema = z.number().finite().nonnegative();
const SourceIdSchema = z.string().trim().min(1).max(128);
const PublicGenerationIdSchema = z.string().trim().min(1).max(128).regex(/^[a-z0-9._:-]+$/iu);

export const ChromeBridgeHttpMethodSchema = z.string().min(1).max(32)
  .regex(/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]*$/u);

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
  "WS_STATE",
  "HTTP_RESPONSE",
  "DOM_SNAPSHOT",
  "TAB_STATE"
]);

const SanitizedRequestBaseShape = {
  hostname: z.string().trim().min(1).max(253).regex(/^[a-z0-9.-]+$/iu),
  pathnameClass: z.string().trim().min(1).max(512).startsWith("/"),
  resourceType: z.string().trim().min(1).max(64),
  method: ChromeBridgeHttpMethodSchema.optional(),
  observerRequestId: PublicGenerationIdSchema.optional(),
  requestFrameKey: PublicGenerationIdSchema.optional(),
  requestDocumentKey: PublicGenerationIdSchema.optional(),
  streamId: PublicGenerationIdSchema.optional(),
  providerFunctionCode: z.number().int().min(1).max(7).optional(),
  reconcileCutoffSequence: SafeIntegerSchema.optional(),
  replayed: z.boolean().optional()
};

export const KsportRecoveryRequestMetadataSchema = z.strictObject({
  providerPartition: z.enum(["KSPORT_LIVE", "KSPORT_TODAY"]),
  providerContentIntent: z.literal("FOOTBALL_FULL_CATALOG"),
  requestStartSequence: SafeIntegerSchema
});

const SanitizedNonRecoveryRequestSchema = z.strictObject({
  ...SanitizedRequestBaseShape,
  providerPartition: z.enum(["IM_MARKET_1", "IM_MARKET_2"]).optional()
});

const SanitizedKsportRecoveryRequestSchema = z.strictObject({
  ...SanitizedRequestBaseShape,
  ...KsportRecoveryRequestMetadataSchema.shape
});

const SanitizedRequestSchema = z.union([
  SanitizedNonRecoveryRequestSchema,
  SanitizedKsportRecoveryRequestSchema
]);

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
  sourceEpoch: PublicGenerationIdSchema.optional(),
  tabId: SafeIntegerSchema,
  sequence: SafeIntegerSchema,
  observedAtMs: TimestampSchema,
  receivedMonotonicMs: TimestampSchema,
  transport: ChromeBridgeTransportSchema,
  request: SanitizedRequestSchema,
  payload: BridgePayloadSchema
}).superRefine((value, context) => {
  const requestProvenanceCount = [value.request.requestFrameKey, value.request.requestDocumentKey]
    .filter((field) => field !== undefined).length;
  if (requestProvenanceCount === 1) {
    context.addIssue({ code: "custom", path: ["request", "requestFrameKey"],
      message: "request frame and document provenance must be bound together" });
  }
  if ("providerContentIntent" in value.request && value.lobby !== "KSPORT") {
    context.addIssue({ code: "custom", path: ["lobby"],
      message: "KSPORT recovery metadata requires the KSPORT lobby" });
  }
  if (value.transport === "HTTP_RESPONSE") {
    if (value.request.method === undefined) {
      context.addIssue({ code: "custom", path: ["request", "method"],
        message: "HTTP responses require an exact sanitized request method" });
    }
    if (value.request.observerRequestId === undefined) {
      context.addIssue({ code: "custom", path: ["request", "observerRequestId"],
        message: "HTTP responses require an observer request identity" });
    }
  }
});

export const CmdSnapshotChunkSchema = z.strictObject({
  schemaVersion: z.literal(2),
  snapshotId: z.string().trim().min(16).max(128).regex(/^[a-z0-9._:-]+$/iu),
  chunkIndex: SafeIntegerSchema,
  chunkCount: z.number().int().min(1).max(64),
  sweepId: PublicGenerationIdSchema.optional(),
  sweepComplete: z.boolean().optional(),
  sweepFrameKey: PublicGenerationIdSchema.optional(),
  sweepDocumentKey: PublicGenerationIdSchema.optional(),
  records: z.array(z.unknown()).max(5_000)
}).superRefine((value, context) => {
  if (value.chunkIndex >= value.chunkCount) {
    context.addIssue({ code: "custom", path: ["chunkIndex"], message: "chunkIndex must be below chunkCount" });
  }
  const sweepFields = [value.sweepId, value.sweepComplete, value.sweepFrameKey, value.sweepDocumentKey];
  const sweepFieldCount = sweepFields.filter((field) => field !== undefined).length;
  if (sweepFieldCount !== 0 && sweepFieldCount !== sweepFields.length) {
    context.addIssue({ code: "custom", path: ["sweepId"],
      message: "sweep identity, completion, frame, and document metadata must be bound" });
  }
  if (value.records.length === 0 && !(sweepFieldCount === sweepFields.length && value.sweepComplete === true)) {
    context.addIssue({ code: "custom", path: ["records"],
      message: "empty records require an explicitly completed bound sweep" });
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

const SelectionPriceProbeMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("PROBE_SELECTION_PRICE"),
  sourceId: SourceIdSchema,
  requestId: z.string().trim().min(1).max(128).regex(/^[a-z0-9._:-]+$/iu),
  providerEventId: OpaqueProviderIdSchema,
  providerMarketId: OpaqueProviderIdSchema,
  providerSelectionId: OpaqueProviderIdSchema,
  eventLabel: z.string().trim().min(1).max(512),
  participantA: z.string().trim().min(1).max(256),
  participantB: z.string().trim().min(1).max(256),
  marketType: z.string().trim().min(1).max(64).regex(/^[A-Z0-9_]+$/u),
  scope: z.string().trim().min(1).max(64).regex(/^[A-Z0-9_]+$/u),
  selection: z.string().trim().min(1).max(128).regex(/^[A-Z0-9_]+$/u),
  line: z.string().trim().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u).max(128).nullable()
});

const CmdHiddenMarketProbeMessageSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("PROBE_CMD_HIDDEN_MARKETS"),
  sourceId: SourceIdSchema,
  requestId: z.string().trim().min(1).max(128).regex(/^[a-z0-9._:-]+$/iu),
  providerEventId: OpaqueProviderIdSchema
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
  SelectionPriceProbeMessageSchema,
  CmdHiddenMarketProbeMessageSchema,
  RejectMessageSchema,
  SourceStateMessageSchema
]);

export type ChromeLobbyId = z.infer<typeof ChromeLobbyIdSchema>;
export type ChromeBridgeTransport = z.infer<typeof ChromeBridgeTransportSchema>;
export type ChromeBridgeHttpMethod = z.infer<typeof ChromeBridgeHttpMethodSchema>;
export type KsportRecoveryRequestMetadata = z.infer<typeof KsportRecoveryRequestMetadataSchema>;
export type ChromeBridgeRequest = z.infer<typeof SanitizedRequestSchema>;
export type ChromeBridgeEnvelope = z.infer<typeof ChromeBridgeEnvelopeSchema>;
export type CmdSnapshotChunk = z.infer<typeof CmdSnapshotChunkSchema>;
export type ChromeNetworkBodyChunk = z.infer<typeof ChromeNetworkBodyChunkSchema>;
export type ChromeBridgeSourceState = z.infer<typeof ChromeBridgeSourceStateSchema>;
export type ChromeBridgeControlMessage = z.infer<typeof ChromeBridgeControlMessageSchema>;
