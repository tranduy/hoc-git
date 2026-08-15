import { describe, expect, it } from "vitest";

describe("redactNetworkEnvelope", () => {
  it.each(["token", "operatorToken", "cookie", "authorization", "session", "loginname"])(
    "removes %s recursively and from URLs",
    async (secretKey) => {
      const module = await import("./redactor.js");
      const input = {
        url: `https://sports.example/feed?${secretKey}=super-secret#super-secret`,
        headers: { [secretKey]: "super-secret", safe: "application/json" },
        nested: { [secretKey]: "super-secret", value: 2 }
      };
      const redacted = module.redactNetworkEnvelope(input);
      expect(JSON.stringify(redacted)).not.toContain("super-secret");
      expect(redacted).toMatchObject({
        hostname: "sports.example",
        pathnameClass: "/feed",
        nested: { value: 2 }
      });
    }
  );

  it("rejects a serialized payload larger than 256 KiB", async () => {
    const module = await import("./redactor.js");
    expect(() => module.redactNetworkEnvelope({ body: "x".repeat(262_145) })).toThrow("BRIDGE_PAYLOAD_TOO_LARGE");
  });

  it("redacts secret fields embedded in a JSON network body", async () => {
    const module = await import("./redactor.js");
    const redacted = module.redactNetworkEnvelope({
      body: JSON.stringify({ eventId: 42, token: "super-secret", nested: { cookie: "super-secret", odds: 1.95 } })
    });
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(JSON.parse(redacted.body as string)).toEqual({ eventId: 42, nested: { odds: 1.95 } });
  });

  it("replaces URL-valued fields with hostname and pathname metadata", async () => {
    const module = await import("./redactor.js");
    const redacted = module.redactNetworkEnvelope({
      responseUrl: "https://user:super-secret@sports.example/feed/42?token=super-secret#super-secret"
    });
    expect(JSON.stringify(redacted)).not.toContain("super-secret");
    expect(redacted).toEqual({
      responseUrl: { hostname: "sports.example", pathnameClass: "/feed/42" }
    });
  });
});
