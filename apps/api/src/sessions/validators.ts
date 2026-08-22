import type { SessionValidator } from "./types.js";

function providerKey(provider: string): string {
  return provider.trim().toUpperCase();
}

export class SessionValidatorRegistry {
  readonly #validators = new Map<string, SessionValidator>();

  constructor(validators: readonly SessionValidator[]) {
    for (const validator of validators) {
      const key = providerKey(validator.provider);
      if (key.length === 0 || this.#validators.has(key)) {
        throw new Error("Session validator providers must be nonempty and unique");
      }
      this.#validators.set(key, validator);
    }
  }

  get(provider: string): SessionValidator | null {
    return this.#validators.get(providerKey(provider)) ?? null;
  }
}
