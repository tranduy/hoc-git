import { createHash } from "node:crypto";

export type ObservedTransport = "FETCH" | "XHR" | "WEBSOCKET" | "NAVIGATION" | "SCRIPT" | "EVENTSOURCE" | "OTHER";

export function observedTransportForResourceType(resourceType: string): ObservedTransport | null {
  if (resourceType === "xhr") return "XHR";
  if (resourceType === "fetch") return "FETCH";
  if (resourceType === "document") return "NAVIGATION";
  if (resourceType === "script") return "SCRIPT";
  if (resourceType === "eventsource") return "EVENTSOURCE";
  if (resourceType === "other") return "OTHER";
  return null;
}

export function attachWebSocketProtocolObserver(
  page: { on(event: "websocket", listener: (socket: { url(): string }) => void): unknown },
  record: (observation: ProtocolObservation) => void
): void {
  page.on("websocket", (socket) => {
    const observation = observeProtocolMetadata({
      url: socket.url(), method: "GET", transport: "WEBSOCKET", status: 101, contentType: null
    });
    if (observation !== null) record(observation);
  });
}

export interface ProtocolObservation {
  readonly hostname: string;
  readonly method: string;
  readonly transport: ObservedTransport;
  readonly pathTemplate: string;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly bodyShapeHash?: string;
}

export function protocolObservationSummary(
  input: ProtocolObservation & { readonly bodyShape?: unknown }
): ProtocolObservation {
  const { hostname, method, transport, pathTemplate, status, contentType, bodyShapeHash } = input;
  return bodyShapeHash === undefined
    ? { hostname, method, transport, pathTemplate, status, contentType }
    : { hostname, method, transport, pathTemplate, status, contentType, bodyShapeHash };
}

const ignoredHostSuffixes = [
  "livechatinc.com", "googletagmanager.com", "google-analytics.com", "cloudflareinsights.com", "mlytics.com"
];

const inspectionControlLabels = new Set([
  "show balance", "hiển thị số dư", "football", "bóng đá", "esports",
  "upcoming", "sắp diễn ra", "live", "trực tiếp"
]);

export const inspectionStructuralSelectors = [".c-iconcolor-sport1", ".c-iconcolor-sport43", "#refreshBtn"] as const;

export function inspectionStructuralSelectorIsSafe(selector: string): boolean {
  return inspectionStructuralSelectors.some((allowed) => selector === allowed);
}

const allowedProfileProbes = new Map<string, string>([
  ["/Customer/Balance", "POST"],
  ["/CashMember/GetUserInfo", "GET"]
]);

export function profileProbeAvailability(input: {
  readonly hasApiOrigin: boolean;
  readonly hasAccessToken: boolean;
}): "READY" | "NO_API_ORIGIN" | "NO_ACCESS_TOKEN" {
  if (!input.hasApiOrigin) return "NO_API_ORIGIN";
  return input.hasAccessToken ? "READY" : "NO_ACCESS_TOKEN";
}

export function extractTrustedApiOrigin(settings: unknown): string | null {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): string | null => {
    if (depth > 8 || typeof value !== "object" || value === null || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    const candidate = record.ApiBackendUrl;
    if (typeof candidate === "string") {
      try {
        const parsed = new URL(candidate);
        const pathname = parsed.pathname.replace(/\/$/u, "") || "/";
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password &&
          ["/", "/api"].includes(pathname) && !parsed.search && !parsed.hash) {
          return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
        }
      } catch { return null; }
    }
    for (const child of Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(settings, 0);
}

export function selectProfileApiOrigin(input: {
  readonly declaredOrigin: string | null;
  readonly observedSettingsOrigin: string | null;
}): string | null {
  return input.declaredOrigin ?? input.observedSettingsOrigin;
}

export function profileProbeIsSafe(input: {
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly method: string;
  readonly seenOrigins: readonly string[];
}): boolean {
  let origin: string;
  try {
    const parsed = new URL(input.baseUrl);
    const pathname = parsed.pathname.replace(/\/$/u, "") || "/";
    if (parsed.protocol !== "https:" || !["/", "/api"].includes(pathname) || parsed.search || parsed.hash ||
      parsed.username || parsed.password) return false;
    origin = `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch { return false; }
  return input.seenOrigins.includes(origin) && allowedProfileProbes.get(input.endpoint) === input.method;
}

export function inspectionControlIsSafe(label: string): boolean {
  return inspectionControlLabels.has(label.trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi"));
}

export function inspectionControlLabel(values: readonly string[]): string | null {
  for (const value of values) {
    const lines = value.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const textualLines = lines.filter((line) => !/^\d+$/u.test(line));
    if (textualLines.length !== 1 || !inspectionControlIsSafe(textualLines[0] ?? "")) continue;
    return textualLines[0]!.replace(/\s+/gu, " ").toLocaleLowerCase("vi");
  }
  return null;
}

export interface SafeControlShape {
  readonly tagName: string;
  readonly classTokens: readonly string[];
  readonly role?: "button" | "link" | "tab" | "menuitem";
  readonly label?: string;
}

export function safeControlShape(input: {
  readonly tagName: string;
  readonly className: string;
  readonly role: string | null;
  readonly labels: readonly string[];
}): SafeControlShape {
  const normalizedTag = input.tagName.trim().toLowerCase();
  const tagName = /^[a-z][a-z0-9-]{0,15}$/u.test(normalizedTag) ? normalizedTag : "unknown";
  const classTokens = input.className.split(/\s+/gu)
    .filter((token) => /(?:sport|live|upcoming|account|balance|event|market|nav|menu|item|link|btn|tab)/iu.test(token))
    .filter((token) => /^[A-Za-z0-9_-]{1,64}$/u.test(token))
    .sort();
  const role = /^(?:button|link|tab|menuitem)$/u.test(input.role ?? "")
    ? input.role as SafeControlShape["role"]
    : undefined;
  const label = inspectionControlLabel(input.labels) ?? undefined;
  return {
    tagName,
    classTokens,
    ...(role === undefined ? {} : { role }),
    ...(label === undefined ? {} : { label })
  };
}

const readOnlyEndpointWords = /(?:account|balance|profile|userinfo|cashmember|event|market|odds|match|sport|league|tournament)/iu;
const prohibitedEndpointWords = /(?:bet|place|submit|wager|ticket)/iu;

export function extractReadOnlyApiPathTemplates(source: string): readonly string[] {
  const results = new Set<string>();
  const endpointPattern = /["'`]((?:\/?api\/[A-Za-z0-9_.{}:-]+(?:\/[A-Za-z0-9_.{}:-]+){1,8}|\/[A-Za-z0-9_.{}:-]+(?:\/[A-Za-z0-9_.{}:-]+){1,8}))(?:\?[^"'`]*)?["'`]/giu;
  for (const match of source.matchAll(endpointPattern)) {
    const rawPath = match[1];
    if (rawPath === undefined || !readOnlyEndpointWords.test(rawPath) || prohibitedEndpointWords.test(rawPath)) continue;
    results.add(pathTemplate(rawPath.startsWith("/") ? rawPath : `/${rawPath}`));
  }
  return [...results].sort();
}

function pathTemplate(pathname: string): string {
  const segments = pathname.split("/");
  return segments.map((segment, index) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
    const parent = segments[index - 1]?.toLowerCase();
    if (["u", "user", "s", "session", "token", "auth"].includes(parent ?? "") && decoded.length > 0) return ":secret";
    if (/^\(S\([^)]{8,}\)\)$/u.test(decoded)) return ":session";
    if (/^\d+$/u.test(decoded) || /^[a-f0-9-]{16,}$/iu.test(decoded) || /^[A-Za-z0-9_-]{24,}$/u.test(decoded)) return ":id";
    return encodeURIComponent(decoded).replace(/%2F/giu, "%252F");
  }).join("/") || "/";
}

export function observeProtocolMetadata(input: {
  readonly url: string;
  readonly method: string;
  readonly transport: ObservedTransport;
  readonly status: number | null;
  readonly contentType: string | null;
}): ProtocolObservation | null {
  let url: URL;
  try { url = new URL(input.url); } catch { return null; }
  const expectedProtocol = input.transport === "WEBSOCKET" ? "wss:" : "https:";
  if (url.protocol !== expectedProtocol) return null;
  const hostname = url.hostname.toLowerCase();
  if (ignoredHostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) return null;
  return {
    hostname,
    method: input.method.toUpperCase().replace(/[^A-Z]/gu, "").slice(0, 12) || "UNKNOWN",
    transport: input.transport,
    pathTemplate: pathTemplate(url.pathname),
    status: input.status === null || !Number.isInteger(input.status) ? null : input.status,
    contentType: input.contentType?.split(";", 1)[0]?.trim().toLowerCase() || null
  };
}

function structuralShape(value: unknown, depth = 0, maxDepth = 8): unknown {
  if (depth >= maxDepth) return "depth-limit";
  if (value === null) return "null";
  if (Array.isArray(value)) return [value.length === 0 ? "empty" : structuralShape(value[0], depth + 1, maxDepth)];
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [
      key, structuralShape((value as Record<string, unknown>)[key], depth + 1, maxDepth)
    ]));
  }
  return typeof value;
}

export function structuralBodyShape(value: unknown): unknown {
  return structuralShape(value);
}

export function structuralBodyShapeAtDepth(value: unknown, maxDepth: number): unknown {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 20) throw new Error("invalid structural depth");
  return structuralShape(value, 0, maxDepth);
}

function redactedStringShape(value: string): { readonly encoding: "base64" | "hex" | "text"; readonly lengthBucket: string } {
  const lengthBucket = value.length < 16 ? "0-15" : value.length < 64 ? "16-63" :
    value.length < 256 ? "64-255" : value.length < 1_024 ? "256-1023" : "1024+";
  const encoding = value.length >= 16 && value.length % 2 === 0 && /^[a-f0-9]+$/iu.test(value)
    ? "hex"
    : value.length >= 16 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
      ? "base64"
      : "text";
  return { encoding, lengthBucket };
}

export function structuralWebSocketFrameShape(payload: unknown): unknown {
  if (typeof payload !== "string") return "binary";
  const stomp = structuralSockJsStompShape(payload);
  if (stomp !== null) return stomp;
  const objectStart = payload.indexOf("{");
  const arrayStart = payload.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) return "text";
  try {
    const parsed: unknown = JSON.parse(payload.slice(Math.min(...starts)));
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed.length >= 2) {
      const eventPayload = parsed[1];
      if (typeof eventPayload === "string" && /^[\[{]/u.test(eventPayload.trim())) {
        try {
          return { event: "string", payload: structuralBodyShape(JSON.parse(eventPayload) as unknown) };
        } catch { /* An opaque event payload remains a redacted string. */ }
      }
      if (typeof eventPayload === "string") {
        return { event: "string", payload: redactedStringShape(eventPayload) };
      }
      return { event: "string", payload: structuralBodyShape(eventPayload) };
    }
    return structuralBodyShape(parsed);
  } catch {
    return "text";
  }
}

function structuralSockJsStompShape(payload: string): unknown | null {
  const candidate = payload.startsWith("a[") ? payload.slice(1) : payload.startsWith("[") ? payload : null;
  if (candidate === null) return null;
  let frames: unknown;
  try { frames = JSON.parse(candidate); } catch { return null; }
  if (!Array.isArray(frames) || frames.length === 0 || frames.some((item) => typeof item !== "string")) return null;
  const shapes = (frames as string[]).flatMap((frame) => {
    const separator = frame.indexOf("\n\n");
    const head = separator < 0 ? frame.replace(/\0+$/u, "") : frame.slice(0, separator);
    const lines = head.split("\n");
    const command = lines.shift()?.trim() ?? "";
    if (!/^[A-Z]{2,24}$/u.test(command)) return [];
    const headers = lines.flatMap((line) => {
      const colon = line.indexOf(":");
      const name = colon < 1 ? "" : line.slice(0, colon).trim().toLowerCase();
      return /^[a-z0-9_-]{1,64}$/u.test(name) ? [name] : [];
    }).sort();
    const rawBody = separator < 0 ? "" : frame.slice(separator + 2).replace(/\0+$/u, "").trim();
    let body: unknown = rawBody.length === 0 ? null : redactedStringShape(rawBody);
    if (/^[\[{]/u.test(rawBody)) {
      try {
        const parsedBody = JSON.parse(rawBody) as unknown;
        body = structuralBodyShapeAtDepth(parsedBody, 12);
        if (typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)) {
          const nested = (parsedBody as Record<string, unknown>).body;
          if (typeof nested === "string" && /^[\[{]/u.test(nested.trim())) {
            try {
              (body as Record<string, unknown>).body = structuralBodyShapeAtDepth(JSON.parse(nested) as unknown, 16);
            } catch { /* The outer redacted string shape remains safe. */ }
          }
        }
      } catch { /* Redacted string shape is safe. */ }
    }
    return [{ command, headers, body }];
  });
  return shapes.length === 0 ? null : { protocol: "SOCKJS_STOMP", frames: shapes };
}

export function structuralBodyHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(structuralBodyShape(value))).digest("hex");
}
