import {
  RedactedSessionStatusSchema,
  SessionStatusListSchema,
  type RedactedSessionStatus,
  type SessionStatusList
} from "@tool-chenh/contracts";

export interface FabetDiscoveryResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly finalHostname: string;
  readonly trusted: boolean;
}

export type ManualSessionInput = {
  readonly provider: string;
  readonly kind: "TOKEN" | "COOKIE_BUNDLE" | "LAUNCH_URL";
  readonly secret: string;
};

export class SessionApi {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
  }

  async list(): Promise<SessionStatusList> {
    const value = await this.#request("/api/sessions");
    const parsed = SessionStatusListSchema.safeParse(value);
    if (!parsed.success) throw new Error("Invalid session response");
    return parsed.data;
  }

  async discoverFabet(entryUrl: string): Promise<FabetDiscoveryResult> {
    const value = await this.#request("/api/sessions/fabet/discover", { entryUrl });
    if (
      typeof value !== "object" || value === null ||
      typeof (value as Record<string, unknown>).requestedUrl !== "string" ||
      typeof (value as Record<string, unknown>).finalUrl !== "string" ||
      typeof (value as Record<string, unknown>).finalHostname !== "string" ||
      typeof (value as Record<string, unknown>).trusted !== "boolean"
    ) throw new Error("Invalid domain response");
    return value as FabetDiscoveryResult;
  }

  async trustFabet(hostname: string): Promise<{ readonly hostname: string; readonly trusted: true }> {
    const value = await this.#request("/api/sessions/fabet/trust", { hostname });
    if (
      typeof value !== "object" || value === null ||
      typeof (value as Record<string, unknown>).hostname !== "string" ||
      (value as Record<string, unknown>).trusted !== true
    ) throw new Error("Invalid domain response");
    return value as { hostname: string; trusted: true };
  }

  configureFabet(input: {
    readonly entryUrl: string;
    readonly trustedHostname: string;
    readonly username: string;
    readonly password: string;
  }): Promise<RedactedSessionStatus> {
    return this.#statusRequest("/api/sessions/fabet/configure", input);
  }

  configureManual(input: ManualSessionInput): Promise<RedactedSessionStatus> {
    return this.#statusRequest("/api/sessions/manual", input);
  }

  validate(id: string): Promise<RedactedSessionStatus> {
    return this.#statusRequest(`/api/sessions/${encodeURIComponent(id)}/validate`, {});
  }

  renew(id: string): Promise<RedactedSessionStatus> {
    return this.#statusRequest(`/api/sessions/${encodeURIComponent(id)}/renew`, {});
  }

  async resetFabet(): Promise<void> {
    await this.#request("/api/sessions/fabet/reset", { confirmation: "RESET_FABET" });
  }

  async #statusRequest(url: string, body: object): Promise<RedactedSessionStatus> {
    const parsed = RedactedSessionStatusSchema.safeParse(await this.#request(url, body));
    if (!parsed.success) throw new Error("Invalid session response");
    return parsed.data;
  }

  async #request(url: string, body?: object): Promise<unknown> {
    const response = await this.#fetch(url, body === undefined ? {
      method: "GET",
      cache: "no-store"
    } : {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Session request failed (${response.status})`);
    try {
      return await response.json();
    } catch {
      throw new Error("Invalid session response");
    }
  }
}
