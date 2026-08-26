export interface SbobetStompProviderReceipt {
  readonly destination: string;
  readonly subscription: string | null;
  readonly messageId: string | null;
  readonly receiptSequence: number | null;
  readonly body: unknown;
}

function sockJsStrings(payload: string): readonly string[] | null {
  const candidate = payload.startsWith("a[") ? payload.slice(1) : payload.startsWith("[") ? payload : null;
  if (candidate === null) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

type StompTransport = "RAW" | "SOCKJS";

function stompFragments(payload: string, pendingTransport: StompTransport | null): {
  readonly fragments: readonly string[]; readonly transport: StompTransport
} | null {
  if (pendingTransport === "RAW") return { fragments: [payload], transport: "RAW" };
  const sockJs = sockJsStrings(payload);
  if (sockJs !== null) return { fragments: sockJs, transport: "SOCKJS" };
  if (pendingTransport === "SOCKJS") return { fragments: [payload], transport: "SOCKJS" };
  return /^(?:CONNECTED|MESSAGE|RECEIPT|ERROR)\r?\n/u.test(payload)
    ? { fragments: [payload], transport: "RAW" } : null;
}

function headers(value: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of value.split("\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator > 0) result[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return result;
}

function receiptSequence(messageId: string | null): number | null {
  const match = messageId === null ? null : /(?:^|[-:])(\d+)$/u.exec(messageId);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export class SbobetStompReceiptDecoder {
  #pending = "";
  #pendingTransport: StompTransport | null = null;

  reset(): void {
    this.#pending = "";
    this.#pendingTransport = null;
  }

  push(payload: string): readonly SbobetStompProviderReceipt[] {
    const input = stompFragments(payload, this.#pendingTransport);
    if (input === null) return [];
    const output: SbobetStompProviderReceipt[] = [];
    for (const fragment of input.fragments) {
      if (this.#pending === "" && fragment.trim() === "") continue;
      this.#pendingTransport = input.transport;
      this.#pending += fragment;
      if (this.#pending.length > 4_000_000) { this.reset(); continue; }
      let terminator = this.#pending.indexOf("\0");
      while (terminator >= 0) {
        const frame = this.#pending.slice(0, terminator);
        this.#pending = this.#pending.slice(terminator + 1);
        terminator = this.#pending.indexOf("\0");
        const separator = frame.indexOf("\n\n");
        if (separator < 0 || frame.slice(0, separator).split("\n")[0]?.trim() !== "MESSAGE") continue;
        const frameHeaders = headers(frame.slice(0, separator));
        const destination = frameHeaders.destination;
        if (destination === undefined) continue;
        let outer: unknown;
        try { outer = JSON.parse(frame.slice(separator + 2).trim()) as unknown; } catch { continue; }
        if (typeof outer !== "object" || outer === null || Array.isArray(outer)) continue;
        const receipt = outer as Record<string, unknown>;
        if ((receipt.statusCode !== undefined && receipt.statusCode !== "OK") ||
          (receipt.statusCodeValue !== undefined && receipt.statusCodeValue !== 200) ||
          typeof receipt.body !== "string") continue;
        let body: unknown;
        try { body = JSON.parse(receipt.body) as unknown; } catch { continue; }
        const messageId = frameHeaders["message-id"] ?? null;
        output.push({ destination, subscription: frameHeaders.subscription ?? null,
          messageId, receiptSequence: receiptSequence(messageId), body });
      }
    }
    if (this.#pending === "") this.#pendingTransport = null;
    return output;
  }
}

export function decodeSbobetStompBodies(payload: string): readonly unknown[] {
  return new SbobetStompReceiptDecoder().push(payload).map((receipt) => receipt.body);
}

export function decodeSbobetJsonBody(payload: string): readonly unknown[] {
  try { return [JSON.parse(payload) as unknown]; } catch { return []; }
}

export function extractSbobetSnapshotPublicIds(body: unknown): readonly string[] {
  const ids = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20 || ids.size >= 5_000 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 10_000).forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    const groups = record["7"];
    const eventId = record["8"];
    if ((typeof eventId === "string" || typeof eventId === "number") &&
      /^\d{1,30}$/u.test(String(eventId)) && typeof record["2"] === "string" &&
      typeof record["3"] === "string" && groups !== null && typeof groups === "object" && !Array.isArray(groups)) {
      ids.add(String(eventId));
      for (const rows of Object.values(groups as Record<string, unknown>)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows.slice(0, 100)) {
          if (typeof row !== "string") continue;
          for (const match of row.matchAll(/\*(\d{1,40})[had]\b/gu)) ids.add(match[1]!);
          for (const token of row.trim().split(/\s+/u)) if (/^\d{4,30}$/u.test(token)) ids.add(token);
        }
      }
    }
    Object.values(record).slice(0, 10_000).forEach((child) => visit(child, depth + 1));
  };
  visit(body, 0);
  return [...ids];
}

export function hasSbobetSocketCatalogCorrelation(
  bodies: readonly unknown[], publicEventIds: readonly string[]
): boolean {
  const targets = new Set(publicEventIds.filter((value) => /^\d{1,30}$/u.test(value)));
  if (targets.size === 0) return false;
  return bodies.some((body) => extractSbobetSnapshotPublicIds(body).some((id) => targets.has(id)));
}

export function nextSbobetSocketDirtyAtMs(
  currentDirtyAtMs: number | null,
  lastSignalAtMs: number | null,
  nowMs: number,
  minimumIntervalMs = 250
): number | null {
  if (currentDirtyAtMs !== null) return currentDirtyAtMs;
  if (lastSignalAtMs !== null && nowMs - lastSignalAtMs < minimumIntervalMs) return null;
  return nowMs;
}

export function isSbobetPublicFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && /\/sport\/info\/?$/u.test(url.pathname);
  } catch { return false; }
}

export function isSbobetSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "wss:" && !url.username && !url.password &&
      (hostname === "sb21.net" || hostname.endsWith(".sb21.net"));
  } catch { return false; }
}

export function isSbobetResponseCandidate(value: string, resourceType: string): boolean {
  if (resourceType !== "xhr" && resourceType !== "fetch") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

export function appendBoundedSbobetSocketPayload(
  buffer: string[],
  payload: string,
  limits: { readonly maxFrameChars: number; readonly maxTotalChars: number; readonly maxFrames: number } = {
    maxFrameChars: 2_000_000, maxTotalChars: 8_000_000, maxFrames: 200
  }
): void {
  if (payload.length > limits.maxFrameChars) return;
  buffer.push(payload);
  let totalChars = buffer.reduce((total, value) => total + value.length, 0);
  while (buffer.length > limits.maxFrames || totalChars > limits.maxTotalChars) {
    totalChars -= buffer.shift()?.length ?? 0;
  }
}

export interface SbobetCorrelationEvidence {
  readonly target: string;
  readonly path: string;
  readonly keys: readonly string[];
}

export function correlateSbobetPublicIds(
  bodies: readonly unknown[], targets: readonly string[]
): readonly SbobetCorrelationEvidence[] {
  const wanted = new Set(targets.filter((target) => /^\d{1,24}$/u.test(target)));
  const found = new Map<string, SbobetCorrelationEvidence>();
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 20 || found.size === wanted.size || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const childPath = `${path}.${/^\d+$/u.test(key) ? key : "*"}`;
      const scalar = typeof child === "string" || typeof child === "number" ? String(child) : null;
      if (scalar !== null && wanted.has(scalar) && !found.has(scalar)) {
        found.set(scalar, {
          target: scalar,
          path: childPath,
          // The direct feed uses numeric schema keys. Keeping only those keys is
          // sufficient for correlation and prevents diagnostic output from ever
          // repeating auth/session field names added by a transport wrapper.
          keys: Object.keys(record).filter((candidate) => /^\d+$/u.test(candidate)).sort()
        });
      }
      visit(child, childPath, depth + 1);
    }
  };
  bodies.forEach((body, index) => visit(body, `$[${index}]`, 0));
  return [...found.values()].sort((left, right) => left.target.localeCompare(right.target));
}
