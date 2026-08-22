import { randomUUID } from "node:crypto";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { z } from "zod";
import type { ChromeBridgeSourceSnapshot } from "./chrome-bridge-registry.js";
import type { CmdHiddenMarketProbeResult } from "../providers/cmd/cmd-hidden-market-probe.js";

const HttpEvidenceSchema = z.strictObject({ method: z.string().max(16), hostname: z.string().max(253),
  pathname: z.string().max(512), resourceType: z.string().max(64), eventIdReferenced: z.boolean() });
const WsEvidenceSchema = z.strictObject({ direction: z.enum(["SENT", "RECEIVED"]),
  byteLength: z.number().int().nonnegative(), eventIdReferenced: z.boolean(),
  jsonKeys: z.array(z.string().max(128)).max(128), channelPaths: z.array(z.string().max(512)).max(128) });
const ResultSchema = z.strictObject({ requestId: z.string().min(1).max(128),
  providerEventId: z.string().min(1).max(512),
  status: z.enum(["EXPANDED", "NO_NEW_MARKETS", "NO_SAFE_CONTROL", "EVENT_NOT_FOUND", "TIMEOUT"]),
  beforeMarketIds: z.array(z.string().max(512)).max(5_000),
  afterMarketIds: z.array(z.string().max(512)).max(5_000),
  clickedControlCount: z.number().int().nonnegative().max(100),
  clickedControls: z.array(z.string().max(120)).max(100), stablePasses: z.number().int().nonnegative().max(8),
  candidateControls: z.array(z.string().max(120)).max(100),
  marketStructures: z.array(z.string().max(240)).max(100),
  visibleEventIds: z.array(z.string().max(128)).max(5_000),
  httpEvidence: z.array(HttpEvidenceSchema).max(1_000), websocketEvidence: z.array(WsEvidenceSchema).max(1_000) });

interface PendingProbe {
  readonly providerEventId: string;
  readonly resolve: (result: CmdHiddenMarketProbeResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class CmdHiddenMarketProbeCoordinator {
  readonly #listSources: () => readonly ChromeBridgeSourceSnapshot[];
  readonly #controlPlane: { probeCmdHiddenMarkets(sourceId: string, requestId: string,
    providerEventId: string): boolean };
  readonly #idFactory: () => string;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, PendingProbe>();

  constructor(options: { readonly listSources: () => readonly ChromeBridgeSourceSnapshot[];
    readonly controlPlane: { probeCmdHiddenMarkets(sourceId: string, requestId: string,
      providerEventId: string): boolean }; readonly idFactory?: () => string; readonly timeoutMs?: number }) {
    this.#listSources = options.listSources;
    this.#controlPlane = options.controlPlane;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 250) throw new Error("CMD_HIDDEN_PROBE_OPTIONS_INVALID");
  }

  probe(providerEventId: string): Promise<CmdHiddenMarketProbeResult> {
    if (!/^[a-z0-9._:-]{1,512}$/iu.test(providerEventId)) return Promise.reject(new Error("CMD_EVENT_ID_INVALID"));
    const source = this.#listSources().filter((item) => item.lobby === "CMD" && item.state === "LIVE")
      .sort((left, right) => right.lastAcceptedAtMs - left.lastAcceptedAtMs)[0];
    if (source === undefined) return Promise.reject(new Error("CMD_SOURCE_NOT_LIVE"));
    const requestId = this.#idFactory();
    return new Promise<CmdHiddenMarketProbeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("CMD_HIDDEN_PROBE_TIMEOUT"));
      }, this.#timeoutMs);
      this.#pending.set(requestId, { providerEventId, resolve, reject, timer });
      if (this.#controlPlane.probeCmdHiddenMarkets(source.sourceId, requestId, providerEventId)) return;
      clearTimeout(timer);
      this.#pending.delete(requestId);
      reject(new Error("CMD_SOURCE_NOT_LIVE"));
    });
  }

  ingest(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "CMD" || envelope.transport !== "DOM_SNAPSHOT" ||
      envelope.request.pathnameClass !== "/__fieldline_cmd_hidden_probe__" || envelope.payload.encoding !== "UTF8") return false;
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(envelope.payload.body) as unknown; } catch { return false; }
    const parsed = ResultSchema.safeParse(parsedJson);
    if (!parsed.success) return false;
    const pending = this.#pending.get(parsed.data.requestId);
    if (!pending || pending.providerEventId !== parsed.data.providerEventId) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(parsed.data.requestId);
    pending.resolve(parsed.data);
    return true;
  }
}
