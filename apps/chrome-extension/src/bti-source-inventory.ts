// Inspect existing page-owned data only; never fetch, read storage or invoke workers.
export const BTI_SOURCE_INVENTORY_EXPRESSION = String.raw`(() => {
  const root = document.documentElement;
  const out = { nativeRosterEvents: 0, nativePrematchEvents: 0, nativeLiveEvents: 0,
    nativeDetailEvents: 0, nativeMarketRows: 0, nativeSelectionRows: 0,
    nativeNumericIds: 0, nativeMalformedRows: 0, nativeInventoryTruncated: false,
    nativeTypeCountsTruncated: false, nativeTypeCounts: '' };
  const roster = new Set(), prematch = new Set(), live = new Set(), details = new Set(), types = new Map();
  let bytes = 0, rows = 0;
  const started = Date.now();
  const bounded = () => {
    if (++rows > 100000 || Date.now() - started > 50) out.nativeInventoryTruncated = true;
    return !out.nativeInventoryTruncated;
  };
  const id = (value) => {
    if (typeof value === 'number') out.nativeNumericIds += 1;
    return typeof value === 'string' || Number.isSafeInteger(value) ? String(value) : '';
  };
  const parse = (item) => {
    if (!item || typeof item.body !== 'string') return null;
    bytes += item.body.length;
    if (item.body.length > 2 * 1024 * 1024 || bytes > 28 * 1024 * 1024) {
      out.nativeInventoryTruncated = true; return null;
    }
    try { return JSON.parse(item.body); }
    catch { out.nativeMalformedRows += 1; return null; }
  };
  const responses = root.__fieldlineBtiRosterWorkerV10?.result?.responses;
  for (const item of Array.isArray(responses) ? responses : []) {
    if (!bounded()) break;
    if (typeof item?.url !== 'string' || !/\/api\/eventlist\/.*\/(?:live(?:\/initial)?|prematch\/initial)$/u.test(item.url)) continue;
    const payload = parse(item);
    for (const league of Array.isArray(payload?.serializedData) ? payload.serializedData : []) {
      if (!bounded()) break;
      for (const event of Array.isArray(league?.[12]) ? league[12] : []) {
        if (!bounded()) break;
        if (!Array.isArray(event)) { out.nativeMalformedRows += 1; continue; }
        const eventId = id(event[0]);
        if (!eventId) { out.nativeMalformedRows += 1; continue; }
        roster.add(eventId);
        if (event[5] === true) live.add(eventId);
        else if (event[5] === false) prematch.add(eventId);
      }
    }
  }
  const cache = root.__fieldlineBtiDetailBodiesV10;
  for (const item of Array.isArray(cache) ? cache : []) {
    if (!bounded()) break;
    const payload = parse(item);
    if (!Array.isArray(payload?.data)) continue;
    if (typeof item.eventId === 'string') details.add(item.eventId);
    for (const event of payload.data) {
      if (!bounded()) break;
      if (!Array.isArray(event)) { out.nativeMalformedRows += 1; continue; }
      const eventId = id(event[0]);
      if (eventId) details.add(eventId);
      for (const index of [20, 33]) for (const market of Array.isArray(event[index]) ? event[index] : []) {
        if (!bounded()) break;
        if (!Array.isArray(market)) { out.nativeMalformedRows += 1; continue; }
        out.nativeMarketRows += 1;
        if (!id(market[0])) out.nativeMalformedRows += 1;
        const raw = Array.isArray(market[5]) ? market[5][0] : null;
        const code = typeof raw === 'string' && /^[A-Z][A-Z0-9_]{0,23}$/u.test(raw) ? raw : 'UNKNOWN';
        if (!types.has(code) && types.size >= 32) out.nativeTypeCountsTruncated = true;
        else types.set(code, (types.get(code) || 0) + 1);
        for (const selection of Array.isArray(market[13]) ? market[13] : []) {
          if (!bounded()) break;
          out.nativeSelectionRows += 1;
          if (!Array.isArray(selection) || !id(selection[0])) out.nativeMalformedRows += 1;
        }
      }
    }
  }
  out.nativeRosterEvents = roster.size;
  out.nativePrematchEvents = [...prematch].filter((eventId) => !live.has(eventId)).length;
  out.nativeLiveEvents = live.size;
  out.nativeDetailEvents = details.size;
  out.nativeTypeCounts = [...types].sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => code + ':' + count).join(',');
  return out;
})()`;
