import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { VaultError, type SecretProtector } from "./types.js";

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Cross-platform vault protector for macOS/Linux where Windows DPAPI is not
 * available. Secrets are encrypted with AES-256-GCM under a random key that
 * lives in a mode-0600 file next to the vault. This binds the vault to the
 * local user account through filesystem permissions rather than the OS
 * credential store; it is the portable fallback, not a replacement for DPAPI
 * on Windows.
 */
export class LocalKeyProtector implements SecretProtector {
  readonly #keyPath: string;
  #key: Promise<Buffer> | null = null;

  constructor(options: { readonly keyPath: string }) {
    this.#keyPath = options.keyPath;
  }

  async protect(cleartext: Uint8Array): Promise<Uint8Array> {
    const key = await this.#loadKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(cleartext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from([VERSION]), iv, tag, encrypted]);
  }

  async unprotect(ciphertext: Uint8Array): Promise<Uint8Array> {
    const buffer = Buffer.from(ciphertext);
    if (buffer.length < 1 + IV_LENGTH + TAG_LENGTH || buffer[0] !== VERSION) {
      throw new VaultError("INVALID_VAULT_RECORD");
    }
    const key = await this.#loadKey();
    const iv = buffer.subarray(1, 1 + IV_LENGTH);
    const tag = buffer.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const body = buffer.subarray(1 + IV_LENGTH + TAG_LENGTH);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new VaultError("INVALID_VAULT_RECORD");
    }
  }

  async unprotectMany(ciphertexts: readonly Uint8Array[]): Promise<readonly Uint8Array[]> {
    return Promise.all(ciphertexts.map((value) => this.unprotect(value)));
  }

  #loadKey(): Promise<Buffer> {
    this.#key ??= this.#readOrCreateKey().catch((error) => {
      this.#key = null;
      throw error;
    });
    return this.#key;
  }

  async #readOrCreateKey(): Promise<Buffer> {
    const parse = (raw: string): Buffer => {
      const key = Buffer.from(raw.trim(), "base64");
      if (key.length !== KEY_LENGTH) throw new VaultError("VAULT_UNAVAILABLE");
      return key;
    };
    try {
      return parse(await readFile(this.#keyPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof VaultError) throw error;
        throw new VaultError("VAULT_UNAVAILABLE");
      }
    }
    await mkdir(dirname(this.#keyPath), { recursive: true, mode: 0o700 });
    const key = randomBytes(KEY_LENGTH);
    try {
      const handle = await open(this.#keyPath, "wx", 0o600);
      try { await handle.writeFile(key.toString("base64"), "utf8"); } finally { await handle.close(); }
      return key;
    } catch (error) {
      // Another process won the race; use its key.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return parse(await readFile(this.#keyPath, "utf8"));
      throw new VaultError("VAULT_UNAVAILABLE");
    }
  }
}
