import { TrustedDomainStore } from "./trusted-domain-store.js";

export type DomainDiscoveryErrorCode =
  | "INVALID_URL"
  | "INSECURE_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "UNREACHABLE";

export class DomainDiscoveryError extends Error {
  readonly code: DomainDiscoveryErrorCode;

  constructor(code: DomainDiscoveryErrorCode) {
    super(code);
    this.name = "DomainDiscoveryError";
    this.code = code;
  }
}

export interface DomainDiscoveryResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly trusted: boolean;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DomainDiscoveryOptions {
  readonly trustStore: TrustedDomainStore;
  readonly fetch: FetchLike;
}

function safeHttpsUrl(input: string | URL, errorCode: DomainDiscoveryErrorCode): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input) : new URL(input);
  } catch {
    throw new DomainDiscoveryError(errorCode);
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new DomainDiscoveryError(errorCode);
  }
  return url;
}

export class DomainDiscovery {
  readonly #trustStore: TrustedDomainStore;
  readonly #fetch: FetchLike;

  constructor(options: DomainDiscoveryOptions) {
    this.#trustStore = options.trustStore;
    this.#fetch = options.fetch;
  }

  async discover(entryUrl: string): Promise<DomainDiscoveryResult> {
    const requested = safeHttpsUrl(entryUrl, "INVALID_URL");
    let current = requested;

    for (let hop = 0; hop <= 5; hop += 1) {
      let response: Response;
      try {
        response = await this.#fetch(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { accept: "text/html,application/xhtml+xml" }
        });
      } catch {
        throw new DomainDiscoveryError("UNREACHABLE");
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) throw new DomainDiscoveryError("UNREACHABLE");
        if (hop === 5) throw new DomainDiscoveryError("TOO_MANY_REDIRECTS");
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new DomainDiscoveryError("INSECURE_REDIRECT");
        }
        current = safeHttpsUrl(next, "INSECURE_REDIRECT");
        continue;
      }

      return {
        requestedUrl: requested.href,
        finalUrl: current.href,
        finalHostname: current.hostname,
        trusted: await this.#trustStore.isTrusted(current.hostname)
      };
    }

    throw new DomainDiscoveryError("TOO_MANY_REDIRECTS");
  }
}
