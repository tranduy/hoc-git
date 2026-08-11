import { describe, expect, it } from "vitest";
import { SessionApi } from "./sessions.js";

const status = {
  id: "manual-1",
  provider: "SABA",
  category: null,
  source: "MANUAL_PROVIDER_SESSION",
  state: "ACTIVE",
  trustedHostname: null,
  acquiredAtMs: 100,
  lastValidatedAtMs: 100,
  renewAfterMs: 86_400_100,
  secretConfigured: true,
  reason: null
} as const;

describe("SessionApi", () => {
  it("sends session secrets only in a no-store JSON POST body", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = new SessionApi(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } });
    });

    expect(await api.configureManual({ provider: "SABA", kind: "TOKEN", secret: "client-secret-canary" })).toEqual(status);

    expect(calls[0]?.url).toBe("/api/sessions/manual");
    expect(calls[0]?.url).not.toContain("client-secret-canary");
    expect(calls[0]?.init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      provider: "SABA", kind: "TOKEN", secret: "client-secret-canary"
    });
  });

  it("rejects malformed redacted responses with a generic message", async () => {
    const api = new SessionApi(async () => new Response(JSON.stringify({ ...status, token: "response-secret-canary" })));
    await expect(api.configureManual({ provider: "SABA", kind: "TOKEN", secret: "input-canary" }))
      .rejects.toThrowError("Invalid session response");
  });
});
