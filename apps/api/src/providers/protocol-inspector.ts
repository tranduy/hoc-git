import { createHash } from "node:crypto";

export type ObservedTransport = "FETCH" | "XHR" | "WEBSOCKET" | "NAVIGATION";

export interface ProtocolObservation {
  readonly hostname: string;
  readonly method: string;
  readonly transport: ObservedTransport;
  readonly pathTemplate: string;
  readonly status: number | null;
  readonly contentType: string | null;
  readonly bodyShapeHash?: string;
}

const ignoredHostSuffixes = [
  "livechatinc.com", "googletagmanager.com", "google-analytics.com", "cloudflareinsights.com"
];

function pathTemplate(pathname: string): string {
  return pathname.split("/").map((segment) => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
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
  if (url.protocol !== "https:") return null;
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

function structuralShape(value: unknown, depth = 0): unknown {
  if (depth >= 8) return "depth-limit";
  if (value === null) return "null";
  if (Array.isArray(value)) return [value.length === 0 ? "empty" : structuralShape(value[0], depth + 1)];
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [
      key, structuralShape((value as Record<string, unknown>)[key], depth + 1)
    ]));
  }
  return typeof value;
}

export function structuralBodyHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(structuralShape(value))).digest("hex");
}
