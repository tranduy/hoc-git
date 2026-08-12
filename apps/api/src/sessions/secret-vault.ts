import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { VaultError, type SecretProtector, type SecretRecord } from "./types.js";

interface VaultFileV1 {
  readonly version: 1;
  readonly records: Readonly<Record<string, { readonly ciphertextBase64: string }>>;
}

export interface SecretVaultOptions {
  readonly directory: string;
  readonly protector: SecretProtector;
}

const recordIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function emptyVault(): VaultFileV1 {
  return { version: 1, records: {} };
}

function isVaultFile(value: unknown): value is VaultFileV1 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.records !== "object" || candidate.records === null) return false;
  return Object.values(candidate.records).every((record) => {
    if (typeof record !== "object" || record === null) return false;
    const fields = record as Record<string, unknown>;
    return typeof fields.ciphertextBase64 === "string" && Object.keys(fields).length === 1;
  });
}

function assertRecordId(id: string): void {
  if (!recordIdPattern.test(id)) throw new VaultError("INVALID_VAULT_RECORD");
}

export class SecretVault {
  readonly #directory: string;
  readonly #path: string;
  readonly #temporaryPath: string;
  readonly #protector: SecretProtector;
  #mutation: Promise<void> = Promise.resolve();

  constructor(options: SecretVaultOptions) {
    this.#directory = options.directory;
    this.#path = join(options.directory, "vault.v1.json");
    this.#temporaryPath = join(options.directory, "vault.v1.json.tmp");
    this.#protector = options.protector;
  }

  async save(id: string, secret: SecretRecord): Promise<void> {
    assertRecordId(id);
    await this.#mutate(async (vault) => {
      const cleartext = new TextEncoder().encode(JSON.stringify(secret));
      let ciphertext: Uint8Array;
      try {
        ciphertext = await this.#protector.protect(cleartext);
      } catch {
        throw new VaultError("VAULT_UNAVAILABLE");
      } finally {
        cleartext.fill(0);
      }
      return {
        version: 1,
        records: {
          ...vault.records,
          [id]: { ciphertextBase64: Buffer.from(ciphertext).toString("base64") }
        }
      };
    });
  }

  async load(id: string): Promise<SecretRecord | null> {
    assertRecordId(id);
    const record = (await this.#read()).records[id];
    if (record === undefined) return null;
    let cleartext: Uint8Array | undefined;
    try {
      const ciphertext = Buffer.from(record.ciphertextBase64, "base64");
      cleartext = await this.#protector.unprotect(ciphertext);
      const value: unknown = JSON.parse(new TextDecoder().decode(cleartext));
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("invalid secret record");
      }
      return value as SecretRecord;
    } catch {
      throw new VaultError("VAULT_UNAVAILABLE");
    } finally {
      cleartext?.fill(0);
    }
  }

  async loadMany(ids: readonly string[]): Promise<readonly (SecretRecord | null)[]> {
    ids.forEach(assertRecordId);
    if (ids.length === 0) return [];
    const vault = await this.#read();
    const present = ids.flatMap((id, index) => {
      const record = vault.records[id];
      return record === undefined ? [] : [{ index, ciphertext: Buffer.from(record.ciphertextBase64, "base64") }];
    });
    const output: Array<SecretRecord | null> = ids.map(() => null);
    if (present.length === 0) return output;
    let cleartexts: readonly Uint8Array[] = [];
    try {
      cleartexts = this.#protector.unprotectMany === undefined
        ? await Promise.all(present.map((item) => this.#protector.unprotect(item.ciphertext)))
        : await this.#protector.unprotectMany(present.map((item) => item.ciphertext));
      if (cleartexts.length !== present.length) throw new Error("invalid batch result");
      cleartexts.forEach((cleartext, index) => {
        const value: unknown = JSON.parse(new TextDecoder().decode(cleartext));
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid secret record");
        output[present[index]!.index] = value as SecretRecord;
      });
      return output;
    } catch {
      throw new VaultError("VAULT_UNAVAILABLE");
    } finally {
      cleartexts.forEach((cleartext) => cleartext.fill(0));
    }
  }

  async delete(id: string): Promise<void> {
    assertRecordId(id);
    await this.#mutate(async (vault) => {
      const records = { ...vault.records };
      delete records[id];
      return { version: 1, records };
    });
  }

  async has(id: string): Promise<boolean> {
    assertRecordId(id);
    return (await this.#read()).records[id] !== undefined;
  }

  async listIds(): Promise<readonly string[]> {
    return Object.keys((await this.#read()).records).sort();
  }

  async #mutate(change: (vault: VaultFileV1) => Promise<VaultFileV1>): Promise<void> {
    const operation = this.#mutation.then(async () => {
      const next = await change(await this.#read());
      await this.#write(next);
    });
    this.#mutation = operation.catch(() => undefined);
    return operation;
  }

  async #read(): Promise<VaultFileV1> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!isVaultFile(parsed)) throw new Error("invalid vault envelope");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyVault();
      throw new VaultError("VAULT_UNAVAILABLE");
    }
  }

  async #write(vault: VaultFileV1): Promise<void> {
    try {
      await mkdir(this.#directory, { recursive: true });
      const handle = await open(this.#temporaryPath, "w", 0o600);
      try {
        await handle.writeFile(JSON.stringify(vault), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(this.#temporaryPath, this.#path);
    } catch {
      throw new VaultError("VAULT_UNAVAILABLE");
    }
  }
}
