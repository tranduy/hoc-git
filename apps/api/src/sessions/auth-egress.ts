export interface PlaywrightProxySettings {
  readonly server: string;
}

export interface AuthEgressLease {
  readonly name: string;
  readonly playwrightProxy: PlaywrightProxySettings | null;
  release(): Promise<void>;
}

export interface AuthEgress {
  readonly name: string;
  acquire(signal: AbortSignal): Promise<AuthEgressLease>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

function inertLease(
  name: string,
  playwrightProxy: PlaywrightProxySettings | null,
): AuthEgressLease {
  return {
    name,
    playwrightProxy,
    async release() {
      // Direct and externally managed proxies have no owned resource to release.
    },
  };
}

export class DirectAuthEgress implements AuthEgress {
  readonly name = "DIRECT";

  async acquire(signal: AbortSignal): Promise<AuthEgressLease> {
    throwIfAborted(signal);
    return inertLease(this.name, null);
  }
}

export class ConfiguredProxyAuthEgress implements AuthEgress {
  readonly name = "CONFIGURED_PROXY";
  readonly #server: string;

  constructor(proxyUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      throw new Error("Configured auth proxy must be an absolute URL");
    }
    if (!["http:", "https:", "socks5:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported auth proxy protocol: ${parsed.protocol}`);
    }
    if (parsed.username || parsed.password) {
      throw new Error("Proxy credentials must not be embedded in the proxy URL");
    }
    if (!parsed.hostname || !parsed.port) {
      throw new Error("Configured auth proxy must include host and port");
    }
    if (!["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) {
      throw new Error("Configured auth proxy must not include path, query, or fragment");
    }
    this.#server = `${parsed.protocol}//${parsed.host}`;
  }

  async acquire(signal: AbortSignal): Promise<AuthEgressLease> {
    throwIfAborted(signal);
    return inertLease(this.name, { server: this.#server });
  }
}

export { throwIfAborted };
