import { utf8ByteLength } from "./utf8-length.js";
import {
  ChromeBridgeControlMessageSchema,
  type ChromeBridgeEnvelope,
  type ChromeBridgeControlMessage
} from "@tool-chenh/contracts";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const RECOVERY_LANES = 8;
const RECOVERY_OPERATION_TIMEOUT_MS = 90_000;

const LOOPBACK_URL = "ws://127.0.0.1:4310/api/chrome-bridge";

export interface BridgeSocket {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

interface QueueEntry {
  readonly envelope: ChromeBridgeEnvelope;
  readonly serialized: string;
  readonly bytes: number;
  readonly priority: "QUOTE" | "DIAGNOSTIC";
  readonly insertedAt: number;
  readonly settleAcknowledgement: (() => void) | null;
  sentGeneration: number | null;
}

interface SourceEpochAdmission {
  active: string | null;
  readonly retired: Set<string>;
  resyncing: boolean;
}

export interface LocalBridgeOptions {
  readonly socketFactory: (url: string, protocols: string[]) => BridgeSocket;
  readonly readinessProbe?: () => boolean | Promise<boolean>;
  readonly installationKey: string;
  readonly maxQueueBytes?: number;
  readonly now?: () => number;
  readonly livenessTimeoutMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onOpen?: () => void | Promise<void>;
  readonly onSnapshotRequest?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "REQUEST_SNAPSHOT" }>, "version" | "kind">) => void | Promise<void>;
  readonly onSourceResync?: (sourceId: string) => void | Promise<void>;
  readonly onSourceReload?: (sourceId: string) => void | Promise<void>;
  /** Identity of the bundle this worker is running, injected at build time. */
  readonly buildIdentity?: string;
  readonly onExtensionReload?: (buildIdentity: string) => void;
  readonly onSourceNavigate?: (sourceId: string, url: string) => void | Promise<void>;
  readonly onSourceEnsure?: (lobby: ChromeBridgeEnvelope["lobby"], url: string) => void | Promise<void>;
  readonly onSourceRestore?: (lobby: ChromeBridgeEnvelope["lobby"]) => void | Promise<void>;
  readonly onFocusSelection?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "FOCUS_SELECTION" }>, "version" | "kind">) => void | Promise<void>;
  readonly onSelectionPriceProbe?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind">) => void | Promise<void>;
  readonly onCmdHiddenMarketProbe?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_CMD_HIDDEN_MARKETS" }>, "version" | "kind">) => void | Promise<void>;
}

export class LocalBridge {
  readonly #socketFactory: LocalBridgeOptions["socketFactory"];
  readonly #readinessProbe: NonNullable<LocalBridgeOptions["readinessProbe"]>;
  readonly #installationKey: string;
  readonly #maxQueueBytes: number;
  readonly #now: () => number;
  readonly #livenessTimeoutMs: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onOpen: () => void | Promise<void>;
  readonly #onSnapshotRequest: NonNullable<LocalBridgeOptions["onSnapshotRequest"]>;
  readonly #onSourceResync: (sourceId: string) => void | Promise<void>;
  readonly #onSourceReload: (sourceId: string) => void | Promise<void>;
  readonly #buildIdentity: string | null;
  readonly #onExtensionReload: ((buildIdentity: string) => void) | null;
  readonly #onSourceNavigate: NonNullable<LocalBridgeOptions["onSourceNavigate"]>;
  readonly #onSourceEnsure: NonNullable<LocalBridgeOptions["onSourceEnsure"]>;
  readonly #onSourceRestore: NonNullable<LocalBridgeOptions["onSourceRestore"]>;
  readonly #onFocusSelection: NonNullable<LocalBridgeOptions["onFocusSelection"]>;
  readonly #onSelectionPriceProbe: NonNullable<LocalBridgeOptions["onSelectionPriceProbe"]>;
  readonly #onCmdHiddenMarketProbe: NonNullable<LocalBridgeOptions["onCmdHiddenMarketProbe"]>;
  readonly #queue: QueueEntry[] = [];
  readonly #queueSpaceWaiters = new Set<() => void>();
  // Recovery lanes are per source, but the scheduler's default cap of three
  // concurrent operations was shared by every provider. Measured 2026-09-01:
  // with three unfinished recoveries elsewhere, SABA's REQUEST_SNAPSHOT sat
  // queued for twenty minutes (baselineTabSelections stayed at 1 while the
  // API sent four attempts) and its socket was never reconnected. One lane
  // per provider, and no single recovery may hold its lane for longer than
  // the bound below - the operation keeps running, the lane is released.
  readonly #recoveryScheduler = new ProviderWorkScheduler({
    maxConcurrent: RECOVERY_LANES,
    onRejected: (error) => { console.warn("[fieldline] recovery request dropped", error.sourceId); }
  });
  // Source-tab creation/navigation has its own per-lobby lanes. A provider
  // bootstrap can wait on a page indefinitely, so sharing one global promise
  // chain allowed that provider to prevent SABA (and every later provider)
  // from ever receiving RESTORE_SOURCE.
  readonly #sourceRecoveryScheduler = new ProviderWorkScheduler({
    maxConcurrent: RECOVERY_LANES,
    onRejected: (error) => { console.warn("[fieldline] source recovery request dropped", error.sourceId); }
  });
  readonly #sourceEpochs = new Map<string, SourceEpochAdmission>();
  readonly #releasedSources = new Set<string>();
  #socket: BridgeSocket | null = null;
  #timer: unknown = null;
  #generation = 0;
  #reconnectAttempts = 0;
  #insertCounter = 0;
  #probeInFlight = false;
  #connectToken = 0;
  #closeOrdinal = 0;
  #lastServerContactAtMs = 0;

  constructor(options: LocalBridgeOptions) {
    if (!options.installationKey.trim()) throw new Error("INSTALLATION_KEY_REQUIRED");
    this.#socketFactory = options.socketFactory;
    this.#readinessProbe = options.readinessProbe ?? (() => true);
    this.#installationKey = options.installationKey;
    this.#maxQueueBytes = options.maxQueueBytes ?? 16 * 1024 * 1024;
    this.#now = options.now ?? Date.now;
    this.#livenessTimeoutMs = options.livenessTimeoutMs ?? 25_000;
    if (!Number.isFinite(this.#livenessTimeoutMs) || this.#livenessTimeoutMs < 1_000) {
      throw new Error("BRIDGE_LIVENESS_TIMEOUT_INVALID");
    }
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#onOpen = options.onOpen ?? (() => undefined);
    this.#onSnapshotRequest = options.onSnapshotRequest ?? (() => undefined);
    this.#onSourceResync = options.onSourceResync ??
      ((sourceId) => this.#onSnapshotRequest({ sourceId, prematchWindowHours: undefined }));
    this.#onSourceReload = options.onSourceReload ?? (() => undefined);
    this.#buildIdentity = options.buildIdentity ?? null;
    this.#onExtensionReload = options.onExtensionReload ?? null;
    this.#onSourceNavigate = options.onSourceNavigate ?? (() => undefined);
    this.#onSourceEnsure = options.onSourceEnsure ?? (() => undefined);
    this.#onSourceRestore = options.onSourceRestore ?? (() => undefined);
    this.#onFocusSelection = options.onFocusSelection ?? (() => undefined);
    this.#onSelectionPriceProbe = options.onSelectionPriceProbe ?? (() => undefined);
    this.#onCmdHiddenMarketProbe = options.onCmdHiddenMarketProbe ?? (() => undefined);
  }

  #queueBytes = 0;

  get queueBytes(): number {
    return this.#queueBytes;
  }

  #removeAt(index: number): void {
    const [removed] = this.#queue.splice(index, 1);
    if (removed === undefined) return;
    this.#queueBytes -= removed.bytes;
    removed.settleAcknowledgement?.();
    this.#notifyQueueSpace();
  }

  #notifyQueueSpace(): void {
    const waiters = [...this.#queueSpaceWaiters];
    this.#queueSpaceWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  pendingSequences(): number[] {
    return this.#ordered().map((entry) => entry.envelope.sequence);
  }

  releaseSource(sourceId: string): void {
    this.#releasedSources.add(sourceId);
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      if (this.#queue[index]?.envelope.sourceId === sourceId) this.#removeAt(index);
    }
    this.#recoveryScheduler.clear(sourceId);
  }

  async enqueue(envelope: ChromeBridgeEnvelope, priority: QueueEntry["priority"] = "QUOTE"): Promise<void> {
    if (!this.#admitSourceEpoch(envelope.sourceId, envelope.sourceEpoch ?? null)) return;
    const closeOrdinal = this.#closeOrdinal;
    const serialized = JSON.stringify(envelope);
    const waitsForIndividualAcknowledgement = (envelope.lobby === "KSPORT" &&
      envelope.transport === "HTTP_RESPONSE"
      && "providerContentIntent" in envelope.request
      && envelope.request.providerContentIntent === "FOOTBALL_FULL_CATALOG") ||
      isBtiAuthFailureEnvelope(envelope);
    let settleAcknowledgement: (() => void) | null = null;
    const acknowledgement = waitsForIndividualAcknowledgement
      ? new Promise<void>((resolve) => { settleAcknowledgement = resolve; })
      : null;
    const entry: QueueEntry = {
      envelope,
      serialized,
      bytes: utf8ByteLength(serialized),
      priority,
      insertedAt: this.#insertCounter++,
      settleAcknowledgement,
      sentGeneration: null
    };
    if (entry.bytes > this.#maxQueueBytes) throw new Error("BRIDGE_QUEUE_ITEM_TOO_LARGE");
    // Every envelope consumes a source sequence ordinal. Dropping ordinary
    // socket/DOM traffic when the bounded queue fills creates an artificial
    // gap, and resyncing that source under the same load repeats forever.
    // Backpressure all producers at the byte boundary; #emit already has one
    // serialized lane per source, so this remains bounded without allowing a
    // busy provider to accumulate unbounded pending work in the bridge.
    while (this.queueBytes + entry.bytes > this.#maxQueueBytes) {
      await new Promise<void>((resolve) => this.#queueSpaceWaiters.add(resolve));
      if (this.#closeOrdinal !== closeOrdinal) return;
      if (!this.#admitSourceEpoch(envelope.sourceId, envelope.sourceEpoch ?? null)) return;
    }
    this.#queue.push(entry);
    this.#queueBytes += entry.bytes;
    this.#flush();
    if (acknowledgement !== null) await acknowledgement;
  }

  /** True while a readiness probe is still holding connect() off. */
  readinessLatched(): boolean {
    return this.#probeInFlight;
  }

  /** How long since the server last said anything on this bridge. */
  serverContactAgeMs(nowMs = this.#now()): number {
    return nowMs - this.#lastServerContactAtMs;
  }

  connect(): void {
    if (this.#socket && (this.#socket.readyState === 0 || this.#socket.readyState === 1)) {
      if (this.#now() - this.#lastServerContactAtMs <= this.#livenessTimeoutMs) return;
      const staleSocket = this.#socket;
      this.#socket = null;
      staleSocket.close();
    }
    if (this.#probeInFlight) return;
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    const token = ++this.#connectToken;
    let readiness: boolean | Promise<boolean>;
    try {
      readiness = this.#readinessProbe();
    } catch {
      this.#scheduleReconnect();
      return;
    }
    if (typeof (readiness as Promise<boolean>)?.then === "function") {
      this.#probeInFlight = true;
      // The latch must be released on every settlement, including the one whose
      // token has moved on. Leaving it set makes connect() return early for the
      // life of the worker, and the whole bridge then dies together with no
      // reconnect: exactly the observed failure.
      void Promise.resolve(readiness).then((ready) => {
        this.#probeInFlight = false;
        if (token !== this.#connectToken) return;
        if (ready) this.#openSocket();
        else this.#scheduleReconnect();
      }).catch(() => {
        this.#probeInFlight = false;
        if (token !== this.#connectToken) return;
        this.#scheduleReconnect();
      });
      return;
    }
    if (!readiness) {
      this.#scheduleReconnect();
      return;
    }
    this.#openSocket();
  }

  #openSocket(): void {
    let socket: BridgeSocket;
    try {
      socket = this.#socketFactory(LOOPBACK_URL, ["tool-chenh.v1", this.#installationKey]);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    this.#lastServerContactAtMs = this.#now();
    const generation = ++this.#generation;
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#reconnectAttempts = 0;
      for (const entry of this.#queue) entry.sentGeneration = null;
      // An ACK from the retiring API process can leave a hole in a source's
      // local backlog just before the WebSocket is replaced (for example
      // [0, 1, 2] becomes [0, 2]). A fresh API has no way to distinguish that
      // split history and will correctly reject the replay forever. Detect the
      // hole before sending anything and publish one new authoritative epoch.
      for (const source of this.#discontinuousQueuedSources()) {
        this.#requestSourceResync(source.sourceId, source.sourceEpoch);
      }
      this.#flush(generation);
      try { void Promise.resolve(this.#onOpen()).catch(() => undefined); }
      catch { /* replay failure must not close the bridge */ }
    };
    socket.onmessage = (event) => {
      if (this.#socket !== socket || this.#generation !== generation) return;
      this.#handleMessage(event.data, generation);
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect(): void {
    if (this.#timer !== null) return;
    const delayMs = Math.min(30_000, 500 * 2 ** this.#reconnectAttempts++);
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      this.connect();
    }, delayMs);
  }

  close(): void {
    this.#closeOrdinal += 1;
    this.#connectToken++;
    this.#probeInFlight = false;
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    for (const entry of this.#queue) entry.settleAcknowledgement?.();
    this.#notifyQueueSpace();
  }

  #ordered(entries: readonly QueueEntry[] = this.#queue): QueueEntry[] {
    return [...entries].sort((left, right) =>
      (left.envelope.sourceId < right.envelope.sourceId ? -1 : left.envelope.sourceId > right.envelope.sourceId ? 1 : 0)
      || left.envelope.sequence - right.envelope.sequence
      || left.insertedAt - right.insertedAt);
  }

  #discontinuousQueuedSources(): Array<{ sourceId: string; sourceEpoch: string | null }> {
    const grouped = new Map<string, QueueEntry[]>();
    for (const entry of this.#queue) {
      const entries = grouped.get(entry.envelope.sourceId) ?? [];
      entries.push(entry);
      grouped.set(entry.envelope.sourceId, entries);
    }
    const discontinuous: Array<{ sourceId: string; sourceEpoch: string | null }> = [];
    for (const [sourceId, entries] of grouped) {
      if (entries.length < 2) continue;
      const ordered = this.#ordered(entries);
      const sourceEpoch = ordered[0]!.envelope.sourceEpoch ?? null;
      const hasGap = ordered.some((entry, index) => {
        if ((entry.envelope.sourceEpoch ?? null) !== sourceEpoch) return true;
        return index > 0 && entry.envelope.sequence !== ordered[index - 1]!.envelope.sequence + 1;
      });
      if (hasGap) discontinuous.push({ sourceId, sourceEpoch });
    }
    return discontinuous;
  }

  #flush(generation = this.#generation): void {
    if (!this.#socket || this.#socket.readyState !== 1) return;
    // Entries already sent in this generation wait for their ACK; only the
    // unsent tail needs ordering, not the whole queue on every enqueue.
    const unsent = this.#queue.filter((entry) => entry.sentGeneration !== generation);
    if (unsent.length === 0) return;
    for (const entry of unsent.length === 1 ? unsent : this.#ordered(unsent)) {
      this.#socket.send(entry.serialized);
      entry.sentGeneration = generation;
    }
  }

  #handleMessage(raw: unknown, generation: number): void {
    if (typeof raw !== "string") return;
    try {
      const parsed = ChromeBridgeControlMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      this.#lastServerContactAtMs = this.#now();
      if (parsed.data.kind === "REQUEST_SNAPSHOT") {
        const { sourceId, prematchWindowHours } = parsed.data;
        this.#enqueueSnapshotRecovery({ sourceId, prematchWindowHours });
        return;
      }
      if (parsed.data.kind === "RELOAD_EXTENSION") {
        // Only a worker that knows its own bundle can tell a newer deployment
        // from its own. Without that it must stay put: reloading on every
        // announcement would restart the worker forever.
        const deployed = parsed.data.buildIdentity;
        if (this.#buildIdentity === null || this.#buildIdentity === deployed) return;
        try { this.#onExtensionReload?.(deployed); }
        catch { /* a failed reload must not disrupt the bridge */ }
        return;
      }
      if (parsed.data.kind === "RELOAD_SOURCE") {
        try { void Promise.resolve(this.#onSourceReload(parsed.data.sourceId)).catch(() => undefined); }
        catch { /* tab recovery must not disrupt the bridge */ }
        return;
      }
      if (parsed.data.kind === "NAVIGATE_SOURCE") {
        try { void Promise.resolve(this.#onSourceNavigate(parsed.data.sourceId, parsed.data.url)).catch(() => undefined); }
        catch { /* fresh launch recovery must not disrupt the bridge */ }
        return;
      }
      if (parsed.data.kind === "ENSURE_SOURCE") {
        const { lobby, url } = parsed.data;
        this.#enqueueSourceRecovery(lobby, () => this.#onSourceEnsure(lobby, url));
        return;
      }
      if (parsed.data.kind === "RESTORE_SOURCE") {
        const { lobby } = parsed.data;
        this.#enqueueSourceRecovery(lobby, () => this.#onSourceRestore(lobby));
        return;
      }
      if (parsed.data.kind === "FOCUS_SELECTION") {
        const { sourceId, providerEventId, providerMarketId, providerSelectionId } = parsed.data;
        try { void Promise.resolve(this.#onFocusSelection({ sourceId, providerEventId,
          providerMarketId, providerSelectionId })).catch(() => undefined); }
        catch { /* focus failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "PROBE_SELECTION_PRICE") {
        const { sourceId, requestId, providerEventId, providerMarketId, providerSelectionId,
          eventLabel, participantA, participantB, marketType, scope, selection, line } = parsed.data;
        try { void Promise.resolve(this.#onSelectionPriceProbe({ sourceId, requestId, providerEventId,
          providerMarketId, providerSelectionId, eventLabel, participantA, participantB,
          marketType, scope, selection, line }))
          .catch(() => undefined); }
        catch { /* visible price probe failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "PROBE_CMD_HIDDEN_MARKETS") {
        const { sourceId, requestId, providerEventId } = parsed.data;
        try { void Promise.resolve(this.#onCmdHiddenMarketProbe({ sourceId, requestId, providerEventId }))
          .catch(() => undefined); }
        catch { /* probe failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "REJECT") {
        const rejection = parsed.data;
        if (rejection.sourceId === null) return;
        if (rejection.reason === "SEQUENCE_GAP") {
          // A bounded/offline queue can legitimately coalesce old frames. If
          // the API restarts while such a hole exists, replaying that same
          // backlog would make the server close every new socket forever.
          // Drop only the rejected source and republish its authoritative
          // snapshot; healthy sources remain queued and connected.
          const rejected = this.#queue.find((entry) => entry.envelope.sourceId === rejection.sourceId
            && entry.envelope.sequence === rejection.sequence && entry.sentGeneration === generation &&
            controlEpochMatches(entry, rejection.sourceEpoch));
          if (rejected === undefined) return;
          this.#requestSourceResync(rejection.sourceId, rejected?.envelope.sourceEpoch ?? null);
          return;
        }
        if (rejection.sequence !== null) {
          const index = this.#queue.findIndex((entry) => entry.envelope.sourceId === rejection.sourceId
            && entry.envelope.sequence === rejection.sequence && entry.sentGeneration === generation &&
            controlEpochMatches(entry, rejection.sourceEpoch));
          if (index >= 0) this.#removeAt(index);
        }
        return;
      }
      if (parsed.data.kind !== "ACK") return;
      const acknowledgement = parsed.data;
      const index = this.#queue.findIndex((entry) =>
        entry.envelope.sourceId === acknowledgement.sourceId
        && entry.envelope.sequence === acknowledgement.sequence
        && entry.sentGeneration === generation
        && controlEpochMatches(entry, acknowledgement.sourceEpoch));
      if (index >= 0) this.#removeAt(index);
    } catch {
      // Invalid control traffic cannot mutate the send queue.
    }
  }

  #enqueueSourceRecovery(lobby: ChromeBridgeEnvelope["lobby"], task: () => void | Promise<void>): void {
    // RESTORE_SOURCE is retried by the API while the first recovery is still
    // running. Keeping one duplicate queued means it fires after the healthy
    // tab comes back and needlessly replaces that fresh source epoch again.
    // Drop only requests that overlap an active/queued recovery; a later retry
    // is accepted as soon as the bounded lane has been released.
    if (this.#sourceRecoveryScheduler.isBusy(lobby)) return;
    void this.#sourceRecoveryScheduler.run(lobby, async () => {
      let operation: Promise<void>;
      try { operation = Promise.resolve(task()); }
      catch { return; }
      try { await this.#boundedRecovery(`source:${lobby}`, operation); }
      catch { /* one source failure must not block this provider's next recovery */ }
    }).catch(() => undefined);
  }

  #enqueueSnapshotRecovery(request: Parameters<NonNullable<LocalBridgeOptions["onSnapshotRequest"]>>[0]): void {
    void this.#recoveryScheduler.run(request.sourceId, async () => {
      try { await this.#boundedRecovery(request.sourceId, Promise.resolve(this.#onSnapshotRequest(request))); }
      catch { /* one snapshot failure must not block the next provider */ }
    }).catch(() => undefined);
  }

  async #boundedRecovery(sourceId: string, operation: Promise<void>): Promise<void> {
    let handle: unknown = null;
    const expiry = new Promise<void>((_resolve, reject) => {
      handle = this.#setTimer(() => {
        console.warn("[fieldline] recovery lane released after timeout", sourceId);
        reject(new Error("RECOVERY_OPERATION_TIMEOUT"));
      }, RECOVERY_OPERATION_TIMEOUT_MS);
    });
    try {
      await Promise.race([operation, expiry]);
    } finally {
      if (handle !== null) this.#clearTimer(handle);
      // The lane is free once the race settles; a still-pending operation must
      // not surface as an unhandled rejection later.
      operation.catch(() => undefined);
    }
  }

  #requestSourceResync(sourceId: string, sourceEpoch: string | null): void {
    const state = this.#sourceEpochs.get(sourceId) ?? { active: sourceEpoch, retired: new Set<string>(),
      resyncing: false };
    this.#sourceEpochs.set(sourceId, state);
    if (state.resyncing) return;
    const queuedEpoch = this.#queue.find((entry) => entry.envelope.sourceId === sourceId)?.envelope.sourceEpoch;
    for (const candidate of [state.active, queuedEpoch ?? null, sourceEpoch]) {
      if (candidate !== null && candidate !== undefined) state.retired.add(candidate);
    }
    state.resyncing = true;
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      if (this.#queue[index]?.envelope.sourceId === sourceId) this.#removeAt(index);
    }
    // Explicit resync supersedes an unsent ordinary snapshot request for this
    // source. An already-running provider operation remains ordered ahead of
    // the resync, while unrelated providers retain independent lanes.
    this.#recoveryScheduler.clear(sourceId);
    void this.#recoveryScheduler.run(sourceId, async () => {
      // Recovery may finish without emitting data immediately: the next
      // provider heartbeat will carry the replacement public epoch. Keep the
      // shared loopback socket open while waiting for it. Closing this socket
      // to repair one source also releases every healthy provider from the API
      // registry and was the cause of the all-source presence churn.
      await this.#onSourceResync(sourceId);
    }).catch(() => undefined);
  }

  #admitSourceEpoch(sourceId: string, sourceEpoch: string | null): boolean {
    if (this.#releasedSources.has(sourceId)) return false;
    const existing = this.#sourceEpochs.get(sourceId);
    if (existing === undefined) {
      this.#sourceEpochs.set(sourceId, { active: sourceEpoch, retired: new Set<string>(), resyncing: false });
      return true;
    }
    if (sourceEpoch !== null && existing.retired.has(sourceEpoch)) return false;
    if (existing.resyncing) {
      if (sourceEpoch === null || sourceEpoch === existing.active) return false;
      existing.active = sourceEpoch;
      existing.resyncing = false;
      return true;
    }
    if (existing.active === sourceEpoch) return true;
    if (sourceEpoch === null) return false;
    if (existing.active !== null) existing.retired.add(existing.active);
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      if (this.#queue[index]?.envelope.sourceId === sourceId) this.#removeAt(index);
    }
    existing.active = sourceEpoch;
    return true;
  }

}

function controlEpochMatches(entry: QueueEntry, sourceEpoch: string | undefined): boolean {
  // Older local APIs did not echo the epoch. Keep that compatibility path,
  // while current peers bind every ACK/REJECT to the exact public epoch so a
  // delayed control message can never remove or retire its replacement.
  return sourceEpoch === undefined || entry.envelope.sourceEpoch === sourceEpoch;
}

function isBtiAuthFailureEnvelope(envelope: ChromeBridgeEnvelope): boolean {
  if (envelope.lobby !== "BTI" || envelope.transport !== "TAB_STATE" ||
    envelope.request.hostname !== "prod20091.fxf774.com" ||
    envelope.request.pathnameClass !== "/__fieldline_heartbeat__" ||
    envelope.payload.encoding !== "UTF8" || envelope.payload.body.length > 160) return false;
  try {
    const value = JSON.parse(envelope.payload.body) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return candidate.kind === "PAGE_HEALTH" && candidate.status === "AUTH_ERROR" &&
      candidate.code === "1008";
  } catch {
    return false;
  }
}
