const ARRAY_BATCH_SIZE = 128;

/** Emits valid JSON without ever materialising the complete catalog as a string. */
export function* streamCatalogJson(value: Readonly<Record<string, unknown>>): Generator<string> {
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
