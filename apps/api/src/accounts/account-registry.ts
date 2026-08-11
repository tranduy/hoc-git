import {
  AccountStatusSchema,
  DecimalStringSchema,
  ProviderIdSchema,
  type AccountStatus,
  type Category,
  type ProviderCapability,
  type ProviderId,
  type RedactedSessionStatus,
  type SessionHealthReason,
  type SessionStatusList
} from "@tool-chenh/contracts";
import type { ProviderProfile, ProviderProfileReader } from "../providers/provider-capabilities.js";
import { SecretVault } from "../sessions/secret-vault.js";
import type { ActiveSecretHandle, SecretRecord } from "../sessions/types.js";

const recordPrefix = "account-";
const profileFreshnessMs = 30_000;

interface StoredAccount {
  readonly version: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly alias: string;
  readonly provider: ProviderId;
  readonly profile: ProviderProfile | null;
  readonly profileReason: SessionHealthReason | null;
}

interface SessionAccess {
  listStatuses(): Promise<SessionStatusList>;
  getActiveSecretHandle(id: string): Promise<ActiveSecretHandle | null>;
}

export interface AccountRegistryOptions {
  readonly vault: SecretVault;
  readonly sessions: SessionAccess;
  readonly readers: readonly ProviderProfileReader[];
  readonly clock: { nowMs(): number };
  readonly idFactory: () => string;
}

function parseStoredAccount(value: SecretRecord | null): StoredAccount | null {
  if (value === null || value.version !== 1 || typeof value.id !== "string" ||
    typeof value.sessionId !== "string" || typeof value.alias !== "string" ||
    !ProviderIdSchema.safeParse(value.provider).success) return null;
  const profile = value.profile;
  if (profile !== null && (
    typeof profile !== "object" || typeof (profile as Record<string, unknown>).redactedLabel !== "string" ||
    typeof (profile as Record<string, unknown>).currency !== "string" ||
    !DecimalStringSchema.safeParse((profile as Record<string, unknown>).balance).success ||
    typeof (profile as Record<string, unknown>).asOfMs !== "number"
  )) return null;
  const profileReason = value.profileReason;
  if (profileReason !== null && ![
    "UNREACHABLE", "DOMAIN_APPROVAL_REQUIRED", "UNAUTHORIZED", "EXPIRED",
    "SCHEMA_CHANGED", "VAULT_UNAVAILABLE", "RESET_FAILED"
  ].includes(String(profileReason))) return null;
  return value as unknown as StoredAccount;
}

export class AccountRegistry {
  readonly #vault: SecretVault;
  readonly #sessions: SessionAccess;
  readonly #readers: ReadonlyMap<ProviderId, ProviderProfileReader>;
  readonly #clock: { nowMs(): number };
  readonly #idFactory: () => string;

  constructor(options: AccountRegistryOptions) {
    this.#vault = options.vault;
    this.#sessions = options.sessions;
    this.#readers = new Map(options.readers.map((reader) => [reader.provider, reader]));
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
  }

  async register(input: { sessionId: string; alias: string; provider: ProviderId }): Promise<AccountStatus> {
    if (!ProviderIdSchema.safeParse(input.provider).success || input.provider === "FABET") {
      throw new Error("PROVIDER_IDENTITY_REQUIRED");
    }
    const session = (await this.#sessions.listStatuses()).sessions.find((candidate) => candidate.id === input.sessionId);
    if (session === undefined) throw new Error("SESSION_NOT_FOUND");
    if (session.provider !== input.provider) throw new Error("PROVIDER_IDENTITY_MISMATCH");
    const id = this.#idFactory();
    const record: StoredAccount = {
      version: 1, id, sessionId: input.sessionId, alias: input.alias.trim(), provider: input.provider,
      profile: null, profileReason: "SCHEMA_CHANGED"
    };
    if (record.alias.length === 0) throw new Error("ACCOUNT_ALIAS_REQUIRED");
    await this.#save(record);
    return this.#public(record, session);
  }

  async refresh(id: string): Promise<AccountStatus> {
    const record = await this.#loadRequired(id);
    const session = (await this.#sessions.listStatuses()).sessions.find((candidate) => candidate.id === record.sessionId);
    if (session === undefined) return this.#public({ ...record, profile: null, profileReason: "SCHEMA_CHANGED" }, null);
    const handle = await this.#sessions.getActiveSecretHandle(record.sessionId);
    if (handle === null) {
      const unavailable = { ...record, profile: null, profileReason: session.reason ?? "SCHEMA_CHANGED" };
      await this.#save(unavailable);
      return this.#public(unavailable, session);
    }
    const reader = this.#readers.get(record.provider);
    if (reader === undefined) {
      const unavailable = { ...record, profile: null, profileReason: "SCHEMA_CHANGED" as const };
      await this.#save(unavailable);
      return this.#public(unavailable, session);
    }
    try {
      const profile = await reader.readProfile(handle);
      if (!DecimalStringSchema.safeParse(profile.balance).success || !/^[A-Z]{3,8}$/u.test(profile.currency) ||
        !Number.isFinite(profile.asOfMs) || profile.asOfMs < 0 || profile.redactedLabel.trim().length === 0) {
        throw new Error("invalid provider profile");
      }
      const fresh = { ...record, profile: { ...profile }, profileReason: null };
      await this.#save(fresh);
      return this.#public(fresh, session, reader.capabilities);
    } catch {
      const unavailable = { ...record, profile: null, profileReason: "UNREACHABLE" as const };
      await this.#save(unavailable);
      return this.#public(unavailable, session, reader.capabilities);
    }
  }

  async listStatuses(): Promise<readonly AccountStatus[]> {
    const sessions = await this.#sessions.listStatuses();
    const byId = new Map(sessions.sessions.map((session) => [session.id, session]));
    return Promise.all((await this.#listRecords()).map((record) => this.#public(
      record, byId.get(record.sessionId) ?? null, this.#readers.get(record.provider)?.capabilities
    )));
  }

  async withActiveHandle<T>(
    id: string,
    expectedProvider: ProviderId,
    consume: (handle: ActiveSecretHandle) => Promise<T>,
    expectedCategory?: Category
  ): Promise<T> {
    const record = await this.#loadRequired(id);
    if (record.provider !== expectedProvider) throw new Error("ACCOUNT_PROVIDER_MISMATCH");
    const handle = await this.#sessions.getActiveSecretHandle(record.sessionId);
    if (handle === null || handle.provider !== record.provider) throw new Error("ACCOUNT_SESSION_UNAVAILABLE");
    if (expectedCategory !== undefined && handle.category !== expectedCategory) throw new Error("ACCOUNT_CATEGORY_MISMATCH");
    return consume(handle);
  }

  #public(record: StoredAccount, session: RedactedSessionStatus | null, capabilities: readonly ProviderCapability[] = []): AccountStatus {
    const boundSession = session?.provider === record.provider ? session : null;
    const profileState = record.profile === null ? "UNAVAILABLE" as const
      : this.#clock.nowMs() - record.profile.asOfMs <= profileFreshnessMs ? "FRESH" as const : "STALE" as const;
    return AccountStatusSchema.parse({
      id: record.id, alias: record.alias, provider: record.provider,
      category: boundSession?.category ?? null,
      sessionState: boundSession?.state ?? "INVALID", profileState,
      redactedLabel: record.profile?.redactedLabel ?? null,
      currency: record.profile?.currency ?? null,
      balance: record.profile?.balance ?? null,
      balanceAsOfMs: record.profile?.asOfMs ?? null,
      capabilities: [...new Set(capabilities)],
      reason: boundSession?.reason ?? (session === null ? record.profileReason : "SCHEMA_CHANGED")
    });
  }

  async #save(record: StoredAccount): Promise<void> {
    await this.#vault.save(`${recordPrefix}${record.id}`, record as unknown as SecretRecord);
  }

  async #loadRequired(id: string): Promise<StoredAccount> {
    const record = parseStoredAccount(await this.#vault.load(`${recordPrefix}${id}`));
    if (record === null) throw new Error("ACCOUNT_NOT_FOUND");
    return record;
  }

  async #listRecords(): Promise<StoredAccount[]> {
    const ids = (await this.#vault.listIds()).filter((id) => id.startsWith(recordPrefix));
    const records = await Promise.all(ids.map((id) => this.#vault.load(id)));
    return records.map(parseStoredAccount).filter((record): record is StoredAccount => record !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
