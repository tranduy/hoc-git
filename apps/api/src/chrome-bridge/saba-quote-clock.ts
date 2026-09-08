import type { ChromeBridgeEnvelope, ProviderQuote } from "@tool-chenh/contracts";

export interface SabaQuoteClockContext {
  readonly monotonicNowMs: number;
  readonly wallClockNowMs: number;
}

export interface SabaQuoteClockMapperOptions {
  readonly now?: () => SabaQuoteClockContext;
}

type EnvelopeClock = Pick<ChromeBridgeEnvelope, "observedAtMs" | "receivedMonotonicMs">;

const invalidClock = (): never => {
  throw new Error("SABA_QUOTE_CLOCK_INVALID");
};

const validNonnegativeClock = (value: number): boolean => Number.isFinite(value) && value >= 0;

export class SabaQuoteClockMapper {
  readonly #now: () => SabaQuoteClockContext;
  readonly #localized = new WeakMap<ProviderQuote, ProviderQuote>();

  constructor(options: SabaQuoteClockMapperOptions = {}) {
    this.#now = options.now ?? (() => ({
      monotonicNowMs: performance.now(),
      wallClockNowMs: Date.now()
    }));
  }

  observe(quotes: readonly ProviderQuote[], envelope: EnvelopeClock): void {
    const now = this.#now();
    if (
      !validNonnegativeClock(now.monotonicNowMs) ||
      !validNonnegativeClock(now.wallClockNowMs) ||
      !validNonnegativeClock(envelope.observedAtMs) ||
      !validNonnegativeClock(envelope.receivedMonotonicMs)
    ) invalidClock();

    const pending: Array<readonly [ProviderQuote, ProviderQuote]> = [];
    for (const quote of quotes) {
      if (
        typeof quote !== "object" || quote === null || quote.provider !== "SABA" ||
        !validNonnegativeClock(quote.receivedMonotonicMs) ||
        quote.receivedMonotonicMs > envelope.receivedMonotonicMs
      ) invalidClock();

      const transitAgeMs = Math.max(0, now.wallClockNowMs - envelope.observedAtMs);
      const sourceCaptureAgeMs = envelope.receivedMonotonicMs - quote.receivedMonotonicMs;
      const localizedMonotonicMs = now.monotonicNowMs - transitAgeMs - sourceCaptureAgeMs;
      if (!Number.isFinite(localizedMonotonicMs)) invalidClock();
      if (!this.#localized.has(quote)) {
        pending.push([quote, Object.freeze({ ...quote, receivedMonotonicMs: localizedMonotonicMs })]);
      }
    }
    for (const [original, localized] of pending) this.#localized.set(original, localized);
  }

  localize<T extends ProviderQuote>(quote: T): T {
    const localized = this.#localized.get(quote);
    if (localized === undefined) throw new Error("SABA_QUOTE_CLOCK_MAPPING_MISSING");
    return localized as T;
  }
}
