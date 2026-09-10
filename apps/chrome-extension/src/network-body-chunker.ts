import { MAX_CHROME_NETWORK_BODY_CHUNKS } from "@tool-chenh/contracts";

const MAX_RAW_BYTES = 110_000;
// Leave more than 21 KiB of the 256 KiB envelope limit for wrapper/request
// metadata. Unexpected metadata overflow still retires the emission lane.
const MAX_ESCAPED_BYTES = 240_000;

/** A fragment is JSON-escaped twice: in its chunk wrapper and then in the
 * envelope's string body. Count that wire contribution before slicing; raw
 * UTF-8 sizing alone silently loses quote-heavy chunks at the redactor. */
export function splitNetworkBodyText(value: string): string[] {
  const output: string[] = [];
  let start = 0, rawBytes = 0, escapedBytes = 0;
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);
    let width = 1, raw = 1, escaped = 1;
    if (code === 0x22 || code === 0x5c) escaped = 4;
    else if (code < 0x20) escaped = [8, 9, 10, 12, 13].includes(code) ? 3 : 7;
    else if (code >= 0x80) {
      if (code < 0x800) raw = escaped = 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        raw = escaped = 4; width = 2;
      } else {
        raw = 3;
        escaped = code >= 0xd800 && code <= 0xdfff ? 7 : 3;
      }
    }
    if (rawBytes + raw > MAX_RAW_BYTES || escapedBytes + escaped > MAX_ESCAPED_BYTES) {
      output.push(value.slice(start, index));
      start = index; rawBytes = 0; escapedBytes = 0;
    }
    rawBytes += raw; escapedBytes += escaped; index += width;
  }
  if (start < value.length || output.length === 0) output.push(value.slice(start));
  // Validate the whole body before a producer can send an unusable prefix.
  if (output.length > MAX_CHROME_NETWORK_BODY_CHUNKS) throw new Error("BRIDGE_PAYLOAD_TOO_LARGE");
  return output;
}
