import type {
  Category,
  RedactedSessionStatus,
  SessionHealthReason,
  SessionSource,
  SessionState,
  SessionStatusList
} from "@tool-chenh/contracts";
import { createHash } from "node:crypto";
import type { LaunchCandidate } from "./fabet-browser.js";
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
  readonly secret: ProviderSecret;
}

export interface ConfigureManualInput {
  readonly provider: string;
  readonly kind: Exclude<ProviderSecretKind, "FABET_CREDENTIALS">;
  readonly secret: string;
}

export interface ConfigureFabetInput {
  readonly entryUrl: string;
  readonly username: string;
  readonly password: string;
  readonly trustedHostname: string;
}

export interface SessionManagerOptions {
  readonly vault: SecretVault;
  readonly validators: SessionValidatorRegistry;
  readonly clock: { nowMs(): number };
  readonly idFactory: () => string;
  readonly fabetDriver?: {
    login(input: { readonly entryUrl: string; readonly username: string; readonly password: string }): Promise<void>;
    captureLobbyLaunches(): Promise<readonly LaunchCandidate[]>;
    resetProfile(): Promise<void>;
  };
  readonly resetFabetState?: () => Promise<void>;
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
  const validSources = new Set<SessionSource>(["FABET_LOGIN", "MANUAL_PROVIDER_SESSION"]);
  const validStates = new Set<SessionState>(["UNCONFIGURED", "VALIDATING", "ACTIVE", "RENEWING", "ACTION_REQUIRED", "INVALID"]);
  const validReasons = new Set<SessionHealthReason>([
    "UNREACHABLE", "DOMAIN_APPROVAL_REQUIRED", "UNAUTHORIZED", "EXPIRED",
    "SCHEMA_CHANGED", "VAULT_UNAVAILABLE", "RESET_FAILED"
  ]);
  if (!validSources.has(source as SessionSource) || !validStates.has(state as SessionState)) return null;
  if (reason !== null && !validReasons.has(reason as SessionHealthReason)) return null;
  if (value.trustedHostname !== null && typeof value.trustedHostname !== "string") return null;
  if (!isFiniteTimestamp(value.acquiredAtMs) || !isFiniteTimestamp(value.lastValidatedAtMs) || !isFiniteTimestamp(value.renewAfterMs)) return null;
  if (typeof secret !== "object" || secret === null) return null;
  const secretFields = secret as Record<string, unknown>;
  if (
    !["TOKEN", "COOKIE_BUNDLE", "LAUNCH_URL", "FABET_CREDENTIALS"].includes(String(secretFields.kind)) ||
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
    secretConfigured: record.secret.value.length > 0,
    reason: record.reason
  };
}

export class SessionManager {
  readonly #vault: SecretVault;
  readonly #validators: SessionValidatorRegistry;
  readonly #clock: { nowMs(): number };
  readonly #idFactory: () => string;
  readonly #fabetDriver: SessionManagerOptions["fabetDriver"];
  readonly #resetFabetState: () => Promise<void>;
  readonly #inflight = new Map<string, Promise<RedactedSessionStatus>>();

  constructor(options: SessionManagerOptions) {
    this.#vault = options.vault;
    this.#validators = options.validators;
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
    this.#fabetDriver = options.fabetDriver;
    this.#resetFabetState = options.resetFabetState ?? (async () => undefined);
  }

  async configureManual(input: ConfigureManualInput): Promise<RedactedSessionStatus> {
    const provider = input.provider.trim().toUpperCase();
    if (provider.length === 0 || input.secret.length === 0) throw new Error("Invalid manual session configuration");
    const nowMs = this.#clock.nowMs();
    const record: StoredSession = {
      version: 1,
      id: this.#idFactory(),
      provider,
      category: null,
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
    if (input.username.length === 0 || input.password.length === 0) throw new Error("Invalid Fabet configuration");
    const nowMs = this.#clock.nowMs();
    const record: StoredSession = {
      version: 1,
      id: "fabet",
      provider: "FABET",
      category: null,
      source: "FABET_LOGIN",
      state: "VALIDATING",
      trustedHostname: input.trustedHostname,
      acquiredAtMs: nowMs,
      lastValidatedAtMs: null,
      renewAfterMs: nowMs + renewalIntervalMs,
      reason: null,
      secret: {
        kind: "FABET_CREDENTIALS",
        value: JSON.stringify({ entryUrl: input.entryUrl, username: input.username, password: input.password })
      }
    };
    await this.#save(record);
    if (this.#fabetDriver === undefined) return this.#transition(record, "ACTION_REQUIRED", "SCHEMA_CHANGED");
    try {
      await this.#fabetDriver.login(input);
      await this.#ingestFabetLaunches(await this.#fabetDriver.captureLobbyLaunches());
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
    const records = await this.#listRecords();
    const nowMs = this.#clock.nowMs();
    await Promise.all(records
      .filter((record) => record.state === "ACTIVE" && record.renewAfterMs !== null && nowMs >= record.renewAfterMs)
      .map(async (record) => { await this.renew(record.id); }));
  }

  async listStatuses(): Promise<SessionStatusList> {
    return { sessions: (await this.#listRecords()).map(publicStatus) };
  }

  async getActiveSecretHandle(id: string): Promise<ActiveSecretHandle | null> {
    const current = await this.#load(id);
    if (!this.#isUsable(current)) return null;
    return {
      sessionId: current.id,
      provider: current.provider,
      withSecret: async <T>(consume: (secret: ProviderSecret) => Promise<T>): Promise<T> => {
        const latest = await this.#load(id);
        if (!this.#isUsable(latest)) throw new Error("SESSION_NOT_ACTIVE");
        return consume({ ...latest.secret });
      }
    };
  }

  async resetFabet(): Promise<void> {
    const records = await this.#listRecords();
    await Promise.all(records
      .filter((record) => record.source === "FABET_LOGIN")
      .map(async (record) => this.#vault.delete(`${recordPrefix}${record.id}`)));
    await this.#fabetDriver?.resetProfile();
    await this.#resetFabetState();
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
        credentials = { entryUrl: fields.entryUrl, username: fields.username, password: fields.password };
      } catch {
        return this.#transition(renewing, "INVALID", "VAULT_UNAVAILABLE");
      }
      try {
        await this.#fabetDriver.login(credentials);
        await this.#ingestFabetLaunches(await this.#fabetDriver.captureLobbyLaunches());
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
      const record: StoredSession = {
        version: 1,
        id: `fabet-launch-${slug}-${categorySlug}-${hostHash}`,
        provider,
        category: candidate.category,
        source: "FABET_LOGIN",
        state: "ACTION_REQUIRED",
        trustedHostname: candidate.hostname,
        acquiredAtMs: candidate.capturedAtMs,
        lastValidatedAtMs: null,
        renewAfterMs: candidate.capturedAtMs + renewalIntervalMs,
        reason: "SCHEMA_CHANGED",
        secret: { kind: "LAUNCH_URL", value: stored.value }
      };
      await this.#save(record);
      await this.#vault.delete(candidate.vaultRecordId);
    }
  }

  async #save(record: StoredSession): Promise<void> {
    await this.#vault.save(`${recordPrefix}${record.id}`, record as unknown as SecretRecord);
  }

  async #load(id: string): Promise<StoredSession | null> {
    return parseStoredSession(await this.#vault.load(`${recordPrefix}${id}`));
  }

  async #loadRequired(id: string): Promise<StoredSession> {
    const record = await this.#load(id);
    if (record === null) throw new Error("SESSION_NOT_FOUND");
    return record;
  }

  async #listRecords(): Promise<StoredSession[]> {
    const ids = (await this.#vault.listIds()).filter((id) => id.startsWith(recordPrefix));
    const records = await Promise.all(ids.map(async (id) => parseStoredSession(await this.#vault.load(id))));
    return records.filter((record): record is StoredSession => record !== null).sort((left, right) => left.id.localeCompare(right.id));
  }
}
