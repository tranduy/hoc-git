export type SecretRecord = Readonly<Record<string, unknown>>;

import type { Category, SessionHealthReason } from "@tool-chenh/contracts";

export type ProviderSecretKind = "TOKEN" | "COOKIE_BUNDLE" | "LAUNCH_URL" | "FABET_CREDENTIALS" | "TK88_PROFILE";

export interface ProviderSecret {
  readonly kind: ProviderSecretKind;
  readonly value: string;
}

export type SessionValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SessionHealthReason };

export interface SessionValidator {
  readonly provider: string;
  validate(secret: ProviderSecret): Promise<SessionValidationResult>;
  renew?(secret: ProviderSecret): Promise<ProviderSecret>;
}

export interface ActiveSecretHandle {
  readonly sessionId: string;
  readonly provider: string;
  readonly category?: Category | null;
  withSecret<T>(consume: (secret: ProviderSecret) => Promise<T>): Promise<T>;
}

export interface SecretProtector {
  protect(cleartext: Uint8Array): Promise<Uint8Array>;
  unprotect(ciphertext: Uint8Array): Promise<Uint8Array>;
  unprotectMany?(ciphertexts: readonly Uint8Array[]): Promise<readonly Uint8Array[]>;
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
