import { describe, expect, it } from "vitest";
import {
  inspectionControlIsSafe,
  inspectionControlLabel,
  inspectionStructuralSelectorIsSafe,
  attachWebSocketProtocolObserver,
  extractReadOnlyApiPathTemplates,
  observedTransportForResourceType,
  observeProtocolMetadata,
  protocolObservationSummary,
  structuralWebSocketFrameShape,
  safeControlShape,
  profileProbeIsSafe,
  profileProbeAvailability,
  extractTrustedApiOrigin,
  selectProfileApiOrigin,
  structuralBodyHash,
  structuralBodyShapeAtDepth,
  structuralBodyShape
} from "./protocol-inspector.js";

describe("protocol inspector", () => {
  it("removes query, fragment, credentials, and identifier-shaped path values", () => {
    expect(observeProtocolMetadata({
      url: "https://user:pass@api.cmd.test/events/41385687/odds?token=secret-canary#authorization",
      method: "GET", transport: "FETCH", status: 200, contentType: "application/json"
    })).toEqual({
      hostname: "api.cmd.test", method: "GET", transport: "FETCH",
      pathTemplate: "/events/:id/odds", status: 200, contentType: "application/json"
    });
  });

  it("records script bundle metadata without query parameters", () => {
    expect(observedTransportForResourceType("script")).toBe("SCRIPT");
    expect(observeProtocolMetadata({
      url: "https://sports.cmd.test/assets/app.abc123.js?token=secret-canary",
      method: "GET", transport: "SCRIPT", status: 200, contentType: "application/javascript"
    })).toEqual({
      hostname: "sports.cmd.test", method: "GET", transport: "SCRIPT",
      pathTemplate: "/assets/app.abc123.js", status: 200, contentType: "application/javascript"
    });
  });

  it("maps streamed and service-worker resources for provider discovery", () => {
    expect(observedTransportForResourceType("eventsource")).toBe("EVENTSOURCE");
    expect(observedTransportForResourceType("other")).toBe("OTHER");
    expect(observedTransportForResourceType("image")).toBeNull();
  });

  it("observes websocket metadata from an already-open provider page", () => {
    let listener: ((socket: { url(): string }) => void) | undefined;
    const page = {
      on(event: "websocket", next: (socket: { url(): string }) => void) {
        expect(event).toBe("websocket");
        listener = next;
      }
    };
    const observations: unknown[] = [];
    attachWebSocketProtocolObserver(page, (observation) => observations.push(observation));
    listener?.({ url: () => "wss://stream.cmd.test/socket.io/?token=secret-canary" });
    expect(observations).toEqual([{
      hostname: "stream.cmd.test", method: "GET", transport: "WEBSOCKET",
      pathTemplate: "/socket.io/", status: 101, contentType: null
    }]);
  });

  it.each([
    "https://secure.livechatinc.com/customer/action",
    "https://www.googletagmanager.com/collect",
    "https://static.cloudflareinsights.com/beacon",
    "https://beacon.mlytics.com/v1/collect"
  ])("ignores non-provider telemetry host %s", (url) => {
    expect(observeProtocolMetadata({ url, method: "GET", transport: "FETCH", status: 200, contentType: null })).toBeNull();
  });

  it("hashes body structure without retaining values", () => {
    const first = structuralBodyHash({ account: { balance: 100_000, name: "secret-name" }, events: [{ id: 1 }] });
    const second = structuralBodyHash({ account: { balance: 50, name: "other-secret" }, events: [{ id: 999 }] });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain("secret");
    expect(structuralBodyShape({ account: { balance: 100_000, name: "secret-name" }, events: [{ id: 1 }] }))
      .toEqual({ account: { balance: "number", name: "string" }, events: [{ id: "number" }] });
    expect(JSON.stringify(structuralBodyShape({ token: "secret-canary" }))).not.toContain("secret-canary");
  });

  it("can inspect a deeper provider catalog shape without retaining values", () => {
    const shape = structuralBodyShapeAtDepth({ levels: [{ match: [{ odds: [{ secret: "canary" }] }] }] }, 12);
    expect(shape).toEqual({ levels: [{ match: [{ odds: [{ secret: "string" }] }] }] });
    expect(JSON.stringify(shape)).not.toContain("canary");
  });

  it("redacts ASP.NET session-routing path segments", () => {
    expect(observeProtocolMetadata({
      url: "https://sports.cmd.test/(S(Tesqedix87fa7fb3816a427abcd6196bc4d345f9))/LoginCheckin/Index",
      method: "POST", transport: "XHR", status: 200, contentType: "application/json"
    })?.pathTemplate).toBe("/:session/LoginCheckin/Index");
  });

  it.each([
    ["Show Balance", true], ["Hiển thị số dư", true], ["Football", true], ["Esports", true],
    ["Upcoming", true], ["Live", true], ["Place Bet", false], ["Đặt cược", false],
    ["Deposit", false], ["1.95", false]
  ])("classifies read-only inspection control %s", (label, expected) => {
    expect(inspectionControlIsSafe(label)).toBe(expected);
  });

  it("finds an allowlisted label in nested text or accessibility metadata", () => {
    expect(inspectionControlLabel(["12\nFootball", "Sports menu", ""])).toBe("football");
    expect(inspectionControlLabel(["", "Hiển thị số dư", "Account control"])).toBe("hiển thị số dư");
    expect(inspectionControlLabel(["Place Bet\nFootball", "", ""])).toBeNull();
  });

  it("summarizes an observation without response-body structure", () => {
    expect(protocolObservationSummary({
      hostname: "sports.cmd.test", method: "POST", transport: "XHR",
      pathTemplate: "/api/events", status: 200, contentType: "application/json",
      bodyShapeHash: "a".repeat(64), bodyShape: { token: "string", balance: "number" }
    })).toEqual({
      hostname: "sports.cmd.test", method: "POST", transport: "XHR",
      pathTemplate: "/api/events", status: 200, contentType: "application/json",
      bodyShapeHash: "a".repeat(64)
    });
  });

  it("extracts only read-only sportsbook endpoint templates from scripts", () => {
    const source = [
      '"/api/Event/GetEvents"',
      '"api/Account/GetBalance?token=secret-canary"',
      '"/api/Market/GetOdds/41385687"',
      '"/CashMember/GetUserInfo"',
      '"/api/Bet/PlaceBet"',
      '"/api/Wager/SubmitTicket"',
      '"secret-canary"'
    ].join(";");
    const result = extractReadOnlyApiPathTemplates(source);
    expect(result).toEqual([
      "/CashMember/GetUserInfo",
      "/api/Account/GetBalance",
      "/api/Event/GetEvents",
      "/api/Market/GetOdds/:id"
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-canary");
  });

  it("describes socket.io frame structure without event names or values", () => {
    const shape = structuralWebSocketFrameShape(
      '42["odds-secret-canary",{"token":"secret-canary","marketId":41385687,"prices":[1.95]}]'
    );
    expect(shape).toEqual({
      event: "string",
      payload: { marketId: "number", prices: ["number"], token: "string" }
    });
    expect(JSON.stringify(shape)).not.toContain("secret-canary");
    expect(structuralWebSocketFrameShape(new Uint8Array([1, 2, 3]))).toBe("binary");
    expect(structuralWebSocketFrameShape(
      '42["catalog-secret-canary","{\\"events\\":[{\\"matchId\\":7,\\"odds\\":[1.8]}],\\"token\\":\\"secret-canary\\"}"]'
    )).toEqual({
      event: "string",
      payload: { events: [{ matchId: "number", odds: ["number"] }], token: "string" }
    });
    expect(structuralWebSocketFrameShape('42["event","QUJDREVGR0hJSktMTU5PUA=="]')).toEqual({
      event: "string", payload: { encoding: "base64", lengthBucket: "16-63" }
    });
  });

  it("describes candidate controls without free text or unrelated class tokens", () => {
    expect(safeControlShape({
      tagName: "DIV",
      className: "user-secret-canary c-side-account account-balance",
      role: "button",
      labels: ["Secret User", "Show Balance", ""]
    })).toEqual({
      tagName: "div",
      classTokens: ["account-balance", "c-side-account"],
      role: "button",
      label: "show balance"
    });
    expect(JSON.stringify(safeControlShape({
      tagName: "DIV", className: "user-secret-canary", role: null, labels: ["secret-canary"]
    }))).not.toContain("secret-canary");
  });

  it.each([
    [".c-iconcolor-sport1", true],
    [".c-iconcolor-sport43", true],
    ["#refreshBtn", true],
    [".c-match__odds", false],
    [".c-ticket", false],
    ["[data-bet]", false]
  ])("allows only read-only structural category selector %s", (selector, expected) => {
    expect(inspectionStructuralSelectorIsSafe(selector)).toBe(expected);
  });

  it("allows only known profile probes on an origin observed in the current session", () => {
    const seenOrigins = ["https://api.cmd.test"];
    expect(profileProbeIsSafe({
      baseUrl: "https://api.cmd.test", endpoint: "/Customer/Balance", method: "POST", seenOrigins
    })).toBe(true);
    expect(profileProbeIsSafe({
      baseUrl: "https://api.cmd.test/api", endpoint: "/Customer/Balance", method: "POST",
      seenOrigins: ["https://api.cmd.test/api"]
    })).toBe(true);
    expect(profileProbeIsSafe({
      baseUrl: "https://api.cmd.test", endpoint: "/CashMember/GetUserInfo", method: "GET", seenOrigins
    })).toBe(true);
    expect(profileProbeIsSafe({
      baseUrl: "https://api.cmd.test", endpoint: "/Bet/PlaceBet", method: "POST", seenOrigins
    })).toBe(false);
    expect(profileProbeIsSafe({
      baseUrl: "https://evil.test", endpoint: "/Customer/Balance", method: "POST", seenOrigins
    })).toBe(false);
    expect(profileProbeIsSafe({
      baseUrl: "http://api.cmd.test", endpoint: "/Customer/Balance", method: "POST", seenOrigins
    })).toBe(false);
  });

  it("reports profile probe readiness without exposing origin or token values", () => {
    expect(profileProbeAvailability({ hasApiOrigin: false, hasAccessToken: true })).toBe("NO_API_ORIGIN");
    expect(profileProbeAvailability({ hasApiOrigin: true, hasAccessToken: false })).toBe("NO_ACCESS_TOKEN");
    expect(profileProbeAvailability({ hasApiOrigin: true, hasAccessToken: true })).toBe("READY");
  });

  it("extracts only a clean HTTPS API origin from provider settings", () => {
    expect(extractTrustedApiOrigin({ nested: { ApiBackendUrl: "https://api.cmd.test/" } }))
      .toBe("https://api.cmd.test");
    expect(extractTrustedApiOrigin({ ApiBackendUrl: "https://api.cmd.test/api/" }))
      .toBe("https://api.cmd.test/api");
    expect(extractTrustedApiOrigin({ ApiBackendUrl: "https://user:pass@api.cmd.test/" })).toBeNull();
    expect(extractTrustedApiOrigin({ ApiBackendUrl: "http://api.cmd.test/" })).toBeNull();
    expect(extractTrustedApiOrigin({ ApiBackendUrl: "https://api.cmd.test/?token=secret-canary" })).toBeNull();
  });

  it("prefers a declared API origin and otherwise uses the observed settings origin", () => {
    expect(selectProfileApiOrigin({
      declaredOrigin: "https://declared.cmd.test", observedSettingsOrigin: "https://observed.cmd.test"
    })).toBe("https://declared.cmd.test");
    expect(selectProfileApiOrigin({
      declaredOrigin: null, observedSettingsOrigin: "https://observed.cmd.test"
    })).toBe("https://observed.cmd.test");
    expect(selectProfileApiOrigin({ declaredOrigin: null, observedSettingsOrigin: null })).toBeNull();
  });
});
