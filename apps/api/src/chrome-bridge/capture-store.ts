import { appendFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";

export interface CaptureStoreOptions {
  readonly enabled: boolean;
  readonly directory: string;
  readonly maxEntries?: number;
  readonly maxFileBytes?: number;
  readonly maxFiles?: number;
  readonly writeLine?: (path: string, line: string) => Promise<void>;
  readonly now?: () => number;
}

export class CaptureStore {
  readonly #enabled: boolean;
  readonly #directory: string;
  readonly #maxEntries: number;
  readonly #writeLine: (path: string, line: string) => Promise<void>;
  readonly #captureEpoch: number;
  readonly #maxFileBytes: number;
  readonly #maxFiles: number;
  readonly #ring: ChromeBridgeEnvelope[] = [];
  #fileIndex = 0;
  #fileBytes = 0;

  constructor(options: CaptureStoreOptions) {
    this.#enabled = options.enabled;
    this.#directory = options.directory;
    this.#maxEntries = options.maxEntries ?? 1_000;
    this.#captureEpoch = (options.now ?? Date.now)();
    this.#maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.#maxFiles = options.maxFiles ?? 5;
    this.#writeLine = options.writeLine ?? (async (path, line) => {
      await mkdir(this.#directory, { recursive: true });
      await appendFile(path, line, { encoding: "utf8" });
    });
  }

  async record(envelope: ChromeBridgeEnvelope): Promise<void> {
    const sanitized = sanitizeEnvelope(envelope);
    this.#ring.push(sanitized);
    while (this.#ring.length > this.#maxEntries) this.#ring.shift();
    if (!this.#enabled) return;
    try {
      const line = `${JSON.stringify(sanitized)}\n`;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (this.#fileBytes > 0 && this.#fileBytes + lineBytes > this.#maxFileBytes) {
        this.#fileIndex++;
        this.#fileBytes = 0;
      }
      await this.#writeLine(join(this.#directory, this.#filename()), line);
      this.#fileBytes += lineBytes;
      await this.#trimFiles();
    } catch {
      // Recon capture is best-effort and must never block live ingestion.
    }
  }

  recent(): readonly ChromeBridgeEnvelope[] {
    return [...this.#ring];
  }

  async files(): Promise<readonly string[]> {
    try {
      return (await readdir(this.#directory)).filter((name) => /^capture-\d+\.jsonl$/u.test(name)).sort();
    } catch {
      return [];
    }
  }

  #filename(): string {
    return `capture-${this.#captureEpoch + this.#fileIndex}.jsonl`;
  }

  async #trimFiles(): Promise<void> {
    const files = await this.files();
    for (const filename of files.slice(0, Math.max(0, files.length - this.#maxFiles))) {
      await unlink(join(this.#directory, filename));
    }
  }
}

function sanitizeEnvelope(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope {
  if (envelope.payload.encoding !== "UTF8") return ChromeBridgeEnvelopeSchema.parse(envelope);
  let body = envelope.payload.body;
  try {
    body = JSON.stringify(redactJson(JSON.parse(body) as unknown));
  } catch {
    body = body.replace(/([?&](?:token|session|operatorToken|loginname)=)[^&#\s]*/giu, "$1[REDACTED]");
  }
  return ChromeBridgeEnvelopeSchema.parse({ ...envelope, payload: { ...envelope.payload, body } });
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:authorization|cookie|loginname|operator.?token|password|secret|session|token|api.?key)/iu.test(key)) continue;
    result[key] = redactJson(nested);
  }
  return result;
}
