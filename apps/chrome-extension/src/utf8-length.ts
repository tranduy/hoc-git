/**
 * Byte length of a string's UTF-8 encoding without allocating an encoded
 * copy. Used on every envelope and queue entry, so it must not allocate.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index += 1; } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Splits text into fragments whose UTF-8 encoding is at most `maxBytes`,
 * never cutting inside a surrogate pair. Linear in the input length.
 */
export function splitUtf8Text(value: string, maxBytes: number): string[] {
  if (maxBytes <= 0) throw new Error("BRIDGE_PAYLOAD_INVALID");
  const output: string[] = [];
  let start = 0;
  let bytes = 0;
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    let width = 1;
    let size = 1;
    if (code >= 0x80) {
      if (code < 0x800) size = 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { size = 4; width = 2; }
      else size = 3;
    }
    if (size > maxBytes) throw new Error("BRIDGE_PAYLOAD_INVALID");
    if (bytes + size > maxBytes) {
      output.push(value.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += width;
  }
  if (start < value.length || output.length === 0) output.push(value.slice(start));
  return output;
}
