import { readFile } from "node:fs/promises";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";

export async function replayCapture(path: string): Promise<readonly ChromeBridgeEnvelope[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => ChromeBridgeEnvelopeSchema.parse(JSON.parse(line)))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.sequence - right.sequence);
}
