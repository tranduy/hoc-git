const ARRAY_BATCH_SIZE = 128;
const OUTPUT_BLOCK_CHARS = 1024 * 1024;

/** Emits valid JSON without ever materialising the complete catalog as a string. */
export function* streamCatalogJson(value: Readonly<Record<string, unknown>>): Generator<string> {
  // Compressors complete writes asynchronously. Passing every comma and 128-row
  // fragment separately can take thousands of I/O turns while six books ingest.
  // Coalesce those fragments, retaining at most one block plus one row batch.
  let parts: string[] = [];
  let characters = 0;
  for (const part of catalogJsonParts(value)) {
    parts.push(part);
    characters += part.length;
    if (characters < OUTPUT_BLOCK_CHARS) continue;
    yield parts.join("");
    parts = [];
    characters = 0;
  }
  if (parts.length > 0) yield parts.join("");
}

function* catalogJsonParts(value: Readonly<Record<string, unknown>>): Generator<string> {
  yield "{";
  let firstProperty = true;
  for (const [key, property] of Object.entries(value)) {
    if (property === undefined) continue;
    if (!firstProperty) yield ",";
    firstProperty = false;
    yield `${JSON.stringify(key)}:`;
    if (!Array.isArray(property)) {
      yield JSON.stringify(property);
      continue;
    }
    yield "[";
    for (let index = 0; index < property.length; index += ARRAY_BATCH_SIZE) {
      if (index > 0) yield ",";
      yield JSON.stringify(property.slice(index, index + ARRAY_BATCH_SIZE)).slice(1, -1);
    }
    yield "]";
  }
  yield "}";
}
