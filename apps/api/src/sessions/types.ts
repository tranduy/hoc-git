export type SecretRecord = Readonly<Record<string, unknown>>;

export interface SecretProtector {
  protect(cleartext: Uint8Array): Promise<Uint8Array>;
  unprotect(ciphertext: Uint8Array): Promise<Uint8Array>;
}

export type VaultErrorCode = "INVALID_VAULT_RECORD" | "VAULT_UNAVAILABLE";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(code === "INVALID_VAULT_RECORD" ? "Invalid vault record" : "Secure vault unavailable");
    this.name = "VaultError";
    this.code = code;
  }
}
