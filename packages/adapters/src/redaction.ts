const REDACTED = "REDACTED";
const CIRCULAR = "[Circular]";

const secretKeys = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "cookie",
  "setcookie",
  "authorization",
  "auth",
  "account",
  "accountid",
  "member",
  "membercode",
  "session",
  "sessionid",
  "sid",
  "password",
  "passwd",
  "secret",
  "apikey",
  "clientsecret"
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return secretKeys.has(normalized)
    || normalized.endsWith("token")
    || normalized.endsWith("cookie")
    || normalized.endsWith("password")
    || normalized.endsWith("secret")
    || normalized.endsWith("apikey")
    || normalized.endsWith("authorization");
}

function decodeQueryKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/gu, " "));
  } catch {
    return key;
  }
}

function redactUrlQuery(value: string): string {
  const queryStart = value.indexOf("?");
  const fragmentStart = value.indexOf("#");
  if (queryStart < 0 || (fragmentStart >= 0 && fragmentStart < queryStart)) return value;

  const queryEnd = fragmentStart >= 0 ? fragmentStart : value.length;
  const query = value.slice(queryStart + 1, queryEnd);
  if (query.length === 0) return value;

  const redactedQuery = query.split("&").map((part) => {
    const equals = part.indexOf("=");
    const rawKey = equals >= 0 ? part.slice(0, equals) : part;
    return isSecretKey(decodeQueryKey(rawKey)) ? `${rawKey}=${REDACTED}` : part;
  }).join("&");

  return `${value.slice(0, queryStart + 1)}${redactedQuery}${value.slice(queryEnd)}`;
}

function redactValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === "string") return redactUrlQuery(value);
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return CIRCULAR;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, ancestors));
    }

    const entries: Array<[string, unknown]> = [];
    for (const key of Object.keys(value)) {
      entries.push([
        key,
        isSecretKey(key)
          ? REDACTED
          : redactValue((value as Record<string, unknown>)[key], ancestors)
      ]);
    }
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

export function redactCapture(value: unknown): unknown {
  try {
    return redactValue(value, new WeakSet());
  } catch {
    throw new Error("Unable to redact capture");
  }
}
