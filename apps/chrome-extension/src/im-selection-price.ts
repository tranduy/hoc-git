import type { SelectionPriceProbeIdentity } from "./selection-price.js";

// Resolve one current IM price without navigating the one-time provider page.
// A DOM result is accepted only when the exact provider IDs are exposed;
// otherwise a newly signed GetSE request is made inside the authenticated tab.
export function buildImExactSelectionPriceExpression(identity: SelectionPriceProbeIdentity): string {
  const input = JSON.stringify(identity);
  return `(async () => {
    const input = ${input};
    const visible = (node) => {
      if (!node || node.getClientRects().length === 0) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const exactNodes = [...document.querySelectorAll('[data-selection-id], [id]')].filter((node) =>
      visible(node) && String(node.getAttribute('data-event-id') ?? '') === input.providerEventId &&
      String(node.getAttribute('data-market-id') ?? '') === input.providerMarketId &&
      String(node.getAttribute('data-selection-id') ?? node.id) === input.providerSelectionId);
    const domPrices = exactNodes.map((node) => String(node.getAttribute('data-odds') ?? node.textContent ?? '')
      .replace(/\\s+/gu, ' ').trim()).filter((value) => /^[+-]?\\d+(?:\\.\\d+)?$/u.test(value));
    if (exactNodes.length > 1 || domPrices.length > 1) return { ok: false, reason: 'IM_DIRECT_SELECTION_AMBIGUOUS' };
    if (exactNodes.length === 1 && domPrices.length === 1) return { ok: true, rawOdds: domPrices[0],
      observedAtMs: Date.now(), method: 'DOM' };

    const token = sessionStorage.getItem('to' + 'ken') || new URLSearchParams(location.search).get('to' + 'ken');
    if (!token) return { ok: false, reason: 'IM_DIRECT_TOKEN_UNAVAILABLE' };
    const sign = (path) => new Promise((resolve, reject) => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz$ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
      const callback = Array.from({ length: 7 }, () => alphabet[Math.floor(Math.random() * 64)]).join('');
      const eventName = 'halo_' + callback;
      const timer = setTimeout(() => { window.removeEventListener(eventName, receive);
        reject(new Error('signature-timeout')); }, 3000);
      const receive = (event) => { clearTimeout(timer); window.removeEventListener(eventName, receive);
        resolve(event.detail); };
      window.addEventListener(eventName, receive);
      window.dispatchEvent(new CustomEvent('helo', { detail: { p: { c: path, a: 127 }, c: callback } }));
    });
    const now = Date.now();
    const providerDate = (value) => new Date(value).toISOString().slice(0, 10).replace(/-/g, '/');
    const common = { SportId: 1, BetTypeIds: [1, 2, 3, 5], GamePeriods: [1, 2, 3], IsCombo: false,
      ['O' + 'ddsType']: 2, DateFrom: providerDate(now), DateTo: providerDate(now + 48 * 60 * 60 * 1000),
      CompetitionIds: [], SortType: 2, ProgrammeIds: [] };
    const path = '/api/EventV6/GetSE';
    const payloads = [];
    try {
      for (const Market of [1, 2]) {
        const signature = String(await sign(path));
        const response = await fetch(path, { method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
            'x-sc': encodeURI(signature), 'x-v': '91460', 'x-platform': String(window.global?.PlatForm || ''),
            ['x-' + 'token']: token }, body: JSON.stringify({ ...common, Market }) });
        if (!response.ok) return { ok: false, reason: 'IM_DIRECT_HTTP_' + String(response.status) };
        payloads.push(await response.json());
      }
    } catch { return { ok: false, reason: 'IM_DIRECT_REQUEST_FAILED' }; }
    const expected = { FT_AH: [1, 1, 'HOME', 'AWAY'], FT_TOTAL: [2, 1, 'OVER', 'UNDER'],
      FH_AH: [1, 2, 'HOME', 'AWAY'], FH_TOTAL: [2, 2, 'OVER', 'UNDER'],
      SH_AH: [1, 3, 'HOME', 'AWAY'], SH_TOTAL: [2, 3, 'OVER', 'UNDER'] }[input.marketType];
    if (!expected || (input.scope === 'FULL_TIME' ? expected[1] !== 1 :
      input.scope === 'FIRST_HALF' ? expected[1] !== 2 : input.scope === 'SECOND_HALF' ? expected[1] !== 3 : true)) {
      return { ok: false, reason: 'IM_DIRECT_SELECTION_NOT_FOUND' };
    }
    const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/[\\u0300-\\u036f]/gu, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim();
    const candidates = [];
    for (const payload of payloads) for (const event of Array.isArray(payload?.sel) ? payload.sel : []) {
      if (String(event?.eid ?? '') !== input.providerEventId || normalize(event?.htn) !== normalize(input.participantA) ||
        normalize(event?.atn) !== normalize(input.participantB)) continue;
      for (const market of Array.isArray(event?.mls) ? event.mls : []) {
        if (String(market?.mi ?? '') !== input.providerMarketId || Number(market?.bti) !== expected[0] ||
          Number(market?.gp) !== expected[1]) continue;
        for (const selection of Array.isArray(market?.ws) ? market.ws : []) {
          const outcome = Number(selection?.si) === 1 ? 'HOME' : Number(selection?.si) === 2 ? 'AWAY' :
            Number(selection?.si) === 3 ? 'OVER' : Number(selection?.si) === 4 ? 'UNDER' : '';
          const line = Math.abs(Number(selection?.hdp));
          if (String(selection?.wsi ?? '') === input.providerSelectionId && outcome === input.selection &&
            Number.isFinite(line) && input.line !== null && Math.abs(line - Math.abs(Number(input.line))) < 1e-9 &&
            typeof selection?.o === 'number' && Number.isFinite(selection.o) && selection.o !== 0) {
            candidates.push(String(selection.o));
          }
        }
      }
    }
    const unique = [...new Set(candidates)];
    if (unique.length === 0) return { ok: false, reason: 'IM_DIRECT_SELECTION_NOT_FOUND' };
    if (unique.length !== 1) return { ok: false, reason: 'IM_DIRECT_SELECTION_AMBIGUOUS' };
    return { ok: true, rawOdds: unique[0], observedAtMs: Date.now(), method: 'IN_PAGE_FETCH' };
  })()`;
}
