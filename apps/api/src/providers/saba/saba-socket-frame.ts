import type { SabaPushFrame } from "./saba-push-decoder.js";

const socketIoEventPrefix = "42";
const maximumFrameCharacters = 2 * 1024 * 1024;

function invalidFrame(): never {
  throw new Error("SABA_PUSH_FRAME_INVALID");
}

/**
 * Parses only SABA's Socket.IO `m` event. Ping/pong, connect, binary and all
 * unrelated application events are deliberately ignored by returning null.
 */
export function parseSabaSocketFrame(value: unknown): SabaPushFrame | null {
  if (typeof value !== "string") return null;
  if (value.length > maximumFrameCharacters) invalidFrame();
  if (!value.startsWith(socketIoEventPrefix)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(value.slice(socketIoEventPrefix.length));
  } catch {
    invalidFrame();
  }
  if (!Array.isArray(payload) || payload[0] !== "m") return null;
  if (payload.length < 3 || payload.length > 4) invalidFrame();

  const bridgeId = payload[1];
  const rows = payload[2];
  const rawRevision = payload[3];
  if (typeof bridgeId !== "string" || !/^b\d+$/u.test(bridgeId) || !Array.isArray(rows)) invalidFrame();
  if (rawRevision !== undefined && rawRevision !== null &&
    typeof rawRevision !== "string" && typeof rawRevision !== "number") invalidFrame();
  if (typeof rawRevision === "number" && !Number.isSafeInteger(rawRevision)) invalidFrame();

  return {
    bridgeId,
    rows,
    revision: rawRevision === undefined || rawRevision === null ? null : String(rawRevision)
  };
}

