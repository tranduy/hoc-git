/**
 * Read-only inventory of public SABA navigation and match-detail controls.
 *
 * The expression deliberately returns a serialized, size-bounded diagnostic so
 * Chrome cannot expose DOM nodes or page-owned objects across the CDP boundary.
 */
export const SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION = `(() => {
  try {
    // fieldline-saba-public-catalog-discovery
    const MAX_BYTES = 24 * 1024;
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D')
      .trim().toLowerCase().replace(/\\s+/g, ' ');
    const label = (element) => String(element?.innerText || element?.textContent || '')
      .trim().replace(/\\s+/g, ' ').slice(0, 80);
    const classes = (element) => [...(element?.classList || [])]
      .filter((name) => /^[a-z0-9_-]{1,64}$/iu.test(name)).slice(0, 12);
    const visible = (element) => {
      if (!element || element.getClientRects().length === 0) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const state = (element) => ({
      label: label(element),
      tag: String(element?.tagName || '').toLowerCase().slice(0, 24),
      classes: classes(element),
      selected: element?.getAttribute?.('aria-selected') === 'true' ||
        classes(element).some((name) => /^(?:active|current|selected)$/iu.test(name)),
      expanded: element?.getAttribute?.('aria-expanded') === 'true' ? true :
        element?.getAttribute?.('aria-expanded') === 'false' ? false : null,
      visible: visible(element)
    });
    const period = (element) => {
      const text = normalize(label(element));
      if (/^(?:hom nay|today)$/u.test(text)) return 'TODAY';
      if (/^(?:som|early)$/u.test(text)) return 'EARLY';
      if (/^(?:truc tiep|live)$/u.test(text)) return 'LIVE';
      return null;
    };

    const legacySections = [...document.querySelectorAll('.c-side-nav.c-side-nav--event')];
    const sportsSection = legacySections.find((section) => {
      const header = section.querySelector(':scope > .c-side-nav__header');
      const text = header?.querySelector('.c-text, .c-side-nav__title') || header;
      return /^(?:the thao|sports)$/u.test(normalize(text?.textContent));
    });
    const sportsHeader = sportsSection?.querySelector(':scope > .c-side-nav__header');
    const sportsHeaderLabel = sportsHeader?.querySelector('.c-text, .c-side-nav__title') || sportsHeader;
    const sportsScope = sportsSection && sportsHeaderLabel ? {
      headerLabel: label(sportsHeaderLabel), navParentClasses: classes(sportsSection)
    } : null;
    const legacyTabs = sportsSection ? [...sportsSection.querySelectorAll('.c-side-nav__tab')] : [];
    const compactTabs = sportsSection ? [] : [...document.querySelectorAll('.menu-item')];
    const rawNav = legacyTabs.length > 0 ? legacyTabs : compactTabs;
    let truncated = rawNav.length > 12;
    const navControls = rawNav.map((element) => ({ period: period(element), ...state(element) }))
      .filter((item) => item.period !== null).slice(0, 12);

    const compactTables = [...document.querySelectorAll('.c-odds-table--sport1')];
    const compactRows = [...document.querySelectorAll('.c-odds-table--sport1 .c-match[data-matchid]')];
    const legacyLeagues = [...document.querySelectorAll('.league')];
    const legacyRows = [...document.querySelectorAll('.match[id]')]
      .filter((row) => !row.matches('.c-match[data-matchid]'));
    const isPrematch = (row) => {
      const time = row.querySelector('.c-match-time, .tableDiv-match-time');
      const text = normalize(time?.textContent);
      // Live SABA rows use clocks such as 1H45+2' and 2H31'. A plain
      // not-"LIVE" check lets those consume every bounded sample. Only a
      // rendered provider kickoff is positive prematch evidence; some shells
      // prefix that kickoff with Truc Tiep, so the date/time wins when present.
      return /(?:^|\\s)\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?\\s+\\d{1,2}:\\d{2}(?:\\s?(?:am|pm))?(?:\\s|$)/iu
        .test(text) || /(?:^|\\s)\\d{1,2}:\\d{2}\\s?(?:am|pm)(?:\\s|$)/iu.test(text);
    };
    const isDated = (row) => /(?:^|\\s)\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?\\s+/u
      .test(normalize(row.querySelector('.c-match-time, .tableDiv-match-time')?.textContent));
    const prematchRows = [...compactRows, ...legacyRows].filter(isPrematch)
      .sort((left, right) => Number(isDated(right)) - Number(isDated(left)));
    if (prematchRows.length > 3) truncated = true;
    const excluded = '.c-odds, .odds, [data-moid], .betslip, [class*="bet-slip" i], .account, ' +
      '[class*="account" i], [class*="wallet" i], form, input, select, textarea';
    const candidates = 'button, [role="button"], [aria-expanded], [class*="more" i], [class*="expand" i], [class*="detail" i]';
    const controlsFor = (row) => {
      const all = [...row.querySelectorAll(candidates)].filter((element) => {
        if (element.closest(excluded) || element.querySelector('.c-odds, .odds, [data-moid]')) return false;
        const hint = normalize(label(element) + ' ' + classes(element).join(' '));
        return /(?:^|[ _-])(?:more|expand|detail|show|them|xem)(?:$|[ _-]|\\d)/u.test(hint);
      });
      if (all.length > 12) truncated = true;
      return all.slice(0, 12).map(state);
    };
    const safeMatchId = (row) => {
      const raw = row.getAttribute('data-matchid') || row.id || '';
      return /^[a-z0-9._:-]{1,128}$/iu.test(raw) ? raw : '';
    };
    const matches = prematchRows.slice(0, 3).map((row) => ({
      matchId: safeMatchId(row),
      shape: row.matches('.c-match[data-matchid]') ? 'COMPACT' : 'LEGACY',
      controls: controlsFor(row)
    }));

    const scrollCandidates = [...new Set([document.scrollingElement,
      ...document.querySelectorAll('main, [role="main"], .content, .sports-content, .catalog-scroll, .c-odds-table--sport1, [style*="overflow"]')])]
      .filter((element) => element && Number(element.scrollHeight) > Number(element.clientHeight));
    if (scrollCandidates.length > 6) truncated = true;
    const scroll = scrollCandidates.slice(0, 6).map((element) => ({
      tag: String(element.tagName || '').toLowerCase().slice(0, 24), classes: classes(element),
      clientHeight: Math.max(0, Math.round(Number(element.clientHeight) || 0)),
      scrollHeight: Math.max(0, Math.round(Number(element.scrollHeight) || 0)),
      scrollTop: Math.max(0, Math.round(Number(element.scrollTop) || 0))
    }));
    const result = {
      kind: 'SABA_PUBLIC_CATALOG_DISCOVERY', version: 1,
      scope: sportsSection ? 'LEGACY_SPORTS' : compactTabs.length > 0 ? 'COMPACT' : 'UNAVAILABLE',
      sportsScope,
      navControls,
      counts: { footballTables: compactTables.length, compactRows: compactRows.length,
        legacyLeagues: legacyLeagues.length, legacyRows: legacyRows.length,
        prematchRows: prematchRows.length },
      matches, scroll, truncated
    };
    const descriptors = [...(sportsScope ? [sportsScope] : []), ...navControls,
      ...matches.flatMap((match) => match.controls), ...scroll];
    const byteLength = (value) => new TextEncoder().encode(value).byteLength;
    let serialized = JSON.stringify(result);
    const descriptorClasses = (item) => item.classes || item.navParentClasses || [];
    while (byteLength(serialized) > MAX_BYTES && descriptors.some((item) => descriptorClasses(item).length > 1)) {
      for (let index = descriptors.length - 1; index >= 0; index -= 1) {
        if (descriptorClasses(descriptors[index]).length > 1) descriptorClasses(descriptors[index]).pop();
      }
      result.truncated = true;
      serialized = JSON.stringify(result);
    }
    while (byteLength(serialized) > MAX_BYTES && scroll.length > 0) {
      scroll.pop(); result.truncated = true; serialized = JSON.stringify(result);
    }
    while (byteLength(serialized) > MAX_BYTES && matches.some((match) => match.controls.length > 0)) {
      for (let index = matches.length - 1; index >= 0; index -= 1) matches[index].controls.pop();
      result.truncated = true;
      serialized = JSON.stringify(result);
    }
    return byteLength(serialized) <= MAX_BYTES ? serialized : JSON.stringify({
      kind: 'SABA_PUBLIC_CATALOG_DISCOVERY', version: 1, scope: 'UNAVAILABLE',
      sportsScope: null, navControls: [], counts: { footballTables: 0, compactRows: 0, legacyLeagues: 0,
        legacyRows: 0, prematchRows: 0 }, matches: [], scroll: [], truncated: true
    });
  } catch {
    return JSON.stringify({ kind: 'SABA_PUBLIC_CATALOG_DISCOVERY', version: 1,
      scope: 'UNAVAILABLE', sportsScope: null, navControls: [], counts: { footballTables: 0, compactRows: 0,
        legacyLeagues: 0, legacyRows: 0, prematchRows: 0 }, matches: [], scroll: [], truncated: true });
  }
})()`;
