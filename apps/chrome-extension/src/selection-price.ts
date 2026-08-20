import type { SelectionFocusIdentity } from "./selection-focus.js";

export interface SelectionPriceProbeIdentity extends SelectionFocusIdentity {
  readonly eventLabel: string;
  readonly participantA: string;
  readonly participantB: string;
  readonly marketType: string;
  readonly scope: string;
  readonly selection: string;
  readonly line: string | null;
}

function selectionIndex(identity: SelectionFocusIdentity): number {
  if (identity.providerSelectionId === `${identity.providerMarketId}:home` ||
    identity.providerSelectionId === `${identity.providerMarketId}:over`) return 0;
  if (identity.providerSelectionId === `${identity.providerMarketId}:away` ||
    identity.providerSelectionId === `${identity.providerMarketId}:under`) return 1;
  throw new Error("SELECTION_IDENTITY_MISMATCH");
}

export function buildCmdSelectionPriceExpression(identity: SelectionFocusIdentity): string {
  const input = JSON.stringify({ ...identity, selectionIndex: selectionIndex(identity) });
  return `(() => {
    const input = ${input};
    let target = null;
    const visibleMarketId = input.providerMarketId.includes('__')
      ? input.providerMarketId.slice(input.providerMarketId.lastIndexOf('__') + 2)
      : input.providerMarketId;
    const modernRows = [...document.querySelectorAll('.c-match[data-matchid]')]
      .filter((row) => row.getAttribute('data-matchid') === input.providerEventId);
    if (modernRows.length === 1) {
      const allOdds = [...modernRows[0].querySelectorAll('.c-odds[data-moid]')];
      const exactOdds = allOdds.filter((node) => node.getAttribute('data-moid') === input.providerMarketId);
      const odds = exactOdds.length > 0 ? exactOdds :
        allOdds.filter((node) => node.getAttribute('data-moid') === visibleMarketId);
      if (odds.length === 2) target = odds[input.selectionIndex] ?? null;
    }
    if (!target && input.providerMarketId.startsWith('legacy:')) {
      const identity = /^legacy:([^:]+):([1378]):(.+)$/u.exec(input.providerMarketId);
      if (identity) {
        const [, rowId, betType, expectedLine] = identity;
        const rows = [...document.querySelectorAll('.match')];
        const rowMatches = rows.filter((row) => row.id === 'R_' + rowId);
        const rowIndex = rowMatches.length === 1 ? rows.indexOf(rowMatches[0]) : -1;
        let baseRow = null;
        for (let index = rowIndex; index >= 0; index -= 1) {
          if (rows[index].classList.contains('default-match')) { baseRow = rows[index]; break; }
        }
        if (rowIndex >= 0 && baseRow?.id === 'R_' + input.providerEventId) {
          let firstHalfStarted = false;
          const candidates = [];
          for (const container of rowMatches[0].querySelectorAll('.Dbox_b2, .Dbox_b3, .Dbox_b5')) {
            const odds = [...container.querySelectorAll('.odds')].slice(0, 2);
            if (odds.length !== 2) continue;
            let containerBetType = null;
            if (container.classList.contains('Dbox_b5')) { firstHalfStarted = true; containerBetType = '7'; }
            else if (container.classList.contains('Dbox_b2')) containerBetType = '1';
            else containerBetType = firstHalfStarted ? '8' : '3';
            const clone = container.cloneNode(true);
            clone.querySelectorAll('.odds').forEach((price) => price.remove());
            const evidence = String(clone.textContent ?? '').replace(/\\b(?:o|u|ou)\\b/giu, ' ');
            const line = evidence.match(/[+-]?\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+(?:\\.\\d+)?)?/u)?.[0]
              ?.replace(/\\s+/gu, '') ?? '';
            if (containerBetType === betType && line === expectedLine) candidates.push(odds);
          }
          if (candidates.length === 1) target = candidates[0][input.selectionIndex] ?? null;
        }
      }
    }
    if (!target || target.getClientRects().length === 0) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    const rawOdds = String(target.textContent ?? '').replace(/\\s+/gu, ' ').trim();
    if (!/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds)) return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return { ok: true, rawOdds, observedAtMs: Date.now() };
  })()`;
}

export function buildSabaSelectionPriceExpression(identity: SelectionPriceProbeIdentity): string {
  const input = JSON.stringify(identity);
  return `(() => {
    const input = ${input};
    const suffix = input.selection === 'HOME' ? 'home' : input.selection === 'AWAY' ? 'away'
      : input.selection === 'OVER' ? 'over' : input.selection === 'UNDER' ? 'under' : null;
    if (suffix === null || input.providerSelectionId !== input.providerMarketId + ':' + suffix) {
      return { ok: false, reason: 'SELECTION_IDENTITY_MISMATCH' };
    }
    const selectionIndex = suffix === 'home' || suffix === 'over' ? 0 : 1;
    const rows = [...document.querySelectorAll('.c-match[data-matchid]')]
      .filter((row) => row.getAttribute('data-matchid') === input.providerEventId);
    if (rows.length === 0) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    if (rows.length !== 1) return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
    const visibleMarketId = input.providerMarketId.includes('__')
      ? input.providerMarketId.slice(input.providerMarketId.lastIndexOf('__') + 2)
      : input.providerMarketId;
    const allOdds = [...rows[0].querySelectorAll('.c-odds[data-moid]')];
    const exact = allOdds.filter((node) => node.getAttribute('data-moid') === input.providerMarketId);
    const candidates = exact.length > 0 ? exact
      : allOdds.filter((node) => node.getAttribute('data-moid') === visibleMarketId);
    if (candidates.length === 0) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    if (candidates.length !== 2) return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
    const target = candidates[selectionIndex];
    if (!target || target.getClientRects().length === 0) {
      return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    }
    const rawOdds = String(target.textContent ?? '').replace(/\\s+/gu, ' ').trim();
    if (!/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds)) {
      return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
    }
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return { ok: true, rawOdds, observedAtMs: Date.now() };
  })()`;
}

export function buildSbobetSelectionPriceExpression(identity: SelectionPriceProbeIdentity,
  observedRequest: { readonly url: string; readonly headers: Readonly<Record<string, string>> } | null = null,
  probeMode: "DOM_ONLY" | "FETCH_ONLY" | "DOM_OR_FETCH" = "DOM_OR_FETCH"): string {
  const input = JSON.stringify(identity);
  const capturedRequest = JSON.stringify(probeMode === "DOM_ONLY" ? null : observedRequest);
  const mode = JSON.stringify(probeMode);
  return `(async () => {
    const input = ${input};
    const capturedRequest = ${capturedRequest};
    const probeMode = ${mode};
    const normalizeDom = (value) => String(value ?? '').normalize('NFKC').replace(/\\s+/gu, ' ').trim()
      .toLocaleLowerCase('en');
    const domLineMagnitude = (value) => {
      const match = String(value ?? '').match(/\\d+(?:\\.\\d+)?(?:\\s*[\\/-]\\s*\\d+(?:\\.\\d+)?)?/u)?.[0];
      if (!match) return null;
      const parts = match.replace(/\\s+/gu, '').replace('-', '/').split('/').map(Number);
      return parts.length >= 1 && parts.length <= 2 && parts.every(Number.isFinite)
        ? parts.reduce((sum, part) => sum + part, 0) / parts.length : null;
    };
    const exactDomId = 'odd-item-' + input.providerSelectionId;
    const exactSelector = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? '#' + CSS.escape(exactDomId) : '[id^="odd-item-"]';
    const visibleExactNodes = probeMode === 'FETCH_ONLY' ? [] : [...document.querySelectorAll(exactSelector)]
      .filter((node) => node.id === exactDomId && node.getClientRects().length > 0);
    if (visibleExactNodes.length > 1) return { ok: false, reason: 'SBOBET_SELECTION_AMBIGUOUS' };
    if (visibleExactNodes.length === 1) {
      const target = visibleExactNodes[0];
      const event = target.closest('.wrapper-match-component');
      const eventId = event?.id.match(/^wrapper-match-component-(.+)$/u)?.[1] ?? '';
      const teams = event ? [...event.querySelectorAll('.row-team-name')].slice(0, 2)
        .map((node) => normalizeDom(node.textContent)) : [];
      const column = target.closest('.promotion-market, .un-promotion');
      const marketOwner = target.closest('[data-market-id], [data-marketid], [data-mid], [data-moid]');
      const domMarketId = marketOwner?.getAttribute('data-market-id') ??
        marketOwner?.getAttribute('data-marketid') ?? marketOwner?.getAttribute('data-mid') ??
        marketOwner?.getAttribute('data-moid') ?? '';
      const odds = column ? [...column.querySelectorAll('.odd-item')] : [];
      const targetIndex = odds.indexOf(target);
      const rateLabels = column ? [...column.querySelectorAll('.odd-row .rate-asian')]
        .map((node) => String(node.textContent ?? '').trim()) : [];
      const inferredType = odds.length >= 3 ? 'FT_1X2'
        : rateLabels.some((label) => /^[ou]$/iu.test(label)) ? 'FT_TOTAL' : 'FT_AH';
      const expectedIndex = input.selection === 'HOME' || input.selection === 'OVER' ? 0
        : input.selection === 'AWAY' || input.selection === 'UNDER' ? 1 : -1;
      const scopeOwner = target.closest('[data-scope], [class*="first-half"], [class*="1h"]');
      const explicitScope = normalizeDom(scopeOwner?.getAttribute('data-scope') ?? scopeOwner?.className ?? '');
      const scopeMatches = input.scope === 'FULL_TIME'
        ? !/(?:first.?half|\\b1h\\b)/u.test(explicitScope)
        : input.scope === 'FIRST_HALF' && /(?:first.?half|\\b1h\\b)/u.test(explicitScope);
      const requestedType = input.marketType === 'FT_TOTAL' || input.marketType === 'FH_TOTAL' ? 'FT_TOTAL'
        : input.marketType === 'FT_AH' || input.marketType === 'FH_AH' ? 'FT_AH' : input.marketType;
      const magnitude = rateLabels.map(domLineMagnitude).find((value) => value !== null) ?? null;
      let canonicalLine = magnitude;
      if (requestedType === 'FT_AH' && magnitude !== null) {
        const favoredIndex = rateLabels.findIndex((label) => domLineMagnitude(label) !== null);
        canonicalLine = favoredIndex === 0 ? -magnitude : favoredIndex === 1 ? magnitude : null;
      }
      const requestedLine = input.line === null ? null : Number(input.line);
      const rawOdds = String(target.querySelector('.odd-val')?.textContent ?? target.textContent ?? '')
        .replace(/\\s+/gu, ' ').trim();
      const identityMatches = eventId === input.providerEventId && domMarketId === input.providerMarketId &&
        teams.length === 2 &&
        teams[0] === normalizeDom(input.participantA) && teams[1] === normalizeDom(input.participantB) &&
        requestedType === inferredType && scopeMatches && targetIndex === expectedIndex &&
        requestedLine !== null && Number.isFinite(requestedLine) && canonicalLine !== null &&
        Math.abs(canonicalLine - requestedLine) <= 1e-9;
      if (!identityMatches || !/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds) || Number(rawOdds) === 0) {
        return { ok: false, reason: 'SBOBET_SELECTION_NOT_FOUND' };
      }
      return { ok: true, rawOdds, observedAtMs: Date.now(), method: 'DOM' };
    }
    if (probeMode === 'DOM_ONLY') return { ok: false, reason: 'SBOBET_SELECTION_NOT_FOUND' };
    const performanceUrl = [...performance.getEntriesByType('resource')]
      .map((entry) => String(entry.name ?? ''))
      .filter((value) => {
        try {
          const url = new URL(value, location.href);
          return url.protocol === 'https:' && url.pathname === '/api/v2/getEvent';
        } catch { return false; }
      }).at(-1);
    const requestUrl = capturedRequest?.url ?? performanceUrl ?? new URL('/api/v2/getEvent', location.href).href;
    try {
      const url = new URL(requestUrl, location.href);
      if (url.protocol !== 'https:' || url.pathname !== '/api/v2/getEvent') {
        return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_INVALID' };
      }
    } catch { return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_INVALID' }; }
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_500);
    try {
      response = await fetch(requestUrl, { method: 'GET', credentials: 'include', cache: 'no-store',
        signal: controller.signal, headers: { Accept: 'application/json', ...(capturedRequest?.headers ?? {}) } });
    } catch { return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_FAILED' }; }
    finally { clearTimeout(timeout); }
    if (!response.ok) return { ok: false, reason: 'SBOBET_DIRECT_HTTP_' + String(response.status) };
    let payload;
    try { payload = await response.json(); }
    catch { return { ok: false, reason: 'SBOBET_DIRECT_INVALID_JSON' }; }
    const groupSemantics = {
      '3': ['FT_TOTAL', 'FULL_TIME', 'TOTAL'], '4': ['FH_TOTAL', 'FIRST_HALF', 'TOTAL'],
      '5': ['FT_AH', 'FULL_TIME', 'HANDICAP'], '6': ['FH_AH', 'FIRST_HALF', 'HANDICAP'],
      '19': ['CORNER_FT_AH', 'FULL_TIME', 'HANDICAP'], '20': ['CORNER_FH_AH', 'FIRST_HALF', 'HANDICAP'],
      '21': ['CORNER_FT_TOTAL', 'FULL_TIME', 'TOTAL'], '22': ['CORNER_FH_TOTAL', 'FIRST_HALF', 'TOTAL'],
      '31': ['CARD_FT_TOTAL', 'FULL_TIME', 'TOTAL'], '32': ['CARD_FH_TOTAL', 'FIRST_HALF', 'TOTAL'],
      '33': ['CARD_FT_AH', 'FULL_TIME', 'HANDICAP'], '34': ['CARD_FH_AH', 'FIRST_HALF', 'HANDICAP'],
      '80': ['SH_TOTAL', 'SECOND_HALF', 'TOTAL'], '85': ['SH_AH', 'SECOND_HALF', 'HANDICAP']
    };
    const text = (value) => String(value ?? '').normalize('NFKC').replace(/\\s+/gu, ' ').trim()
      .toLocaleLowerCase('en');
    const lineMagnitude = (value) => {
      const raw = String(value ?? '').trim();
      const parts = raw.replace(/^(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)$/u, '$1/$2')
        .split('/').map(Number);
      return parts.length >= 1 && parts.length <= 2 && parts.every((part) => Number.isFinite(part))
        ? parts.reduce((sum, part) => sum + part, 0) / parts.length : null;
    };
    const candidates = [];
    const readEvent = (event) => {
      if (text(event['2']) !== text(input.participantA) || text(event['3']) !== text(input.participantB)) return;
      const groups = event['7'];
      if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return;
      for (const [groupKey, rows] of Object.entries(groups)) {
        const semantics = groupSemantics[groupKey];
        if (!semantics || semantics[0] !== input.marketType || semantics[1] !== input.scope ||
          !Array.isArray(rows)) continue;
        for (const row of rows) {
          if (typeof row !== 'string') continue;
          const tokens = row.trim().split(/\\s+/u);
          const magnitude = lineMagnitude(tokens[0]);
          if (magnitude === null) continue;
          const handicap = semantics[2] === 'HANDICAP';
          const marketId = handicap ? tokens[4] : tokens[3];
          const favored = handicap ? tokens[3] : null;
          const canonicalLine = handicap ? favored === 'h' ? -magnitude : favored === 'a' ? magnitude : null
            : magnitude;
          if (marketId !== input.providerMarketId || canonicalLine === null || input.line === null ||
            Math.abs(canonicalLine - Number(input.line)) > 1e-9) continue;
          const expectedSuffix = input.selection === 'HOME' || input.selection === 'OVER' ? 'h'
            : input.selection === 'AWAY' || input.selection === 'UNDER' ? 'a' : null;
          if (expectedSuffix === null || !input.providerSelectionId.endsWith(expectedSuffix)) continue;
          for (const token of tokens.slice(1, 3)) {
            const separator = token.lastIndexOf('*');
            if (separator <= 0 || token.slice(separator + 1) !== input.providerSelectionId) continue;
            const rawOdds = token.slice(0, separator);
            if (/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds) && Number(rawOdds) !== 0) candidates.push(rawOdds);
          }
        }
      }
    };
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 20) return;
      if (!Array.isArray(value) && String(value['8'] ?? '') === input.providerEventId) readEvent(value);
      for (const child of Object.values(value)) visit(child, depth + 1);
    };
    visit(payload);
    if (candidates.length === 0) return { ok: false, reason: 'SBOBET_SELECTION_NOT_FOUND' };
    if (candidates.length !== 1) return { ok: false, reason: 'SBOBET_SELECTION_AMBIGUOUS' };
    return { ok: true, rawOdds: candidates[0], observedAtMs: Date.now(), method: 'IN_PAGE_FETCH' };
  })()`;
}

export function buildSbobetCatalogRefreshExpression(
  observedRequest: { readonly url: string; readonly headers: Readonly<Record<string, string>> } | null
): string {
  const capturedRequest = JSON.stringify(observedRequest);
  return `(async () => {
    const capturedRequest = ${capturedRequest};
    const performanceUrl = [...performance.getEntriesByType('resource')]
      .map((entry) => String(entry.name ?? ''))
      .filter((value) => {
        try {
          const url = new URL(value, location.href);
          return url.protocol === 'https:' && url.pathname === '/api/v2/getEvent';
        } catch { return false; }
      }).at(-1);
    const requestUrl = capturedRequest?.url ?? performanceUrl ?? new URL('/api/v2/getEvent', location.href).href;
    try {
      const url = new URL(requestUrl, location.href);
      if (url.protocol !== 'https:' || url.pathname !== '/api/v2/getEvent') {
        return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_INVALID' };
      }
    } catch { return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_INVALID' }; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_500);
    try {
      const response = await fetch(requestUrl, { method: 'GET', credentials: 'include', cache: 'no-store',
        signal: controller.signal, headers: { Accept: 'application/json', ...(capturedRequest?.headers ?? {}) } });
      return { ok: response.ok, status: response.status, observedAtMs: Date.now() };
    } catch { return { ok: false, reason: 'SBOBET_DIRECT_REQUEST_FAILED' }; }
    finally { clearTimeout(timeout); }
  })()`;
}

export function buildBtiSelectionPriceExpression(identity: SelectionPriceProbeIdentity): string {
  const input = JSON.stringify(identity);
  return `(async () => {
    const input = ${input};
    const headers = { Accept: 'application/json' };
    const authorization = localStorage.getItem('CT_APP_AUTHORIZATION');
    const serviceContext = localStorage.getItem('CT_APP_SERVICE_CONTEXT');
    if (authorization) headers.authorization = authorization;
    if (serviceContext) headers['service-context'] = serviceContext;
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      response = await fetch('/api/eventpage/events/' + encodeURIComponent(input.providerEventId) +
        '?hideX25X75Selections=false', { method: 'GET', credentials: 'include', cache: 'no-store',
          headers, signal: controller.signal });
    } catch {
      return { ok: false, reason: 'BTI_DETAIL_REQUEST_FAILED' };
    } finally { clearTimeout(timeout); }
    if (!response.ok) return { ok: false, reason: 'BTI_DETAIL_HTTP_' + String(response.status) };
    let payload;
    try { payload = await response.json(); }
    catch { return { ok: false, reason: 'BTI_DETAIL_INVALID_JSON' }; }
    const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\\s+/gu, ' ');
    const localized = (value) => value && typeof value === 'object' && !Array.isArray(value)
      ? String(value.VI ?? value.EN ?? '').trim() : '';
    const participantNames = (event) => (Array.isArray(event?.[8]) ? event[8] : []).slice(0, 2)
      .map((participant) => Array.isArray(participant)
        ? localized(participant[1]) || String(participant[2] ?? '').trim() : '');
    const events = Array.isArray(payload?.data) ? payload.data : [];
    const eventMatches = events.filter((event) => {
      if (!Array.isArray(event) || String(event[0] ?? '') !== input.providerEventId) return false;
      const names = participantNames(event);
      return names.length === 2 && normalize(names[0]) === normalize(input.participantA) &&
        normalize(names[1]) === normalize(input.participantB);
    });
    if (eventMatches.length !== 1) return { ok: false, reason: eventMatches.length === 0 ?
      'BTI_EVENT_NOT_FOUND' : 'BTI_EVENT_AMBIGUOUS' };
    const separator = input.providerMarketId.lastIndexOf(':');
    const marketId = separator > 0 ? input.providerMarketId.slice(0, separator) : input.providerMarketId;
    const requestedLine = Number(input.line);
    const classifyMarket = (market) => {
      const metadata = Array.isArray(market?.[5]) ? market[5] : [];
      const code = String(metadata[0] ?? metadata[1] ?? market?.[1] ?? '').trim().toUpperCase();
      const label = normalize(String(market?.[1] ?? '') + ' ' + String(metadata[1] ?? ''));
      const handicap = /^HC(?:39|0|1)$/u.test(code) || /\\b(?:asian handicap|handicap|ah)\\b/u.test(label);
      const total = /^OU(?:39|0|1|201|249)$/u.test(code) || /\\b(?:total|over under|ou)\\b/u.test(label);
      if (handicap === total) return null;
      const firstHalf = code === 'HC1' || code === 'OU1' || code === 'OU201' ||
        /\\b(?:first half|1st half|1h)\\b/u.test(label);
      const type = (firstHalf ? 'FH_' : 'FT_') + (handicap ? 'AH' : 'TOTAL');
      return { type, scope: firstHalf ? 'FIRST_HALF' : 'FULL_TIME', handicap };
    };
    const rawMarkets = [...(Array.isArray(eventMatches[0][20]) ? eventMatches[0][20] : []),
      ...(Array.isArray(eventMatches[0][33]) ? eventMatches[0][33] : [])];
    const markets = rawMarkets.filter((market) => {
      if (!Array.isArray(market) || String(market[0] ?? '') !== marketId || !Array.isArray(market[13])) return false;
      const identity = classifyMarket(market);
      if (!identity || identity.type !== input.marketType || identity.scope !== input.scope ||
        !Number.isFinite(requestedLine)) return false;
      const lines = market[13].flatMap((selection) => {
        if (!Array.isArray(selection) || typeof selection[16] !== 'number') return [];
        return [identity.handicap && selection[9] === 3 ? -selection[16] : selection[16]];
      });
      return lines.some((line) => Math.abs(line - requestedLine) < 0.000001);
    });
    if (markets.length !== 1) return { ok: false, reason: markets.length === 0 ?
      'BTI_MARKET_NOT_FOUND' : 'BTI_MARKET_AMBIGUOUS' };
    const marketIdentity = classifyMarket(markets[0]);
    const expectedSide = input.selection === 'HOME' || input.selection === 'OVER' ? 1 :
      input.selection === 'AWAY' || input.selection === 'UNDER' ? 3 : null;
    const expectedLine = marketIdentity?.handicap && expectedSide === 3 ? -requestedLine : requestedLine;
    const selections = markets[0][13].filter((selection) => Array.isArray(selection) &&
      String(selection[0] ?? '') === input.providerSelectionId && expectedSide !== null &&
      selection[9] === expectedSide && typeof selection[16] === 'number' &&
      Math.abs(selection[16] - expectedLine) < 0.000001 && selection[5] !== true && selection[13] !== true);
    if (selections.length !== 1) return { ok: false, reason: selections.length === 0 ?
      'BTI_SELECTION_NOT_FOUND' : 'BTI_SELECTION_AMBIGUOUS' };
    const formats = Array.isArray(selections[0][8]) ? selections[0][8] : [];
    const rawOdds = typeof formats[5] === 'string' ? formats[5].trim() : '';
    if (!/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds) || Number(rawOdds) === 0) {
      return { ok: false, reason: 'BTI_PRICE_INVALID' };
    }
    return { ok: true, rawOdds, observedAtMs: Date.now() };
  })()`;
}

export function buildImSelectionPriceExpression(identity: SelectionPriceProbeIdentity): string {
  const input = JSON.stringify(identity);
  return `(() => {
    const input = ${input};
    const selectionCode = { HOME: '1', AWAY: '2', OVER: '3', UNDER: '4' }[input.selection];
    if (!selectionCode) return { ok: false, reason: 'IM_SELECTION_UNSUPPORTED' };
    const findCandidates = () => [...document.querySelectorAll('[id]')].filter((node) => {
      const parts = node.id.split('_');
      return parts.length === 6 && parts[0] === input.providerEventId &&
        parts[2] === selectionCode && parts[5] === input.providerMarketId;
    });
    const readOne = (targets, ambiguousReason) => {
      if (targets.length === 0) return null;
      if (targets.length !== 1) return { ok: false, reason: ambiguousReason };
      const target = targets[0];
      if (target.getClientRects().length === 0) return { ok: false, reason: 'IM_ID_HIDDEN' };
      const rawOdds = String(target.textContent ?? '').replace(/\\s+/gu, ' ').trim();
      if (!/^[+-]?\\d+(?:\\.\\d+)?$/u.test(rawOdds)) return { ok: false, reason: 'IM_PRICE_AMBIGUOUS' };
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      return { ok: true, rawOdds, observedAtMs: Date.now() };
    };
    const candidates = findCandidates();
    const exact = readOne(candidates, 'IM_ID_AMBIGUOUS');
    if (exact !== null) return exact;

    const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/[\\u0300-\\u036f]/gu, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\\s+/gu, ' ');
    const participants = [input.participantA, input.participantB].map(normalize).filter(Boolean);
    const pageLabel = normalize(document.body?.textContent);
    const detailEventIds = [...document.querySelectorAll('[id^="eventId-"]')]
      .map((node) => node.id.split('-').at(-1)).filter((value) => /^\\d+$/u.test(value ?? ''));
    const marketCode = { FT_AH: '5', FH_AH: '6', FT_TOTAL: '3', FH_TOTAL: '4',
      FT_1X2: '1', FH_1X2: '2' }[input.marketType];
    const sideCode = input.selection === 'HOME' || input.selection === 'OVER' ? 'h'
      : input.selection === 'AWAY' || input.selection === 'UNDER' ? 'a'
      : input.selection === 'DRAW' ? 'd' : null;
    if (participants.length === 2 && participants.every((participant) => pageLabel.includes(participant)) &&
      detailEventIds.length === 1 && marketCode && sideCode) {
      let detailTargets = [...document.querySelectorAll('.odd-item-detail[id^="odd-detail-"]')]
        .filter((node) => node.id.startsWith('odd-detail-' + detailEventIds[0] + '00' + marketCode) &&
          node.id.endsWith(sideCode));
      const lineNumber = input.line === null ? null : Number(input.line);
      if (detailTargets.length > 1 && input.marketType.endsWith('_AH') && Number.isFinite(lineNumber)) {
        const token = String(Math.round(Math.abs(lineNumber) * 100)).padStart(7, '0');
        detailTargets = detailTargets.filter((node) => node.id.endsWith(token + sideCode));
      }
      const detail = readOne(detailTargets, 'IM_ID_AMBIGUOUS');
      if (detail !== null) return detail;
    }

    if (candidates.length === 0) {
      const eventRows = [...document.querySelectorAll('.match-row-title')].filter((node) => {
        const label = normalize(node.textContent);
        return participants.length === 2 && participants.every((participant) => label.includes(participant));
      }).sort((left, right) => String(left.textContent ?? '').length - String(right.textContent ?? '').length);
      if (eventRows.length > 0) {
        eventRows[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        eventRows[0].click();
        return { ok: false, reason: 'IM_NAVIGATION_REQUESTED' };
      }
    }
    return { ok: false, reason: 'IM_ID_NOT_FOUND' };
  })()`;
}

export function buildGenericSelectionPriceExpression(identity: SelectionPriceProbeIdentity): string {
  const input = JSON.stringify(identity);
  return `(() => {
    const input = ${input};
    const visible = (node) => {
      if (!node || node.getClientRects().length === 0) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/[\\u0300-\\u036f]/gu, '')
      .toLocaleLowerCase('en').replace(/[^a-z0-9]+/gu, ' ').trim().replace(/\\s+/gu, ' ');
    const pricePattern = /^[+-]?\\d+(?:\\.\\d+)?$/u;
    const priceFrom = (target) => {
      const preferred = [target, ...target.querySelectorAll(
        '[class*="odd-value" i], [class*="odds-value" i], [class*="price" i], [class*="rate" i], [data-odds]')]
        .filter(visible).map((node) => String(node.getAttribute?.('data-odds') ?? node.textContent ?? '')
          .replace(/\\s+/gu, ' ').trim()).filter((value) => pricePattern.test(value));
      if (preferred.length > 0) return [...new Set(preferred)];
      return [...new Set(String(target.textContent ?? '').match(/[+-]?\\d+(?:\\.\\d+)?/gu) ?? [])];
    };
    const exactAttribute = (node, value) => node.id === value ||
      [...node.attributes].some((attribute) => attribute.value === value);
    const all = [...document.querySelectorAll('*')];
    const candidates = all.filter((node) => visible(node) &&
      (exactAttribute(node, input.providerSelectionId) || node.id === 'odd-item-' + input.providerSelectionId));
    let exactTargets = candidates;
    if (candidates.length > 1) {
      exactTargets = candidates.filter((node) => {
        const owners = []; for (let owner = node; owner; owner = owner.parentElement) owners.push(owner);
        return owners.some((owner) => exactAttribute(owner, input.providerMarketId)) &&
          owners.some((owner) => exactAttribute(owner, input.providerEventId));
      });
    }
    if (exactTargets.length > 0) {
      const priced = exactTargets.map((target) => ({ target, prices: priceFrom(target) }));
      const resolved = priced.filter((item) => item.prices.length === 1);
      if (resolved.length !== 1 || priced.some((item) => item.prices.length > 1)) {
        return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
      }
      const selected = resolved[0];
      selected.target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      return { ok: true, rawOdds: selected.prices[0], observedAtMs: Date.now() };
    }

    const participants = [input.participantA, input.participantB].map(normalize).filter(Boolean);
    if (participants.length !== 2) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    const containsParticipants = (node) => {
      const value = normalize(node.textContent);
      return participants.every((participant) => value.includes(participant));
    };
    const selectionSelector = 'button, [role="button"], li, tr, [class*="selection" i], ' +
      '[class*="odd-pair" i], [class*="market-odd" i]';
    const eventCandidates = all.filter((node) => visible(node) && containsParticipants(node) &&
      node.querySelector(selectionSelector) !== null).filter((node) =>
        ![...node.children].some((child) => visible(child) && containsParticipants(child) &&
          child.querySelector(selectionSelector) !== null));
    if (eventCandidates.length === 0) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };

    const lineNumber = input.line === null ? null : Number(input.line);
    const selectionLine = lineNumber === null || !Number.isFinite(lineNumber) ? null :
      input.marketType.endsWith('_AH') && input.selection === 'AWAY' ? -lineNumber : lineNumber;
    const lineForms = (value) => {
      if (value === null) return [];
      const sign = value < 0 ? '-' : '';
      const absolute = Math.abs(value);
      const forms = new Set([String(value), value > 0 ? '+' + value : String(value)]);
      const lower = Math.floor(absolute * 2) / 2;
      if (Math.abs(absolute - lower - 0.25) < 1e-9) {
        forms.add(sign + String(lower) + '/' + String(lower + 0.5));
        if (value > 0) forms.add('+' + String(lower) + '/' + String(lower + 0.5));
      }
      return [...forms].map((item) => item.replace(/\\s+/gu, ''));
    };
    const expectedLines = lineForms(selectionLine);
    const lineMatches = (node) => {
      if (expectedLines.length === 0) return input.line === null;
      const compact = String(node.textContent ?? '').replace(/\\s+/gu, '');
      return expectedLines.some((line) => compact.includes(line));
    };
    const participantForSelection = input.selection === 'HOME' ? participants[0] :
      input.selection === 'AWAY' ? participants[1] : null;
    const selectionMatches = (node) => {
      const value = normalize(node.textContent);
      if (participantForSelection !== null) return value.includes(participantForSelection);
      if (input.selection === 'OVER') return /(?:^| )(?:over|tai|o)(?: |$)/u.test(value);
      if (input.selection === 'UNDER') return /(?:^| )(?:under|xiu|u)(?: |$)/u.test(value);
      return value.includes(normalize(input.selection));
    };
    const marketContext = (node, eventNode) => {
      for (let owner = node.parentElement; owner && owner !== eventNode; owner = owner.parentElement) {
        const identity = normalize((owner.id || '') + ' ' + (owner.className || ''));
        if (/(?:^| )(?:market|group|period|bet|odd pair)(?: |$)/u.test(identity)) return owner;
      }
      return node.parentElement ?? eventNode;
    };
    const scopeMatches = (node) => {
      const value = normalize(node.textContent);
      const first = /(?:^| )(?:first half|1st half|1h|fh|hiep 1)(?: |$)/u.test(value);
      const second = /(?:^| )(?:second half|2nd half|2h|sh|hiep 2)(?: |$)/u.test(value);
      if (input.scope === 'FIRST_HALF') return first && !second;
      if (input.scope === 'SECOND_HALF') return second && !first;
      return !first && !second;
    };
    const semanticTargets = [];
    for (const eventNode of eventCandidates) {
      const selections = [...eventNode.querySelectorAll(selectionSelector)].filter((node) =>
        visible(node) && selectionMatches(node) && lineMatches(node));
      for (const target of selections) {
        const context = marketContext(target, eventNode);
        if (!scopeMatches(context)) continue;
        const prices = priceFrom(target);
        if (prices.length > 1) return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
        if (prices.length === 1) semanticTargets.push({ target, rawOdds: prices[0] });
      }
    }
    const uniqueTargets = [...new Map(semanticTargets.map((item) => [item.target, item])).values()];
    if (uniqueTargets.length === 0) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    if (uniqueTargets.length !== 1) return { ok: false, reason: 'VISIBLE_PRICE_AMBIGUOUS' };
    const target = uniqueTargets[0].target;
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    return { ok: true, rawOdds: uniqueTargets[0].rawOdds, observedAtMs: Date.now() };
  })()`;
}
