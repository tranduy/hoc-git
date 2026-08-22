import { SecretVault } from "./secret-vault.js";
import { VaultError } from "./types.js";

const vaultRecordId = "trusted-fabet-hosts";

export interface TrustedHostname {
  readonly hostname: string;
  readonly approvedAtMs: number;
}

export interface TrustedDomainStoreOptions {
  readonly vault: SecretVault;
  readonly clock: { nowMs(): number };
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.length === 0 || /[/:@?#\\]/u.test(trimmed)) {
    throw new VaultError("INVALID_VAULT_RECORD");
  }
  let normalized: string;
  try {
    normalized = new URL(`https://${trimmed}/`).hostname.toLowerCase();
  } catch {
    throw new VaultError("INVALID_VAULT_RECORD");
  }
  if (normalized.length === 0) throw new VaultError("INVALID_VAULT_RECORD");
  return normalized;
}

function parseEntries(value: unknown): TrustedHostname[] {
  if (typeof value !== "object" || value === null || !Array.isArray((value as Record<string, unknown>).hosts)) {
    throw new VaultError("VAULT_UNAVAILABLE");
  }
  const entries = (value as { hosts: unknown[] }).hosts.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new VaultError("VAULT_UNAVAILABLE");
    const fields = entry as Record<string, unknown>;
    if (
      typeof fields.hostname !== "string" ||
      typeof fields.approvedAtMs !== "number" ||
      !Number.isFinite(fields.approvedAtMs) ||
      fields.approvedAtMs < 0
    ) throw new VaultError("VAULT_UNAVAILABLE");
    return { hostname: normalizeHostname(fields.hostname), approvedAtMs: fields.approvedAtMs };
  });
  return entries.sort((left, right) => left.hostname.localeCompare(right.hostname));
}

export class TrustedDomainStore {
  readonly #vault: SecretVault;
  readonly #clock: { nowMs(): number };

  constructor(options: TrustedDomainStoreOptions) {
    this.#vault = options.vault;
    this.#clock = options.clock;
  }

  async approve(hostname: string): Promise<void> {
    const normalized = normalizeHostname(hostname);
    const entries = await this.list();
    const withoutExisting = entries.filter((entry) => entry.hostname !== normalized);
    await this.#vault.save(vaultRecordId, {
      hosts: [...withoutExisting, { hostname: normalized, approvedAtMs: this.#clock.nowMs() }]
    });
  }

  async isTrusted(hostname: string): Promise<boolean> {
    const normalized = normalizeHostname(hostname);
    return (await this.list()).some((entry) => entry.hostname === normalized);
  }

  async list(): Promise<readonly TrustedHostname[]> {
    const stored = await this.#vault.load(vaultRecordId);
    return stored === null ? [] : parseEntries(stored);
  }

  async resetFabetHosts(): Promise<void> {
    await this.#vault.delete(vaultRecordId);
  }
}
