type CatalogPartition = "live" | "today";

const KSPORT_MAX_PENDING_DELTA_RECORDS = 256;
const KSPORT_MAX_PENDING_DELTA_MARKETS = 2_048;

export interface KsportRecoveryGenerationOptions {
  readonly maxPendingChars?: number;
  readonly maxPendingFrames?: number;
}

export interface AttributedKsportFrame {
  readonly payload: string;
  readonly recoveryGeneration: number;
}

type SnapshotRejection = "NONE" | "NOT_ARRAY" | "LEAGUE_SHAPE" | "EVENT_ID" |
  "EVENT_TEAMS" | "EVENT_MARKETS" | "NO_DECODABLE_MARKET";

interface ProviderReceipt {
  readonly partition: CatalogPartition;
  readonly snapshotRejection: SnapshotRejection;
  readonly order: number | null;
  readonly full: boolean;
  readonly catalogEvidence: boolean;
  readonly catalogMarketKeys: readonly string[];
}

interface RecoveryState {
  generation: number;
  complete: boolean;
  readonly fullPartitions: Set<CatalogPartition>;
  readonly highWatermarks: Map<CatalogPartition, number>;
  previousGeneration: number | null;
  readonly attemptFloors: Map<CatalogPartition, number>;
  readonly attemptPartitions: Set<CatalogPartition>;
}

/**
 * Attributes KSPORT STOMP receipts to explicit baseline attempts on one socket.
 * Fragmented receipts are held until their attempt is known. Ambiguous mixed
 * batches and overflow fail closed rather than relabelling retired evidence.
 */
export class KsportRecoveryGenerationTracker {
  readonly #maxPendingChars: number;
  readonly #maxPendingFrames: number;
  #state: RecoveryState = initialState();
  #pendingStomp = "";
  #pendingPayloads: string[] = [];
  #pendingReceipts: ProviderReceipt[] = [];
  #pendingChars = 0;
  #pendingSentStomp = "";
  #pendingSentFrames = 0;
  #catalogEvidenceVersion = 0;
  #catalogEvidenceHighWatermarks = new Map<CatalogPartition, number>();
  #catalogCommittedGeneration = 0;
  #catalogPendingFullOrders = new Map<CatalogPartition, number>();
  #catalogPendingEventKeys = new Set<string>();
  #catalogPendingMarketHighWatermarks = new Map<string, number>();
  #failed = false;
  #stompFrames = 0;
  #stompMessages = 0;
  #partitionRejected = 0;
  #commandFragments = 0;
  #fragments = 0;
  #destLiveLike = 0;
  #destTodayLike = 0;
  #destSportsLike = 0;
  #subSportLike = 0;
  readonly #snapshotRejections = new Map<SnapshotRejection, number>();
  #failReason: "NONE" | "PAYLOAD_TOO_LONG" | "ENVELOPE_INVALID" | "PENDING_OVERFLOW" |
    "SENT_PENDING_OVERFLOW" | "SUBSCRIBE_STRADDLE" | "ATTEMPT_UNAVAILABLE" |
    "DELTA_BUFFER_FULL" | "EVIDENCE_VERSION_EXHAUSTED" | "OTHER" = "NONE";

  constructor(options: KsportRecoveryGenerationOptions = {}) {
    this.#maxPendingChars = positiveBound(options.maxPendingChars ?? 4_000_000);
    this.#maxPendingFrames = positiveBound(options.maxPendingFrames ?? 64);
  }

  get currentGeneration(): number { return this.#state.generation; }

  get catalogEvidenceVersion(): number { return this.#catalogEvidenceVersion; }

  get catalogAuthorityGeneration(): number { return this.#catalogCommittedGeneration; }

  get failed(): boolean { return this.#failed; }
  /**
   * Structural counts only: how many complete STOMP frames arrived, how many
   * were MESSAGE frames, and how many of those the catalog partition mapping
   * refused. Never records a destination, header or body.
   */
  get frameShape(): { readonly stompFrames: number; readonly stompMessages: number;
    readonly partitionRejected: number; readonly pendingChars: number;
    readonly commandFragments: number; readonly fragments: number;
    readonly destLiveLike: number; readonly destTodayLike: number;
    readonly destSportsLike: number; readonly subSportLike: number;
    readonly snapshotRejections: string } {
    return { stompFrames: this.#stompFrames, stompMessages: this.#stompMessages,
      partitionRejected: this.#partitionRejected, pendingChars: this.#pendingStomp.length,
      commandFragments: this.#commandFragments, fragments: this.#fragments,
      destLiveLike: this.#destLiveLike, destTodayLike: this.#destTodayLike,
      destSportsLike: this.#destSportsLike, subSportLike: this.#subSportLike,
      snapshotRejections: [...this.#snapshotRejections.entries()]
        .map(([reason, count]) => `${reason}:${count}`).join("|") };
  }
  /** Why the decoder latched, so the fault is named rather than inferred. */
  get failReason(): "NONE" | "PAYLOAD_TOO_LONG" | "ENVELOPE_INVALID" | "PENDING_OVERFLOW" |
    "SENT_PENDING_OVERFLOW" | "SUBSCRIBE_STRADDLE" | "ATTEMPT_UNAVAILABLE" |
    "DELTA_BUFFER_FULL" | "EVIDENCE_VERSION_EXHAUSTED" | "OTHER" {
    return this.#failReason;
  }

  get currentBaselineState(): { readonly live: boolean; readonly today: boolean;
    readonly complete: boolean } {
    if (this.#failed) return { live: false, today: false, complete: false };
    const live = this.#state.fullPartitions.has("live");
    const today = this.#state.fullPartitions.has("today");
    return { live, today, complete: this.#state.complete && live && today };
  }

  /**
   * Starts a new attempt only from the provider's own outbound catalog
   * SUBSCRIBE boundary. Receipt order is deliberately not an attempt clock;
   * it is used only to fence delayed evidence from the prior explicit attempt.
   */
  observeSent(payload: string): number | null {
    if (this.#failed || typeof payload !== "string") return null;
    if (payload.length > this.#maxPendingChars) {
      this.#fail("PAYLOAD_TOO_LONG");
      return null;
    }
    const encoded = parseSockJsEnvelope(payload);
    if (encoded.kind === "INVALID") {
      this.#fail("ENVELOPE_INVALID");
      return null;
    }
    const fragments = encoded.kind === "VALID" ? encoded.strings
      : (this.#pendingSentStomp !== "" || isRawStompStart(payload, "SENT") ? [payload] : null);
    if (fragments === null) return null;
    this.#pendingSentFrames += 1;
    if (this.#pendingSentFrames > this.#maxPendingFrames) {
      this.#fail("PENDING_OVERFLOW");
      return null;
    }
    let observedGeneration: number | null = null;
    for (const fragment of fragments) {
      const appended = appendStompFragment(this.#pendingSentStomp, fragment);
      this.#pendingSentStomp = appended.pending;
      if (this.#pendingSentStomp.length > this.#maxPendingChars) {
        this.#fail("SENT_PENDING_OVERFLOW");
        return null;
      }
      for (const frame of appended.frames) {
        const partition = catalogSubscription(frame);
        if (partition !== null) {
          if (this.#pendingStomp !== "" || this.#pendingPayloads.length > 0 ||
            this.#pendingReceipts.length > 0) {
            // An inbound receipt straddling an outbound recovery boundary has no
            // observable immutable origin. Retire this tracker instead of guessing.
            this.#fail("SUBSCRIBE_STRADDLE");
            return null;
          }
          observedGeneration = this.#beginExplicitAttempt(partition);
          if (observedGeneration === null) {
            this.#fail("ATTEMPT_UNAVAILABLE");
            return null;
          }
        }
      }
    }
    if (this.#pendingSentStomp === "") this.#pendingSentFrames = 0;
    return observedGeneration;
  }

  push(payload: string): readonly AttributedKsportFrame[] {
    if (this.#failed || typeof payload !== "string") return [];
    if (payload.length > this.#maxPendingChars) {
      this.#fail("PAYLOAD_TOO_LONG");
      return [];
    }
    const encoded = parseSockJsEnvelope(payload);
    if (encoded.kind === "INVALID") {
      this.#fail("ENVELOPE_INVALID");
      return [];
    }
    const fragments = encoded.kind === "VALID" ? encoded.strings
      : (this.#pendingStomp !== "" || isRawStompStart(payload, "RECEIVED") ? [payload] : null);
    if (fragments === null) return [];
    this.#pendingPayloads.push(payload);
    this.#pendingChars += payload.length;
    if (this.#pendingPayloads.length > this.#maxPendingFrames || this.#pendingChars > this.#maxPendingChars) {
      this.#fail("PENDING_OVERFLOW");
      return [];
    }
    for (const fragment of fragments) {
      this.#fragments += 1;
      if (isRawStompStart(fragment, "RECEIVED")) this.#commandFragments += 1;
      const appended = appendStompFragment(this.#pendingStomp, fragment);
      this.#pendingStomp = appended.pending;
      if (this.#pendingStomp.length > this.#maxPendingChars) {
        this.#fail("PENDING_OVERFLOW");
        return [];
      }
      for (const frame of appended.frames) {
        this.#stompFrames += 1;
        const separator = frame.indexOf(String.fromCharCode(10, 10));
        const isMessage = separator >= 0 &&
          frame.slice(0, separator).split(String.fromCharCode(10))[0]?.trim() === "MESSAGE";
        if (isMessage) this.#stompMessages += 1;
        const receipt = providerReceipt(frame);
        if (receipt === null) {
          if (isMessage) {
            this.#partitionRejected += 1;
            // Shape only: which known path segment the destination carries, so a
            // renamed topic can be told from an unrelated stream. The value is
            // never recorded.
            const header = separator < 0 ? "" : frame.slice(0, separator);
            if (/\/live\//u.test(header)) this.#destLiveLike += 1;
            if (/\/today\//u.test(header)) this.#destTodayLike += 1;
            if (/\/sports\//u.test(header)) this.#destSportsLike += 1;
            if (/subscription:\s*subSport/u.test(header)) this.#subSportLike += 1;
          }
          continue;
        }
        if (receipt.snapshotRejection !== "NONE") {
          this.#snapshotRejections.set(receipt.snapshotRejection,
            (this.#snapshotRejections.get(receipt.snapshotRejection) ?? 0) + 1);
        }
        this.#pendingReceipts.push(receipt);
      }
    }
    if (this.#pendingStomp !== "") return [];

    const receipts = this.#pendingReceipts;
    const candidate = cloneState(this.#state);
    const generations = new Set<number>();
    const catalogEvidenceHighWatermarks = new Map(this.#catalogEvidenceHighWatermarks);
    let catalogCommittedGeneration = this.#catalogCommittedGeneration;
    const catalogPendingFullOrders = new Map(this.#catalogPendingFullOrders);
    const catalogPendingEventKeys = new Set(this.#catalogPendingEventKeys);
    const catalogPendingMarketHighWatermarks = new Map(this.#catalogPendingMarketHighWatermarks);
    let catalogEvidenceAdvanced = false;
    for (const receipt of receipts) {
      const generation = attributeReceipt(candidate, receipt);
      if (generation === null) {
        this.#dropPending();
        return [];
      }
      generations.add(generation);
      const order = receipt.order;
      let acceptedCatalogEvidence = false;
      if (receipt.catalogEvidence && order !== null && generation === candidate.generation &&
        candidate.generation > catalogCommittedGeneration) {
        if (receipt.full) {
          const floor = candidate.attemptFloors.get(receipt.partition) ?? 0;
          const priorFullOrder = catalogPendingFullOrders.get(receipt.partition);
          if (order > floor && (priorFullOrder === undefined || order > priorFullOrder)) {
            catalogPendingFullOrders.set(receipt.partition, order);
            acceptedCatalogEvidence = true;
          }
        } else {
          const partitionEvidence = catalogPendingFullOrders.get(receipt.partition) ??
            candidate.attemptFloors.get(receipt.partition) ?? 0;
          if (order > partitionEvidence) {
            for (const marketKey of receipt.catalogMarketKeys) {
              const key = `${receipt.partition}\u0000${marketKey}`;
              if (order <= (catalogPendingMarketHighWatermarks.get(key) ?? 0)) continue;
              const eventId = marketKey.slice(0, marketKey.indexOf("\u0000"));
              const eventKey = `${receipt.partition}\u0000${eventId}`;
              const addsEvent = !catalogPendingEventKeys.has(eventKey);
              const addsMarket = !catalogPendingMarketHighWatermarks.has(key);
              if ((addsEvent && catalogPendingEventKeys.size >= KSPORT_MAX_PENDING_DELTA_RECORDS) ||
                (addsMarket && catalogPendingMarketHighWatermarks.size >= KSPORT_MAX_PENDING_DELTA_MARKETS)) {
                this.#fail("DELTA_BUFFER_FULL");
                return [];
              }
              catalogPendingEventKeys.add(eventKey);
              catalogPendingMarketHighWatermarks.set(key, order);
              acceptedCatalogEvidence = true;
            }
          }
        }
      } else if (receipt.catalogEvidence && !receipt.full && order !== null &&
        generation === catalogCommittedGeneration && candidate.generation === catalogCommittedGeneration &&
        order > (catalogEvidenceHighWatermarks.get(receipt.partition) ?? 0)) {
        acceptedCatalogEvidence = true;
      }
      if (acceptedCatalogEvidence && order !== null) {
        catalogEvidenceHighWatermarks.set(receipt.partition,
          Math.max(catalogEvidenceHighWatermarks.get(receipt.partition) ?? 0, order));
        catalogEvidenceAdvanced = true;
        if (receipt.full && catalogPendingFullOrders.has("live") &&
          catalogPendingFullOrders.has("today")) catalogCommittedGeneration = candidate.generation;
      }
    }
    if (receipts.length === 0) {
      this.#dropPending();
      return [];
    }
    if (generations.size > 1) {
      this.#dropPending();
      return [];
    }
    const generation = generations.values().next().value as number | undefined ?? candidate.generation;
    if (catalogEvidenceAdvanced && this.#catalogEvidenceVersion >= Number.MAX_SAFE_INTEGER) {
      this.#fail("EVIDENCE_VERSION_EXHAUSTED");
      return [];
    }
    this.#state = candidate;
    this.#catalogEvidenceHighWatermarks = catalogEvidenceHighWatermarks;
    this.#catalogCommittedGeneration = catalogCommittedGeneration;
    this.#catalogPendingFullOrders = catalogPendingFullOrders;
    this.#catalogPendingEventKeys = catalogPendingEventKeys;
    this.#catalogPendingMarketHighWatermarks = catalogPendingMarketHighWatermarks;
    if (catalogEvidenceAdvanced) this.#catalogEvidenceVersion += 1;
    const output = this.#pendingPayloads.map((pending) => ({ payload: pending,
      recoveryGeneration: generation }));
    this.#dropPending();
    return output;
  }

  #beginExplicitAttempt(partition: CatalogPartition): number | null {
    if (this.#state.complete) {
      if (this.#state.generation >= Number.MAX_SAFE_INTEGER ||
        this.#state.highWatermarks.size < 2) return null;
      const candidate = cloneState(this.#state);
      candidate.previousGeneration = candidate.generation;
      candidate.attemptFloors.clear();
      for (const [name, order] of candidate.highWatermarks) candidate.attemptFloors.set(name, order);
      candidate.generation += 1;
      candidate.complete = false;
      candidate.fullPartitions.clear();
      candidate.attemptPartitions.clear();
      candidate.attemptPartitions.add(partition);
      this.#state = candidate;
      this.#catalogPendingFullOrders.clear();
      this.#catalogPendingEventKeys.clear();
      this.#catalogPendingMarketHighWatermarks.clear();
      return candidate.generation;
    }
    // Multiple partition subscriptions are one attempt. During initial socket
    // bootstrap they all remain generation 1; during replacement they extend
    // the already-open explicit attempt without allocating another ordinal.
    if (!this.#state.attemptPartitions.has(partition)) {
      this.#state.attemptPartitions.add(partition);
      return this.#state.generation;
    }
    // Repeating the same partition before completion is an overlapping retry
    // whose old and current frames cannot be separated on this socket. Failing
    // here latched the decoder for the life of the socket, and the provider
    // then produced no catalog at all. Retire the attempt into a new generation
    // and drop everything pending instead: old frames belong to the retired
    // ordinal and are discarded, new frames are attributed to the new one.
    if (this.#state.generation >= Number.MAX_SAFE_INTEGER) return null;
    const retry = cloneState(this.#state);
    retry.previousGeneration = retry.generation;
    retry.generation += 1;
    retry.complete = false;
    retry.fullPartitions.clear();
    retry.attemptPartitions.clear();
    retry.attemptPartitions.add(partition);
    this.#state = retry;
    this.#dropPending();
    this.#pendingStomp = "";
    this.#catalogPendingFullOrders.clear();
    this.#catalogPendingEventKeys.clear();
    this.#catalogPendingMarketHighWatermarks.clear();
    return retry.generation;
  }

  #dropPending(): void {
    this.#pendingPayloads = [];
    this.#pendingReceipts = [];
    this.#pendingChars = 0;
  }

  #fail(reason: KsportDecoderFailReason = "OTHER"): void {
    this.#failed = true;
    if (this.#failReason === "NONE") this.#failReason = reason;
    this.#pendingStomp = "";
    this.#pendingSentStomp = "";
    this.#pendingSentFrames = 0;
    this.#catalogPendingFullOrders.clear();
    this.#catalogPendingEventKeys.clear();
    this.#catalogPendingMarketHighWatermarks.clear();
    this.#dropPending();
  }
}

function initialState(): RecoveryState {
  return { generation: 1, complete: false, fullPartitions: new Set(),
    highWatermarks: new Map(), previousGeneration: null, attemptFloors: new Map(),
    attemptPartitions: new Set() };
}

function cloneState(state: RecoveryState): RecoveryState {
  return { generation: state.generation, complete: state.complete,
    fullPartitions: new Set(state.fullPartitions), highWatermarks: new Map(state.highWatermarks),
    previousGeneration: state.previousGeneration, attemptFloors: new Map(state.attemptFloors),
    attemptPartitions: new Set(state.attemptPartitions) };
}

function attributeReceipt(state: RecoveryState, receipt: ProviderReceipt): number | null {
  if (state.previousGeneration !== null) {
    if (receipt.order === null) return null;
    const floor = state.attemptFloors.get(receipt.partition);
    if (floor === undefined) return null;
    if (receipt.order <= floor || !state.attemptPartitions.has(receipt.partition)) {
      return state.previousGeneration;
    }
  }
  rememberReceipt(state, receipt);
  if (receipt.full) state.fullPartitions.add(receipt.partition);
  if (state.fullPartitions.has("live") && state.fullPartitions.has("today")) state.complete = true;
  return state.generation;
}

function rememberReceipt(state: RecoveryState, receipt: ProviderReceipt): void {
  if (receipt.order === null) return;
  state.highWatermarks.set(receipt.partition,
    Math.max(state.highWatermarks.get(receipt.partition) ?? 0, receipt.order));
}

function appendStompFragment(pending: string, fragment: string): {
  readonly pending: string; readonly frames: readonly string[]
} {
  let combined = pending === "" ? stripLeadingStompHeartbeats(fragment) : pending + fragment;
  const frames: string[] = [];
  let terminator = combined.indexOf("\0");
  while (terminator >= 0) {
    frames.push(combined.slice(0, terminator));
    combined = stripLeadingStompHeartbeats(combined.slice(terminator + 1));
    terminator = combined.indexOf("\0");
  }
  return { pending: combined, frames };
}

function stripLeadingStompHeartbeats(value: string): string {
  if (/^\s*$/u.test(value)) return "";
  return value.replace(/^(?:\r?\n)+/u, "");
}

type ParsedSockJsEnvelope = { readonly kind: "NOT_SOCKJS" } |
  { readonly kind: "VALID"; readonly strings: readonly string[] } |
  { readonly kind: "INVALID" };

export type KsportDecoderFailReason = "NONE" | "PAYLOAD_TOO_LONG" | "ENVELOPE_INVALID" |
  "PENDING_OVERFLOW" | "SENT_PENDING_OVERFLOW" | "SUBSCRIBE_STRADDLE" | "ATTEMPT_UNAVAILABLE" |
  "DELTA_BUFFER_FULL" | "EVIDENCE_VERSION_EXHAUSTED" | "OTHER";

function parseSockJsEnvelope(payload: string): ParsedSockJsEnvelope {
  const candidate = payload.startsWith("a[") ? payload.slice(1) : payload.startsWith("[") ? payload : null;
  if (candidate === null) return { kind: "NOT_SOCKJS" };
  try {
    const value: unknown = JSON.parse(candidate);
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? { kind: "VALID", strings: value as string[] } : { kind: "INVALID" };
  } catch { return { kind: "INVALID" }; }
}

function isRawStompStart(payload: string, direction: "SENT" | "RECEIVED"): boolean {
  return direction === "SENT"
    ? /^(?:CONNECT|STOMP|SEND|SUBSCRIBE|UNSUBSCRIBE|ACK|NACK|BEGIN|COMMIT|ABORT|DISCONNECT)\r?\n/u
      .test(payload)
    : /^(?:CONNECTED|MESSAGE|RECEIPT|ERROR)\r?\n/u.test(payload);
}

function providerReceipt(frame: string): ProviderReceipt | null {
  const separator = frame.indexOf("\n\n");
  if (separator < 0 || frame.slice(0, separator).split("\n")[0]?.trim() !== "MESSAGE") return null;
  const header = headers(frame.slice(0, separator));
  const partition = receiptPartition(header.destination, header.subscription);
  if (partition === null) return null;
  let wrapper: unknown;
  try { wrapper = JSON.parse(frame.slice(separator + 2).trim()) as unknown; } catch { return null; }
  const record = asRecord(wrapper);
  if (record === null || (record.statusCode !== undefined && record.statusCode !== "OK") ||
    (record.statusCodeValue !== undefined && record.statusCodeValue !== 200) ||
    typeof record.body !== "string") return null;
  let body: unknown;
  try { body = JSON.parse(record.body) as unknown; } catch { return null; }
  const snapshotRejection = fullPartitionSnapshotRejection(body);
  const full = snapshotRejection === "NONE";
  const catalogMarketKeys = full ? [] : decodableKsportCatalogMarketKeys(body);
  return { partition, snapshotRejection, order: receiptSequence(header["message-id"]), full,
    catalogEvidence: full || catalogMarketKeys.length > 0, catalogMarketKeys };
}

function catalogSubscription(frame: string): CatalogPartition | null {
  const lines = frame.split("\n");
  if (lines[0]?.trim() !== "SUBSCRIBE") return null;
  const header = headers(frame);
  return receiptPartition(header.destination, header.id ?? header.subscription);
}

function headers(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split("\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator > 0) result[line.slice(0, separator).trim().toLowerCase()] =
      line.slice(separator + 1).trim();
  }
  return result;
}

function receiptPartition(destination?: string, subscription?: string): CatalogPartition | null {
  if (subscription === "subSportBookLive" || /\/1_1\/live\//u.test(destination ?? "")) return "live";
  if (subscription === "subSportBookToday" || subscription === "subSportHotMatch" ||
    /\/sports\/1_\d+\/today\//u.test(destination ?? "")) return "today";
  // Measured 2026-08-26: the provider renamed the subscription ids and dropped
  // the /sports/ segment from the topic path, so every catalog receipt was
  // refused and the book went dark. A frame carrying BOTH a sportsbook
  // subscription id AND a live/today topic segment is a catalog receipt. Two
  // independent signals are required on purpose: the jackpot stream that shares
  // this socket's host carries neither, and one signal alone would admit it.
  if (/^subSport/u.test(subscription ?? "")) {
    if (/\/live\//u.test(destination ?? "")) return "live";
    if (/\/today\//u.test(destination ?? "")) return "today";
  }
  return null;
}

function receiptSequence(messageId?: string): number | null {
  const match = messageId === undefined ? null : /(?:^|[-:])(\d+)$/u.exec(messageId);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Why a partition payload is not a full snapshot, so a shape that changed on the
 * provider's side is named instead of inferred. Every predicate here is
 * all-or-nothing by design - a baseline missing a market is not a baseline - so
 * knowing which one refused is the difference between a fix and a guess. Names a
 * shape only; no destination, header or body value is ever recorded.
 */
function fullPartitionSnapshotRejection(payload: unknown): SnapshotRejection {
  let firstRejection: SnapshotRejection | null = null;
  for (const body of snapshotArrays(payload)) {
    const rejection = leagueArrayRejection(body);
    if (rejection === "NONE") return "NONE";
    firstRejection ??= rejection;
  }
  return firstRejection ?? "NOT_ARRAY";
}

/**
 * Where the league array can be found in a partition payload.
 *
 * Measured 2026-08-27: fifteen baseline payloads in one generation were refused
 * as NOT_ARRAY, because the provider now nests the leagues inside an object
 * rather than sending them at the top level. Only the search widens here - every
 * candidate still has to pass the full league and event check, so a wrapper that
 * holds some other array cannot pass as a baseline.
 */
function snapshotArrays(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload)) return [payload];
  const record = asRecord(payload);
  if (record === null) return [payload];
  const candidates: unknown[] = [];
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) candidates.push(value);
    else {
      const nested = asRecord(value);
      if (nested === null) continue;
      for (const inner of Object.values(nested)) if (Array.isArray(inner)) candidates.push(inner);
    }
  }
  return candidates.length > 0 ? candidates : [payload];
}

function leagueArrayRejection(body: unknown): SnapshotRejection {
  if (!Array.isArray(body)) return "NOT_ARRAY";
  let eventCount = 0;
  let decodableMarkets = 0;
  let rejection: SnapshotRejection = "NONE";
  const refuse = (reason: SnapshotRejection): false => {
    if (rejection === "NONE") rejection = reason;
    return false;
  };
  const valid = body.every((value) => {
    const league = asRecord(value);
    if (league === null || typeof league["1"] !== "string" || league["1"].trim() === "" ||
      !Array.isArray(league["2"])) return refuse("LEAGUE_SHAPE");
    return league["2"].every((candidate) => {
      const event = asRecord(candidate);
      const eventId = event?.["8"];
      const markets = event === null ? null : asRecord(event["7"]);
      if (event !== null) eventCount += 1;
      if (markets !== null && hasDecodableKsportMarket(markets)) decodableMarkets += 1;
      if (event === null) return refuse("LEAGUE_SHAPE");
      if (!(typeof eventId === "string" || typeof eventId === "number") ||
        !/^\d+$/u.test(String(eventId))) return refuse("EVENT_ID");
      if (typeof event["2"] !== "string" || event["2"].trim() === "" ||
        typeof event["3"] !== "string" || event["3"].trim() === "" ||
        event["2"].trim() === event["3"].trim()) return refuse("EVENT_TEAMS");
      if (markets === null) return refuse("EVENT_MARKETS");
      return true;
    });
  });
  if (!valid) return rejection;
  return eventCount === 0 || decodableMarkets > 0 ? "NONE" : "NO_DECODABLE_MARKET";
}

function isFullPartitionSnapshot(body: unknown): boolean {
  return fullPartitionSnapshotRejection(body) === "NONE";
}

const KSPORT_SUPPORTED_MARKET_GROUPS = new Set([
  "3", "4", "5", "6", "19", "20", "21", "22", "31", "32", "33", "34", "80", "85"
]);
const KSPORT_TOTAL_MARKET_GROUPS = new Set(["3", "4", "21", "22", "31", "32", "80"]);

function isSupportedKsportTwoWayLine(value: string | undefined): boolean {
  if (value === undefined || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return false;
  const quarterUnits = Math.abs(Number(value)) * 4;
  return Number.isFinite(quarterUnits) && Number.isInteger(quarterUnits) && quarterUnits % 4 !== 0;
}

function isEligibleKsportPrice(value: string | undefined, side: "h" | "a"): boolean {
  const match = /^(-?(?:0|1)(?:\.\d+)?)\*\d+([ha])$/u.exec(value ?? "");
  if (match === null || match[2] !== side) return false;
  const price = Number(match[1]);
  return Number.isFinite(price) && price !== 0 && Math.abs(price) <= 1;
}

function decodableKsportMarketIds(groups: Readonly<Record<string, unknown>>,
  firstOnly = false): readonly string[] {
  const marketIds = new Set<string>();
  for (const [groupKey, rows] of Object.entries(groups)) {
    if (!KSPORT_SUPPORTED_MARKET_GROUPS.has(groupKey) || !Array.isArray(rows)) continue;
    const isHandicap = !KSPORT_TOTAL_MARKET_GROUPS.has(groupKey);
    for (const row of rows) {
      if (typeof row !== "string") continue;
      const tokens = row.trim().split(/\s+/u);
      const first = isEligibleKsportPrice(tokens[1], "h");
      const second = isEligibleKsportPrice(tokens[2], "a");
      const marketId = tokens[isHandicap ? 4 : 3] ?? "";
      const favored = tokens[3] ?? "";
      if (isSupportedKsportTwoWayLine(tokens[0]) && first && second && /^\d{4,30}$/u.test(marketId) &&
        (!isHandicap || favored === "h" || favored === "a")) {
        marketIds.add(marketId);
        if (firstOnly) return [...marketIds];
      }
    }
  }
  return [...marketIds];
}

function hasDecodableKsportMarket(groups: Readonly<Record<string, unknown>>): boolean {
  return decodableKsportMarketIds(groups, true).length > 0;
}

function decodableKsportCatalogMarketKeys(body: unknown): readonly string[] {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: body, depth: 0 }];
  const marketKeys = new Set<string>();
  let visited = 0;
  while (pending.length > 0 && visited < 50_000) {
    const current = pending.pop()!;
    if (current.depth > 20 || current.value === null || typeof current.value !== "object") continue;
    visited += 1;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }
    const event = current.value as Record<string, unknown>;
    const eventId = event["8"];
    const home = event["2"];
    const away = event["3"];
    const markets = asRecord(event["7"]);
    if ((typeof eventId === "string" || typeof eventId === "number") && /^\d+$/u.test(String(eventId)) &&
      typeof home === "string" && home.trim() !== "" && typeof away === "string" && away.trim() !== "" &&
      home.trim() !== away.trim() && markets !== null) {
      for (const marketId of decodableKsportMarketIds(markets)) {
        marketKeys.add(`${String(eventId)}\u0000${marketId}`);
      }
    }
    const children = Object.values(event);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return [...marketKeys];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("KSPORT_RECOVERY_BOUND_INVALID");
  return value;
}
