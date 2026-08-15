const MAX_PAYLOAD_BYTES = 256 * 1024;

const SECRET_KEY = /(?:authorization|cookie|loginname|operator.?token|password|secret|session|token|api.?key)/iu;
const DROP_CONTAINER = /^(?:headers?|cookies?)$/iu;

export type RedactedNetworkEnvelope = Record<string, unknown>;

function serializedBytes(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("BRIDGE_PAYLOAD_INVALID");
  }
  if (serialized === undefined) throw new Error("BRIDGE_PAYLOAD_INVALID");
  return new TextEncoder().encode(serialized).byteLength;
}

function sanitizeUrl(value: string): { hostname: string; pathnameClass: string } | null {
  try {
    const parsed = new URL(value);
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathnameClass: parsed.pathname || "/"
    };
  } catch {
    return null;
  }
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) throw new Error("BRIDGE_PAYLOAD_INVALID");
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => redactValue(item, seen)).filter((item) => item !== undefined);
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || DROP_CONTAINER.test(key)) continue;
    if (/url$/iu.test(key) && typeof nestedValue === "string") {
      const sanitized = sanitizeUrl(nestedValue);
      if (sanitized) {
        if (/^url$/iu.test(key)) Object.assign(result, sanitized);
        else result[key] = sanitized;
      }
      continue;
    }
    if (/^(?:body|payload)$/iu.test(key) && typeof nestedValue === "string") {
      try {
        const parsed = JSON.parse(nestedValue) as unknown;
        result[key] = JSON.stringify(redactValue(parsed, seen));
      } catch {
        result[key] = nestedValue;
      }
      continue;
    }
    const redacted = redactValue(nestedValue, seen);
    if (redacted !== undefined) result[key] = redacted;
  }
  seen.delete(value);
  return result;
}

export function redactNetworkEnvelope(value: unknown): RedactedNetworkEnvelope {
  if (serializedBytes(value) > MAX_PAYLOAD_BYTES) throw new Error("BRIDGE_PAYLOAD_TOO_LARGE");
  const redacted = redactValue(value, new WeakSet<object>());
  if (redacted === null || typeof redacted !== "object" || Array.isArray(redacted)) {
    throw new Error("BRIDGE_PAYLOAD_INVALID");
  }
  if (serializedBytes(redacted) > MAX_PAYLOAD_BYTES) throw new Error("BRIDGE_PAYLOAD_TOO_LARGE");
  return redacted as RedactedNetworkEnvelope;
}
