import type { SelectionPriceProbeIdentity } from "./selection-price.js";

// Read an APSPORT price only when the provider's exact event and selection IDs
// resolve to one current market. The fallback performs a fresh same-origin
// request already used by the page; it never reads the bridge/catalog cache.
export function buildTsportSelectionPriceExpression(identity: SelectionPriceProbeIdentity,
  observedRequestUrls: readonly string[] = []): string {
  const input = JSON.stringify(identity);
  const capturedUrls = JSON.stringify(observedRequestUrls.slice(-16));
  return `(async () => {
    const input = ${input};
    const capturedUrls = ${capturedUrls};
    const visible = (node) => {
      if (!node || node.getClientRects().length === 0) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const clean = (value) => String(value ?? '').replace(/\\s+/gu, ' ').trim();
    const normalize = (value) => clean(value).normalize('NFD').replace(/[\\u0300-\\u036f]/gu, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim();
    const exactEventId = (match) => {
      const favorite = clean(match.querySelector('.match-favorite')?.id);
      return favorite.match(/eventId-[^-]+-\\d+-([0-9]+)$/u)?.[1] ||
        clean(match.getAttribute('data-event-id') || match.getAttribute('data-eventid')) ||
        clean(match.id).match(/([0-9]{4,})$/u)?.[1] || '';
    };
    const marketIdentity = (group) => {
      const label = normalize(group.querySelector('.match__odd-pair-list__type')?.textContent);
      const handicap = /(?:^| )(?:asian handicap|handicap|ah|chap|cuoc chap)(?: |$)/u.test(label);
      const total = /(?:^| )(?:total|over under|tai xiu|t x)(?: |$)/u.test(label);
      const first = /(?:^| )(?:first half|1st half|1h|fh|hiep 1)(?: |$)/u.test(label);
      const second = /(?:^| )(?:second half|2nd half|2h|sh|hiep 2)(?: |$)/u.test(label);
      const corner = /(?:^| )(?:corner|phat goc)(?: |$)/u.test(label);
      const card = /(?:^| )(?:card|booking|the phat)(?: |$)/u.test(label);
      if (handicap === total || (first && second) || (corner && card)) return null;
      const kind = handicap ? 'AH' : 'TOTAL';
      const marketType = corner ? 'CORNER_' + (first ? 'FH' : 'FT') + '_' + kind :
        card ? 'CARD_' + (first ? 'FH' : 'FT') + '_' + kind :
        (first ? 'FH' : second ? 'SH' : 'FT') + '_' + kind;
      const scope = first ? 'FIRST_HALF' : second ? 'SECOND_HALF' : 'FULL_TIME';
      return { marketType, scope, handicap };
    };
    const expectedSelectionLine = () => {
      if (input.line === null) return null;
      const value = Number(input.line);
      if (!Number.isFinite(value)) return null;
      const selected = input.marketType.endsWith('_AH') && input.selection === 'AWAY' ? -value : value;
      return Object.is(selected, -0) ? 0 : selected;
    };
    const parseLine = (value) => {
      const raw = clean(value).replace(/^[ou]\\s*/iu, '').replace(/\\s+/gu, '');
      const split = /^([+-]?\\d+(?:\\.\\d+)?)\\/([+-]?\\d+(?:\\.\\d+)?)$/u.exec(raw);
      if (split) return (Number(split[1]) + Number(split[2])) / 2;
      const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : null;
    };
    const allNodes = [...document.querySelectorAll('#odd-item-' + CSS.escape(input.providerSelectionId))];
    const nodes = allNodes.filter(visible);
    let eventMatches = 0;
    let participantMatches = 0;
    let marketMatches = 0;
    let outcomeMatches = 0;
    let lineMatches = 0;
    const exact = [];
    for (const node of nodes) {
      const match = node.closest('.match');
      const group = node.closest('.match-odd-pair-list');
      if (!match || !group || exactEventId(match) !== input.providerEventId) continue;
      eventMatches += 1;
      const teams = [...match.querySelectorAll('.match__team-name')].slice(0, 2).map((item) => normalize(item.textContent));
      if (teams.length !== 2 || teams[0] !== normalize(input.participantA) || teams[1] !== normalize(input.participantB)) continue;
      participantMatches += 1;
      const market = marketIdentity(group);
      if (!market || market.marketType !== input.marketType || market.scope !== input.scope) continue;
      marketMatches += 1;
      const odds = [...group.querySelectorAll('.match__odd-pair')];
      const index = odds.indexOf(node);
      const outcome = market.handicap ? (index === 0 ? 'HOME' : index === 1 ? 'AWAY' : '') :
        index === 0 ? 'OVER' : index === 1 ? 'UNDER' : '';
      if (outcome !== input.selection) continue;
      outcomeMatches += 1;
      const actualLine = parseLine(node.querySelector('.match__odd-type')?.textContent);
      const expectedLine = expectedSelectionLine();
      if (actualLine === null || expectedLine === null || Math.abs(actualLine - expectedLine) > 1e-9) continue;
      lineMatches += 1;
      const prices = [...node.querySelectorAll('.match__odd-value')].filter(visible)
        .map((item) => clean(item.textContent)).filter((value) => /^[+-]?\\d+(?:\\.\\d+)?$/u.test(value));
      if (prices.length !== 1) continue;
      exact.push({ rawOdds: prices[0] });
    }
    if (exact.length === 1) return { ok: true, rawOdds: exact[0].rawOdds,
      observedAtMs: Date.now(), method: 'DOM' };
    if (exact.length > 1) return { ok: false, reason: 'TSPORT_SELECTION_AMBIGUOUS' };
    const domFailure = allNodes.length === 0 ? 'TSPORT_SELECTION_NOT_RENDERED' : nodes.length === 0
      ? 'TSPORT_SELECTION_HIDDEN' : eventMatches === 0 ? 'TSPORT_EVENT_NOT_FOUND'
        : participantMatches === 0 ? 'TSPORT_PARTICIPANTS_NOT_FOUND'
          : marketMatches === 0 ? 'TSPORT_MARKET_NOT_FOUND'
            : outcomeMatches === 0 ? 'TSPORT_OUTCOME_NOT_FOUND'
              : lineMatches === 0 ? 'TSPORT_LINE_NOT_FOUND' : 'TSPORT_PRICE_NOT_FOUND';

    const urls = [...capturedUrls, ...performance.getEntriesByType('resource')
      .map((entry) => String(entry.name ?? ''))]
      .filter((value) => {
        try { const url = new URL(value, location.href); return url.origin === location.origin &&
          /^(?:https?):$/u.test(url.protocol) && (url.pathname + url.search).includes(input.providerEventId); }
        catch { return false; }
      }).slice(-16).reverse();
    const matches = [];
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      const eventId = String(value.eventId ?? value.providerEventId ?? '');
      const marketId = String(value.marketId ?? value.providerMarketId ?? '');
      const line = value.line === null || value.line === undefined ? null : String(value.line);
      if (eventId === input.providerEventId && marketId === input.providerMarketId &&
        String(value.marketType ?? '') === input.marketType && String(value.scope ?? '') === input.scope &&
        line === input.line && Array.isArray(value.selections)) {
        for (const selection of value.selections) {
          if (!selection || typeof selection !== 'object') continue;
          const id = String(selection.selectionId ?? selection.providerSelectionId ?? selection.id ?? '');
          const rawOdds = selection.priceText ?? selection.rawOdds ?? selection.odds ?? selection.price;
          if (id === input.providerSelectionId && String(selection.selection ?? selection.outcome ?? '') === input.selection &&
            (typeof rawOdds === 'string' || typeof rawOdds === 'number') &&
            /^[+-]?\\d+(?:\\.\\d+)?$/u.test(String(rawOdds))) matches.push(String(rawOdds));
        }
      }
      for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
    };
    await Promise.all(urls.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1_500);
      try {
        const response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store',
          signal: controller.signal, headers: { Accept: 'application/json' } });
        if (response.ok) visit(await response.json());
      } catch { /* A failed provider request remains fail-closed. */ }
      finally { clearTimeout(timeout); }
    }));
    const unique = [...new Set(matches)];
    if (unique.length === 1) return { ok: true, rawOdds: unique[0], observedAtMs: Date.now(), method: 'IN_PAGE_FETCH' };
    if (unique.length > 1) return { ok: false, reason: 'TSPORT_SELECTION_AMBIGUOUS' };
    return { ok: false, reason: urls.length === 0 ? domFailure : 'TSPORT_SELECTION_NOT_FOUND' };
  })()`;
}
