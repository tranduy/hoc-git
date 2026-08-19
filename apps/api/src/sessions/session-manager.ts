import type {
  Category,
  RedactedSessionStatus,
  SessionHealthReason,
  SessionSource,
  SessionState,
  SessionStatusList
} from "@tool-chenh/contracts";
import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { FabetJitProvider, LaunchCandidate } from "./fabet-browser.js";
import { SecretVault } from "./secret-vault.js";
import type {
  ActiveSecretHandle,
  ProviderSecret,
  ProviderSecretKind,
  SecretRecord,
  SessionValidationResult
} from "./types.js";
import { VaultError } from "./types.js";
import { SessionValidatorRegistry } from "./validators.js";
import type { AuthEgress } from "./auth-egress.js";
import {
  type RecoverySignal,
  recoveryDelayMs,
  requiresAuthentication,
} from "./session-recovery-policy.js";

const renewalIntervalMs = 86_400_000;
const recordPrefix = "session-";

interface StoredSession {
  readonly version: 1;
  readonly id: string;
  readonly provider: string;
  readonly category: Category | null;
  readonly source: SessionSource;
  readonly state: SessionState;
  readonly trustedHostname: string | null;
  readonly acquiredAtMs: number | null;
  readonly lastValidatedAtMs: number | null;
  readonly renewAfterMs: number | null;
  readonly reason: SessionHealthReason | null;
  readonly nextRetryAtMs?: number | null;
  readonly secret: ProviderSecret;
}

export interface ConfigureManualInput {
  readonly provider: string;
  readonly category?: Category;
  readonly kind: Exclude<ProviderSecretKind, "FABET_CREDENTIALS" | "TK88_PROFILE">;
  readonly secret: string;
}

export interface ConfigureFabetInput {
  readonly entryUrl: string;
  readonly username: string;
  readonly password: string;
  readonly trustedHostname: string;
}

export interface ConfigureTk88Input {
  readonly trustedHostname: string;
}

export type FabetDerivedProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";

export interface FabetCredentialSource {
  readonly id: string;
  readonly priority: number;
  readonly rootUrl: "https://fabet.com/";
}

export interface SessionRecoveryRequest {
  readonly credentialSourceId: string;
  readonly providers: readonly FabetDerivedProvider[];
  readonly signal: RecoverySignal;
}

export interface SessionManagerOptions {
  readonly vault: SecretVault;
  readonly validators: SessionValidatorRegistry;
  readonly clock: { nowMs(): number };
  readonly idFactory: () => string;
  readonly fabetDriver?: {
    login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void>;
    authenticateWithEgresses?(input: { readonly username: string; readonly password: string;
      readonly egresses: readonly AuthEgress[]; readonly timeoutMs?: number }): Promise<void>;
    captureLobbyLaunches(categories?: readonly Category[]): Promise<readonly LaunchCandidate[]>;
    withProviderPage?<T>(provider: FabetJitProvider, category: Category, consume: (page: Page) => Promise<T>): Promise<T>;
    resetProfile(): Promise<void>;
  };
  readonly fabetAuthEgresses?: readonly AuthEgress[];
  readonly resetFabetState?: () => Promise<void>;
  readonly resetTk88State?: () => Promise<void>;
  readonly initializeTk88State?: (hostname: string) => Promise<void>;
}

function isFiniteTimestamp(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function parseStoredSession(value: SecretRecord | null): StoredSession | null {
  if (value === null || value.version !== 1 || typeof value.id !== "string" || typeof value.provider !== "string") return null;
  const source = value.source;
  const state = value.state;
  const reason = value.reason;
  const secret = value.secret;
  const validSources = new Set<SessionSource>(["FABET_LOGIN", "TK88_CHROME", "MANUAL_PROVIDER_SESSION"]);
  const validStates = new Set<SessionState>(["UNCONFIGURED", "VALIDATING", "ACTIVE", "RENEWING", "ACTION_REQUIRED", "INVALID"]);
  const validReasons = new Set<SessionHealthReason>([
    "UNREACHABLE", "DOMAIN_APPROVAL_REQUIRED", "UNAUTHORIZED", "EXPIRED",
    "SCHEMA_CHANGED", "VAULT_UNAVAILABLE", "RESET_FAILED", "AUTH_EGRESS_UNAVAILABLE",
    "INTERACTIVE_AUTH_REQUIRED", "AUTH_BACKOFF", "PROVIDER_VALIDATION_FAILED"
  ]);
  if (!validSources.has(source as SessionSource) || !validStates.has(state as SessionState)) return null;
  if (reason !== null && !validReasons.has(reason as SessionHealthReason)) return null;
  if (value.trustedHostname !== null && typeof value.trustedHostname !== "string") return null;
  if (!isFiniteTimestamp(value.acquiredAtMs) || !isFiniteTimestamp(value.lastValidatedAtMs) || !isFiniteTimestamp(value.renewAfterMs)) return null;
  if (typeof secret !== "object" || secret === null) return null;
  const secretFields = secret as Record<string, unknown>;
  if (
    !["TOKEN", "COOKIE_BUNDLE", "LAUNCH_URL", "FABET_CREDENTIALS", "TK88_PROFILE"].includes(String(secretFields.kind)) ||
    typeof secretFields.value !== "string"
  ) return null;
  const category = value.category === "FOOTBALL" || value.category === "LOL" ? value.category : null;
  return { ...(value as unknown as StoredSession), category };
}

function publicStatus(record: StoredSession): RedactedSessionStatus {
  return {
    id: record.id,
    provider: record.provider,
    category: record.category,
    source: record.source,
    state: record.state,
    trustedHostname: record.trustedHostname,
    acquiredAtMs: record.acquiredAtMs,
    lastValidatedAtMs: record.lastValidatedAtMs,
    renewAfterMs: record.renewAfterMs,
    nextRetryAtMs: record.nextRetryAtMs ?? null,
    secretConfigured: record.secret.value.length > 0,
    reason: record.reason
  };
}

function trustedFabetEntryUrl(entryUrl: string, trustedHostname: string | null): string {
  if (trustedHostname === null) return entryUrl;
  try {
    const trusted = new URL(`https://${trustedHostname}/`);
    if (trusted.hostname !== trustedHostname.toLowerCase() || trusted.username !== "" || trusted.password !== "") {
      return entryUrl;
    }
    const configured = new URL(entryUrl);
    return configured.protocol === "https:" && configured.hostname === trusted.hostname ? entryUrl : trusted.toString();
  } catch {
    return entryUrl;
  }
}

export class SessionManager {
  readonly #vault: SecretVault;
  readonly #validators: SessionValidatorRegistry;
  readonly #clock: { nowMs(): number };
  readonly #idFactory: () => string;
  readonly #fabetDriver: SessionManagerOptions["fabetDriver"];
  readonly #fabetAuthEgresses: readonly AuthEgress[];
  readonly #resetFabetState: () => Promise<void>;
  readonly #resetTk88State: () => Promise<void>;
  readonly #initializeTk88State: (hostname: string) => Promise<void>;
  readonly #inflight = new Map<string, Promise<RedactedSessionStatus>>();
  readonly #recordCache = new Map<string, StoredSession>();
  #allRecordsHydrated = false;
  #recordHydration: Promise<StoredSession[]> | null = null;
  readonly #fabetRehydrations = new Map<string, Promise<void>>();
  readonly #fabetRecoveryFailures = new Map<string, number>();

  constructor(options: SessionManagerOptions) {
    this.#vault = options.vault;
    this.#validators = options.validators;
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
    this.#fabetDriver = options.fabetDriver;
    this.#fabetAuthEgresses = options.fabetAuthEgresses ?? [];
    this.#resetFabetState = options.resetFabetState ?? (async () => undefined);
    this.#resetTk88State = options.resetTk88State ?? (async () => undefined);
    this.#initializeTk88State = options.initializeTk88State ?? (async () => undefined);
  }

  async configureManual(input: ConfigureManualInput): Promise<RedactedSessionStatus> {
    const provider = input.provider.trim().toUpperCase();
    if (provider.length === 0 || input.secret.length === 0) throw new Error("Invalid manual session configuration");
    const nowMs = this.#clock.nowMs();
    const record: StoredSession = {
      version: 1,
      id: this.#idFactory(),
      provider,
      category: input.category ?? null,
      source: "MANUAL_PROVIDER_SESSION",
      state: "VALIDATING",
      trustedHostname: input.kind === "LAUNCH_URL" ? this.#hostname(input.secret) : null,
      acquiredAtMs: nowMs,
      lastValidatedAtMs: null,
      renewAfterMs: nowMs + renewalIntervalMs,
      reason: null,
      secret: { kind: input.kind, value: input.secret }
    };
    await this.#save(record);
    return this.validate(record.id);
  }

  async configureFabet(input: ConfigureFabetInput): Promise<RedactedSessionStatus> {
    // A 24-hour renewal may still be writing the previous encrypted record.
    // Let it finish before replacing credentials so the stale renewal can never
    // overwrite a newer operator configuration.
    const pending = this.#inflight.get("fabet");
    if (pending !== undefined) await pending.catch(() => undefined);

    if (input.username.length === 0 || input.password.length === 0) throw new Error("Invalid Fabet configuration");
    const nowMs = this.#clock.nowMs();
    const record: StoredSession = {
      version: 1,
      id: "fabet",
      provider: "FABET",
      category: null,
      source: "FABET_LOGIN",
      state: "VALIDATING",
      trustedHostname: "fabet.com",
      acquiredAtMs: nowMs,
      lastValidatedAtMs: null,
      renewAfterMs: nowMs + renewalIntervalMs,
      reason: null,
      secret: {
        kind: "FABET_CREDENTIALS",
        value: JSON.stringify({ entryUrl: "https://fabet.com/", username: input.username, password: input.password })
      }
    };
    await this.#save(record);
    if (this.#fabetDriver === undefined) return this.#transition(record, "ACTION_REQUIRED", "SCHEMA_CHANGED");
    try {
      await this.#loginFabet(input.username, input.password);
      await this.#ingestFabetLaunches(await this.#fabetDriver.captureLobbyLaunches(["FOOTBALL"]));
      const active: StoredSession = {
        ...record,
        state: "ACTIVE",
        lastValidatedAtMs: this.#clock.nowMs(),
        reason: null
      };
      await this.#save(active);
      return publicStatus(active);
    } catch (error) {
      return this.#transition(record, "INVALID", this.#fabetFailureReason(error));
    }
  }

  async configureTk88(input: ConfigureTk88Input): Promise<RedactedSessionStatus> {
    const hostname = input.trustedHostname.trim().toLowerCase();
    if (hostname.length === 0 || this.#hostname(`https://${hostname}/`) !== hostname) {
      throw new Error("Invalid TK88 profile configuration");
    }
    const nowMs = this.#clock.nowMs();
    const record: StoredSession = {
      version: 1,
      id: "tk88",
      provider: "TK88",
      category: null,
      source: "TK88_CHROME",
      state: "ACTION_REQUIRED",
      trustedHostname: hostname,
      acquiredAtMs: nowMs,
      lastValidatedAtMs: null,
      renewAfterMs: null,
      reason: "SCHEMA_CHANGED",
      secret: { kind: "TK88_PROFILE", value: "managed-profile:tk88:v1" }
    };
    await this.#save(record);
    try {
      await this.#initializeTk88State(hostname);
      return publicStatus(record);
    } catch {
      return this.#transition(record, "INVALID", "UNREACHABLE");
    }
  }

  validate(id: string): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => {
      const record = await this.#loadRequired(id);
      const validating = { ...record, state: "VALIDATING" as const, reason: null };
      await this.#save(validating);
      const validator = this.#validators.get(record.provider);
      if (validator === null) return this.#transition(validating, "ACTION_REQUIRED", "SCHEMA_CHANGED");
      let result: SessionValidationResult;
      try {
        result = await validator.validate(record.secret);
      } catch {
        return this.#transition(validating, "INVALID", "UNREACHABLE");
      }
      if (!result.ok && (result.reason === "UNAUTHORIZED" || result.reason === "EXPIRED")) {
        return this.#renewRecord(validating, result.reason);
      }
      if (!result.ok) return this.#transition(validating, "INVALID", result.reason);
      const active: StoredSession = {
        ...validating,
        state: "ACTIVE",
        lastValidatedAtMs: this.#clock.nowMs(),
        reason: null
      };
      await this.#save(active);
      return publicStatus(active);
    });
  }

  renew(id: string): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => this.#renewRecord(await this.#loadRequired(id), "EXPIRED"));
  }

  refreshFabetLaunches(id = "fabet"): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => {
      const current = await this.#loadRequired(id);
      if (current.source !== "FABET_LOGIN" || current.secret.kind !== "FABET_CREDENTIALS" ||
        this.#fabetDriver === undefined) throw new Error("FABET_SESSION_UNAVAILABLE");

      // This is background source repair, not credential renewal. Do not put
      // the saved parent into RENEWING/INVALID before the replacement launch
      // set has been captured successfully; a transient login failure must
      // leave the currently working catalogs and session identities intact.
      await this.#rehydrateFabet(id);
      await this.#ingestFabetLaunches(await this.#fabetDriver.captureLobbyLaunches(["FOOTBALL"]));
      const nowMs = this.#clock.nowMs();
      const active: StoredSession = {
        ...current,
        state: "ACTIVE",
        acquiredAtMs: nowMs,
        lastValidatedAtMs: nowMs,
        renewAfterMs: nowMs + renewalIntervalMs,
        reason: null,
        nextRetryAtMs: null
      };
      await this.#save(active);
      return publicStatus(active);
    });
  }

  reclassify(id: string, targetProvider: string): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => {
      const current = await this.#loadRequired(id);
      const provider = targetProvider.trim().toUpperCase();
      const validator = this.#validators.get(provider);
      if (validator === null || current.secret.kind !== "LAUNCH_URL") throw new Error("PROVIDER_RECLASSIFICATION_REJECTED");
      let result: SessionValidationResult;
      try { result = await validator.validate(current.secret); }
      catch { throw new Error("PROVIDER_RECLASSIFICATION_REJECTED"); }
      if (!result.ok) throw new Error("PROVIDER_RECLASSIFICATION_REJECTED");
      const nowMs = this.#clock.nowMs();
      const reclassified: StoredSession = { ...current, provider, state: "ACTIVE", reason: null,
        lastValidatedAtMs: nowMs, renewAfterMs: nowMs + renewalIntervalMs };
      await this.#save(reclassified);
      return publicStatus(reclassified);
    });
  }

  async tick(): Promise<void> {
    const nowMs = this.#clock.nowMs();
    const due = (record: StoredSession): boolean => record.state === "ACTIVE" &&
      record.renewAfterMs !== null && nowMs >= record.renewAfterMs;
    const initial = await this.#listRecords();
    const needsFabetRecovery = this.#needsFabetRecovery(initial);
    const fabetParents = initial.filter((record) => record.source === "FABET_LOGIN" &&
      record.secret.kind === "FABET_CREDENTIALS" &&
      (record.state === "RENEWING" ||
        (record.state === "ACTIVE" && (due(record) || needsFabetRecovery)) ||
        ((record.state === "INVALID" || record.state === "ACTION_REQUIRED") &&
          (record.nextRetryAtMs === null || record.nextRetryAtMs === undefined || nowMs >= record.nextRetryAtMs))));
    // A Fabet refresh replaces its derived one-time launch URLs. Renewing the
    // children concurrently first marks them expired, so the parent can no
    // longer preserve their verified identity. Parent-first keeps a verified
    // Football lounge active while its URL is atomically replaced.
    await Promise.all(fabetParents.map(async (record) => { await this.#renewFabetParent(record.id, nowMs); }));
    const parentIds = new Set(fabetParents.map((record) => record.id));
    const refreshed = fabetParents.length === 0 ? initial : await this.#listRecords();
    await Promise.all(refreshed.filter((record) => !parentIds.has(record.id) && due(record))
      .map(async (record) => { await this.#renewDue(record.id, nowMs); }));
  }

  async listStatuses(): Promise<SessionStatusList> {
    return { sessions: (await this.#listRecords()).map(publicStatus) };
  }

  async reportProviderFailure(request: SessionRecoveryRequest): Promise<RedactedSessionStatus> {
    if ((request.providers as readonly string[]).includes("CMD")) {
      throw new Error("CMD is independent and cannot use Fabet credential recovery");
    }
    const record = await this.#loadRequired(request.credentialSourceId);
    if (record.source !== "FABET_LOGIN" || record.secret.kind !== "FABET_CREDENTIALS") {
      throw new Error("FABET_CREDENTIAL_SOURCE_NOT_FOUND");
    }
    const nowMs = this.#clock.nowMs();
    if (!requiresAuthentication(request.signal, nowMs)) return publicStatus(record);
    if (record.nextRetryAtMs !== null && record.nextRetryAtMs !== undefined && nowMs < record.nextRetryAtMs) {
      return publicStatus(record);
    }

    try {
      await this.#rehydrateFabet(request.credentialSourceId);
      if (this.#fabetDriver === undefined) throw new Error("FABET_SESSION_UNAVAILABLE");
      const launches = await this.#fabetDriver.captureLobbyLaunches(["FOOTBALL"]);
      await this.#ingestFabetLaunches(launches);
      const records = await this.#listRecords();
      const validatedProviders = new Set(launches.flatMap((launch) => {
        const validated = records.some((candidate) =>
          candidate.source === "FABET_LOGIN" &&
          candidate.provider === launch.providerHint &&
          candidate.category === launch.category &&
          candidate.trustedHostname === launch.hostname &&
          candidate.acquiredAtMs === launch.capturedAtMs &&
          candidate.state === "ACTIVE" &&
          candidate.lastValidatedAtMs !== null
        );
        return validated ? [launch.providerHint] : [];
      }));
      if (request.providers.some((provider) => !validatedProviders.has(provider))) {
        throw new Error("PROVIDER_VALIDATION_FAILED");
      }
      const active: StoredSession = {
        ...(await this.#loadRequired(request.credentialSourceId)),
        state: "ACTIVE",
        reason: null,
        nextRetryAtMs: null,
        acquiredAtMs: nowMs,
        lastValidatedAtMs: nowMs,
        renewAfterMs: nowMs + renewalIntervalMs,
      };
      this.#fabetRecoveryFailures.delete(request.credentialSourceId);
      await this.#save(active);
      return publicStatus(active);
    } catch (error) {
      const failures = (this.#fabetRecoveryFailures.get(request.credentialSourceId) ?? 0) + 1;
      this.#fabetRecoveryFailures.set(request.credentialSourceId, failures);
      const failed: StoredSession = {
        ...(await this.#loadRequired(request.credentialSourceId)),
        state: "ACTION_REQUIRED",
        reason: this.#fabetFailureReason(error),
        nextRetryAtMs: nowMs + recoveryDelayMs(failures - 1, 0),
      };
      await this.#save(failed);
      return publicStatus(failed);
    }
  }

  async getActiveSecretHandle(id: string): Promise<ActiveSecretHandle | null> {
    const current = await this.#load(id);
    if (!this.#isUsable(current)) return null;
    return {
      sessionId: current.id,
      provider: current.provider,
      category: current.category,
      withSecret: async <T>(consume: (secret: ProviderSecret) => Promise<T>): Promise<T> => {
        const latest = await this.#load(id);
        if (!this.#isUsable(latest)) throw new Error("SESSION_NOT_ACTIVE");
        return consume({ ...latest.secret });
      }
    };
  }

  async withLatestFabetLaunch<T>(provider: FabetDerivedProvider, category: Category,
    consume: (url: string) => Promise<T>, minAcquiredAtMs = 0): Promise<T> {
    const candidates = (await this.#listRecords()).filter((record) =>
      record.source === "FABET_LOGIN" && record.provider === provider && record.category === category &&
      record.secret.kind === "LAUNCH_URL" && record.acquiredAtMs !== null &&
      record.acquiredAtMs >= minAcquiredAtMs)
      .sort((left, right) => (right.acquiredAtMs ?? -1) - (left.acquiredAtMs ?? -1));
    const latest = candidates[0];
    if (latest === undefined) throw new Error("FABET_PROVIDER_LAUNCH_UNAVAILABLE");
    return consume(latest.secret.value);
  }

  async withFabetProviderPage<T>(provider: FabetJitProvider, category: Category,
    consume: (page: Page) => Promise<T>): Promise<T> {
    const driver = this.#fabetDriver;
    if (driver?.withProviderPage === undefined) throw new Error("FABET_PROVIDER_POPUP_UNAVAILABLE");
    try {
      return await driver.withProviderPage(provider, category, consume);
    } catch (error) {
      if (typeof error !== "object" || error === null ||
        (error as Record<string, unknown>).code !== "NOT_AUTHENTICATED") throw error;
    }
    await this.#rehydrateFabet();
    return driver.withProviderPage(provider, category, consume);
  }

  async resetFabet(): Promise<void> {
    const records = await this.#listRecords();
    const removed = records.filter((record) => record.source === "FABET_LOGIN");
    await Promise.all(removed.map(async (record) => this.#vault.delete(`${recordPrefix}${record.id}`)));
    removed.forEach((record) => this.#recordCache.delete(record.id));
    await this.#fabetDriver?.resetProfile();
    await this.#resetFabetState();
  }

  async resetTk88(): Promise<void> {
    const records = await this.#listRecords();
    const removed = records.filter((record) => record.source === "TK88_CHROME");
    await Promise.all(removed.map(async (record) => this.#vault.delete(`${recordPrefix}${record.id}`)));
    removed.forEach((record) => this.#recordCache.delete(record.id));
    await this.#resetTk88State();
  }

  async #rehydrateFabet(credentialSourceId = "fabet"): Promise<void> {
    const inflight = this.#fabetRehydrations.get(credentialSourceId);
    if (inflight !== undefined) return inflight;
    const operation = (async () => {
      const record = await this.#load(credentialSourceId);
      if (record === null || record.secret.kind !== "FABET_CREDENTIALS" || this.#fabetDriver === undefined) {
        throw new Error("FABET_SESSION_UNAVAILABLE");
      }
      let fields: Record<string, unknown>;
      try { fields = JSON.parse(record.secret.value) as Record<string, unknown>; }
      catch { throw new Error("FABET_SESSION_UNAVAILABLE"); }
      if (typeof fields.entryUrl !== "string" || typeof fields.username !== "string" ||
        typeof fields.password !== "string") throw new Error("FABET_SESSION_UNAVAILABLE");
      await this.#loginFabet(fields.username, fields.password);
    })().finally(() => {
      if (this.#fabetRehydrations.get(credentialSourceId) === operation) {
        this.#fabetRehydrations.delete(credentialSourceId);
      }
    });
    this.#fabetRehydrations.set(credentialSourceId, operation);
    return operation;
  }

  async #renewRecord(record: StoredSession, failureReason: SessionHealthReason): Promise<RedactedSessionStatus> {
    const renewing = { ...record, state: "RENEWING" as const, reason: null };
    await this.#save(renewing);
    if (record.source === "FABET_LOGIN" && record.secret.kind === "FABET_CREDENTIALS") {
      if (this.#fabetDriver === undefined) return this.#transition(renewing, "ACTION_REQUIRED", failureReason);
      let credentials: { entryUrl: string; username: string; password: string };
      try {
        const parsed: unknown = JSON.parse(record.secret.value);
        if (typeof parsed !== "object" || parsed === null) throw new Error("invalid credentials");
        const fields = parsed as Record<string, unknown>;
        if (typeof fields.entryUrl !== "string" || typeof fields.username !== "string" || typeof fields.password !== "string") {
          throw new Error("invalid credentials");
        }
        credentials = { entryUrl: trustedFabetEntryUrl(fields.entryUrl, record.trustedHostname),
          username: fields.username, password: fields.password };
      } catch {
        return this.#transition(renewing, "INVALID", "VAULT_UNAVAILABLE");
      }
      try {
        await this.#loginFabet(credentials.username, credentials.password);
        await this.#ingestFabetLaunches(await this.#fabetDriver.captureLobbyLaunches(["FOOTBALL"]));
      } catch (error) {
        return this.#transition(renewing, "INVALID", this.#fabetFailureReason(error));
      }
      const nowMs = this.#clock.nowMs();
      const active: StoredSession = {
        ...renewing,
        state: "ACTIVE",
        acquiredAtMs: nowMs,
        lastValidatedAtMs: nowMs,
        renewAfterMs: nowMs + renewalIntervalMs,
        reason: null
      };
      await this.#save(active);
      return publicStatus(active);
    }
    const validator = this.#validators.get(record.provider);
    if (validator?.renew === undefined) return this.#transition(renewing, "ACTION_REQUIRED", failureReason);
    let secret: ProviderSecret;
    try {
      secret = await validator.renew(record.secret);
    } catch {
      return this.#transition(renewing, "ACTION_REQUIRED", failureReason);
    }
    const nowMs = this.#clock.nowMs();
    const renewed: StoredSession = {
      ...renewing,
      secret,
      acquiredAtMs: nowMs,
      renewAfterMs: nowMs + renewalIntervalMs
    };
    let result: SessionValidationResult;
    try {
      result = await validator.validate(secret);
    } catch {
      return this.#transition(renewed, "INVALID", "UNREACHABLE");
    }
    if (!result.ok) return this.#transition(renewed, "INVALID", result.reason);
    const active: StoredSession = {
      ...renewed,
      state: "ACTIVE",
      lastValidatedAtMs: nowMs,
      reason: null
    };
    await this.#save(active);
    return publicStatus(active);
  }

  async #loginFabet(username: string, password: string): Promise<void> {
    if (this.#fabetDriver === undefined) throw new Error("FABET_SESSION_UNAVAILABLE");
    if (this.#fabetDriver.authenticateWithEgresses !== undefined && this.#fabetAuthEgresses.length > 0) {
      await this.#fabetDriver.authenticateWithEgresses({
        username,
        password,
        egresses: this.#fabetAuthEgresses,
      });
      return;
    }
    await this.#fabetDriver.login({ entryUrl: "https://fabet.com/", username, password });
  }

  #renewDue(id: string, nowMs: number): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => {
      const current = await this.#loadRequired(id);
      if (current.state !== "ACTIVE" || current.renewAfterMs === null || nowMs < current.renewAfterMs) {
        return publicStatus(current);
      }
      return this.#renewRecord(current, "EXPIRED");
    });
  }

  #renewFabetParent(id: string, nowMs: number): Promise<RedactedSessionStatus> {
    return this.#exclusive(id, async () => {
      const current = await this.#loadRequired(id);
      const recoveryRequired = this.#needsFabetRecovery(await this.#listRecords());
      const renewalDue = current.state === "RENEWING" ||
        (current.state === "ACTIVE" && current.renewAfterMs !== null && nowMs >= current.renewAfterMs);
      const retryDue = (current.state === "INVALID" || current.state === "ACTION_REQUIRED") &&
        (current.nextRetryAtMs === null || current.nextRetryAtMs === undefined || nowMs >= current.nextRetryAtMs);
      if ((current.state !== "ACTIVE" && current.state !== "RENEWING" && !retryDue) ||
        current.secret.kind !== "FABET_CREDENTIALS" ||
        (!renewalDue && !recoveryRequired && !retryDue)) return publicStatus(current);
      const result = await this.#renewRecord(current, "EXPIRED");
      if (result.state === "ACTIVE") {
        this.#fabetRecoveryFailures.delete(id);
        return result;
      }
      const failures = (this.#fabetRecoveryFailures.get(id) ?? 0) + 1;
      this.#fabetRecoveryFailures.set(id, failures);
      const failed = { ...(await this.#loadRequired(id)), nextRetryAtMs: nowMs + recoveryDelayMs(failures - 1, 0) };
      await this.#save(failed);
      return publicStatus(failed);
    });
  }

  #needsFabetRecovery(records: readonly StoredSession[]): boolean {
    const newest = new Map<string, StoredSession>();
    for (const record of records) {
      if (record.source !== "FABET_LOGIN" || record.secret.kind !== "LAUNCH_URL" ||
        record.category !== "FOOTBALL") continue;
      const key = `${record.provider}|${record.category ?? ""}`;
      const current = newest.get(key);
      if (current === undefined || (record.acquiredAtMs ?? -1) > (current.acquiredAtMs ?? -1) ||
        (record.acquiredAtMs === current.acquiredAtMs && record.id.localeCompare(current.id) > 0)) {
        newest.set(key, record);
      }
    }
    return [...newest.values()].some((record) => record.lastValidatedAtMs !== null &&
      record.state === "ACTION_REQUIRED" && record.reason === "EXPIRED");
  }

  async #transition(record: StoredSession, state: SessionState, reason: SessionHealthReason): Promise<RedactedSessionStatus> {
    const next = { ...record, state, reason };
    await this.#save(next);
    return publicStatus(next);
  }

  #exclusive(id: string, operation: () => Promise<RedactedSessionStatus>): Promise<RedactedSessionStatus> {
    const existing = this.#inflight.get(id);
    if (existing !== undefined) return existing;
    const running = operation().finally(() => this.#inflight.delete(id));
    this.#inflight.set(id, running);
    return running;
  }

  #isUsable(record: StoredSession | null): record is StoredSession {
    return record !== null && record.state === "ACTIVE" && record.renewAfterMs !== null && this.#clock.nowMs() < record.renewAfterMs;
  }

  #hostname(value: string): string | null {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.hostname : null;
    } catch {
      return null;
    }
  }

  #fabetFailureReason(error: unknown): SessionHealthReason {
    if (error instanceof Error) {
      if (error.message === "AUTH_EGRESS_UNAVAILABLE") return "AUTH_EGRESS_UNAVAILABLE";
      if (error.message === "PROVIDER_VALIDATION_FAILED") return "PROVIDER_VALIDATION_FAILED";
    }
    if (typeof error === "object" && error !== null) {
      const code = (error as Record<string, unknown>).code;
      if (code === "DOMAIN_APPROVAL_REQUIRED") return "DOMAIN_APPROVAL_REQUIRED";
      if (code === "UNAUTHORIZED") return "UNAUTHORIZED";
      if (code === "VAULT_UNAVAILABLE") return "VAULT_UNAVAILABLE";
    }
    return "UNREACHABLE";
  }

  async #ingestFabetLaunches(candidates: readonly LaunchCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      const stored = await this.#vault.load(candidate.vaultRecordId);
      if (
        stored === null ||
        stored.kind !== "LAUNCH_URL" ||
        typeof stored.value !== "string" ||
        typeof stored.capturedAtMs !== "number"
      ) throw new VaultError("VAULT_UNAVAILABLE");
      const provider = candidate.providerHint === "UNKNOWN"
        ? `UNKNOWN (${candidate.hostname})`
        : candidate.providerHint;
      const slug = provider.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "unknown";
      const categorySlug = candidate.category.toLowerCase();
      const hostHash = createHash("sha256").update(candidate.hostname).digest("hex").slice(0, 12);
      const id = `fabet-launch-${slug}-${categorySlug}-${hostHash}`;
      const previous = await this.#load(id);
      const preservesVerifiedIdentity = previous !== null && previous.source === "FABET_LOGIN" &&
        previous.lastValidatedAtMs !== null &&
        (previous.state === "ACTIVE" || (previous.state === "ACTION_REQUIRED" && previous.reason === "EXPIRED")) &&
        previous.provider === provider && previous.category === candidate.category &&
        previous.trustedHostname === candidate.hostname;
      let record: StoredSession = {
        version: 1,
        id,
        provider,
        category: candidate.category,
        source: "FABET_LOGIN",
        state: preservesVerifiedIdentity ? "ACTIVE" : "ACTION_REQUIRED",
        trustedHostname: candidate.hostname,
        acquiredAtMs: candidate.capturedAtMs,
        lastValidatedAtMs: preservesVerifiedIdentity ? previous.lastValidatedAtMs : null,
        renewAfterMs: candidate.capturedAtMs + renewalIntervalMs,
        reason: preservesVerifiedIdentity ? null : "SCHEMA_CHANGED",
        secret: { kind: "LAUNCH_URL", value: stored.value }
      };
      if (!preservesVerifiedIdentity) {
        const validator = this.#validators.get(provider);
        if (validator !== null) {
          try {
            const result = await validator.validate(record.secret);
            if (result.ok) {
              record = { ...record, state: "ACTIVE", reason: null,
                lastValidatedAtMs: candidate.capturedAtMs };
            } else {
              record = { ...record, reason: result.reason };
            }
          } catch {
            // A captured launcher is never trusted merely because it came from
            // the lobby. Keep it non-active until a later validation succeeds.
          }
        }
      }
      await this.#save(record);
      await this.#vault.delete(candidate.vaultRecordId);
    }
  }

  async #save(record: StoredSession): Promise<void> {
    await this.#vault.save(`${recordPrefix}${record.id}`, record as unknown as SecretRecord);
    this.#recordCache.set(record.id, record);
  }

  async #load(id: string): Promise<StoredSession | null> {
    const cached = this.#recordCache.get(id);
    if (cached !== undefined) return cached;
    if (this.#allRecordsHydrated) return null;
    const record = parseStoredSession(await this.#vault.load(`${recordPrefix}${id}`));
    if (record !== null) this.#recordCache.set(id, record);
    return record;
  }

  async #loadRequired(id: string): Promise<StoredSession> {
    const record = await this.#load(id);
    if (record === null) throw new Error("SESSION_NOT_FOUND");
    return record;
  }

  async #listRecords(): Promise<StoredSession[]> {
    if (this.#allRecordsHydrated) return [...this.#recordCache.values()].sort((left, right) => left.id.localeCompare(right.id));
    if (this.#recordHydration !== null) return this.#recordHydration;
    const operation = (async () => {
      const ids = (await this.#vault.listIds()).filter((id) => id.startsWith(recordPrefix));
      const records = (await this.#vault.loadMany(ids)).map(parseStoredSession)
        .filter((record): record is StoredSession => record !== null);
      records.forEach((record) => this.#recordCache.set(record.id, record));
      this.#allRecordsHydrated = true;
      return [...this.#recordCache.values()].sort((left, right) => left.id.localeCompare(right.id));
    })().finally(() => { if (this.#recordHydration === operation) this.#recordHydration = null; });
    this.#recordHydration = operation;
    return operation;
  }
}
