// Reuse IM's existing signed GetSE/GetMEI lane. The epoch is supplied by the
// observer and includes source, bridge and document identity.
export function buildImCatalogRefreshExpression(generation: string): string {
  return `(async () => {
    const generation = ${JSON.stringify(generation)};
    const root = document.documentElement;
    const startedAt = Date.now();
    if (location.hostname !== 'imsports.directsb.net') {
      const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
        .trim().toLowerCase().replace(/\\s+/g, ' ');
      const candidates = [...document.querySelectorAll('body *')].filter((element) => element &&
        typeof element.click === 'function' && element.children.length <= 4 && !element.hasAttribute('disabled'))
        .sort((a, b) => a.children.length - b.children.length);
      for (const label of ['truc tiep', 'live', 'bong da', 'football']) {
        const element = candidates.find((candidate) => normalize(candidate.textContent) === label);
        if (element) { element.click(); return { status: label, responses: [] }; }
      }
      return { status: 'navigation-not-found', responses: [] };
    }
    root.dataset.fieldlineImCatalogRefreshAt = String(startedAt);
    const key = '__fieldlineImNativeCatalogV1';
    const manager = window[key] || (window[key] = { state: null, physical: new Set() });
    if (!manager.state || manager.state.generation !== generation) {
      if (manager.state) {
        manager.state.retired = true;
        for (const controller of manager.state.controllers) controller.abort();
        for (const resolve of manager.state.waiters) resolve();
      }
      manager.state = { generation, retired: false, controllers: new Set(), owners: new Map(),
        catalogs: [], mainOperation: null, waiters: new Set(), leaseUntil: 0, rosterAtMs: 0,
        rosterFailures: 0, detailFailures: 0, rosterVersion: 0, publishedRosterVersion: 0, pump: null };
    }
    const state = manager.state;
    state.leaseUntil = startedAt + 20_000;
    const current = () => manager.state === state && !state.retired;
    const token = new URLSearchParams(location.search).get('to' + 'ken') || sessionStorage.getItem('to' + 'ken');
    if (!token) return { status: 'token-unavailable', responses: [] };
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
    // Existing source-proven football request scope; acquisition does not infer
    // additional native bet types or game periods from normalized market names.
    const common = { SportId: 1,
      BetTypeIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 18, 19, 20, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 38, 39, 42, 43, 44, 45, 78, 79, 80, 158, 159, 160, 161, 299, 306, 313],
      GamePeriods: [1, 2, 3], IsCombo: false, ['O' + 'ddsType']: 2,
      DateFrom: new Date(startedAt).toISOString().slice(0, 10).replace(/-/g, '/'),
      CompetitionIds: [], SortType: 2, ProgrammeIds: [] };
    const request = async (path, body) => {
      const controller = new AbortController();
      state.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const signature = String(await sign(path));
        if (!current() || controller.signal.aborted) throw new Error('retired');
        const response = await fetch(path, { method: 'POST', credentials: 'omit', cache: 'no-store',
          signal: controller.signal, headers: { Accept: 'application/json',
            'Content-Type': 'application/json; charset=utf-8', 'x-fieldline-catalog-probe': 'compact-v1',
            'x-sc': encodeURI(signature), 'x-v': '91938',
            'x-platform': String(window.global?.PlatForm || ''), ['x-' + 'token']: token },
          body: JSON.stringify(body) });
        const text = await response.text();
        const observedAtMs = Date.now();
        if (!current() || controller.signal.aborted || response.ok === false ||
          (typeof response.status === 'number' && response.status !== 200)) throw new Error('native-failure');
        return { parsed: JSON.parse(text), observedAtMs };
      } finally { clearTimeout(timer); state.controllers.delete(controller); }
    };
    const ownerIdentity = (event) => JSON.stringify([event.eid, event.edt, event.htn, event.atn, event.cn, event.iscyb]);
    const stamp = (markets, observedAtMs) => markets.map((market) =>
      market && typeof market === 'object' ? { ...market, fieldlineObservedAtMs: observedAtMs } : market);
    const validEvent = (event) => event && typeof event === 'object' &&
      (typeof event.eid === 'number' && Number.isFinite(event.eid) || typeof event.eid === 'string' && event.eid.length > 0) &&
      Array.isArray(event.mls);
    const activeOwners = () => new Set([...manager.physical].flatMap((work) =>
      work.state === state ? work.batch : []));
    const coverage = () => {
      const owners = [...state.owners.values()];
      const value = { prematchEvents: owners.length, detailEvents: owners.filter(o => o.lastDetailAtMs > 0).length,
        pendingEvents: owners.filter(o => o.lastDetailAtMs === 0).length,
        activeRequests: manager.physical.size, rosterAtMs: state.rosterAtMs,
        rosterFailures: state.rosterFailures, detailFailures: state.detailFailures,
        detailMarkets: owners.reduce((sum, o) => sum + o.markets.size, 0),
        unkeyedDetailRows: owners.reduce((sum, o) => sum + o.unkeyed.length, 0) };
      if (current()) root.dataset.fieldlineImNativeCoverage = JSON.stringify(value);
      return value;
    };
    const notify = () => { coverage(); for (const resolve of state.waiters) resolve(); state.waiters.clear(); };
    const eligible = () => {
      const active = activeOwners();
      return [...state.owners.values()].filter(owner => !active.has(owner) && owner.nextAtMs <= Date.now())
        .sort((a, b) => a.lastAttemptAtMs - b.lastAttemptAtMs);
    };
    state.pump = () => {
      if (!current() || Date.now() > state.leaseUntil) { notify(); return; }
      while (manager.physical.size < 2) {
        const batch = eligible().slice(0, 1);
        if (batch.length === 0) break;
        const owner = batch[0]; owner.lastAttemptAtMs = Date.now();
        const work = { state, batch }; manager.physical.add(work);
        void request('/api/EventV6/GetEBI/1/' + owner.key + '/false/2/false', undefined)
          .then(({ parsed, observedAtMs }) => {
            const event = parsed?.e;
            if (!current() || parsed?.StatusCode !== 100 || !validEvent(event) || event.isrbt !== false ||
              event.iscyb !== false || String(event.eid) !== owner.key || state.owners.get(owner.key) !== owner ||
              ownerIdentity(event) !== owner.identity) throw new Error('native-detail');
              owner.nativeResponse = parsed;
              // Native getSEVDataSuccess replaces the unfiltered EBI market
              // list. This only replaces this detail domain, not fresh GetSE.
              owner.markets = new Map();
              const unkeyed = [];
              for (const market of stamp(event.mls, observedAtMs)) {
                if (market && market.mi !== undefined && market.mi !== null) owner.markets.set(String(market.mi), market);
                else unkeyed.push(market);
              }
              owner.unkeyed = unkeyed;
              owner.lastDetailAtMs = observedAtMs; owner.nextAtMs = observedAtMs + 45_000;
          }).catch(() => {
            if (current()) { state.detailFailures++; for (const owner of batch) owner.nextAtMs = Date.now() + 15_000; }
          }).finally(() => {
            manager.physical.delete(work); notify(); manager.state?.pump?.();
          });
      }
      notify();
    };
    if (!state.mainOperation) {
      const operation = Promise.all([1, 2].map(async (Market) => ({ market: Market,
        ...await request('/api/EventV6/GetSE', { ...common, Market }) }))).then((catalogs) => {
        if (!current() || !catalogs.every(c => c.parsed?.StatusCode === 100 &&
          Array.isArray(c.parsed.sel) && c.parsed.sel.every(validEvent))) throw new Error('native-roster');
        const owners = new Map(); const conflicts = new Set();
        for (const catalog of catalogs) for (const event of catalog.parsed.sel) {
          event.mls = stamp(event.mls, catalog.observedAtMs);
          if (event.isrbt !== false || event.iscyb === true) continue;
          const key = String(event.eid), identity = ownerIdentity(event), prior = state.owners.get(key);
          if (!/^[1-9][0-9]{0,15}$/.test(key) || !Number.isSafeInteger(Number(key))) continue;
          if (owners.has(key) && owners.get(key).identity !== identity) { conflicts.add(key); continue; }
          owners.set(key, prior?.identity === identity ? prior : { key, eventId: event.eid, identity,
            markets: new Map(), unkeyed: [], nativeResponse: null, lastDetailAtMs: 0, lastAttemptAtMs: 0, nextAtMs: 0 });
        }
        for (const key of conflicts) owners.delete(key);
        state.owners = owners; state.catalogs = catalogs; state.rosterAtMs = Math.max(...catalogs.map(c => c.observedAtMs));
        state.rosterFailures = 0; state.rosterVersion++; state.pump();
      }).catch(() => { if (current()) state.rosterFailures++; }).finally(() => {
        if (state.mainOperation === operation) state.mainOperation = null; notify();
      });
      state.mainOperation = operation;
    }
    // Each observer evaluation has one eight-second budget. Physical requests
    // continue to count until they actually settle, even across epoch retirement.
    let budgetTimer;
    const budget = new Promise(resolve => { budgetTimer = setTimeout(resolve, 8000); });
    const settled = (async () => {
      await state.mainOperation;
      while (current() && Date.now() <= state.leaseUntil && (activeOwners().size > 0 || eligible().length > 0)) {
        await new Promise(resolve => state.waiters.add(resolve));
      }
    })();
    await Promise.race([settled, budget]); clearTimeout(budgetTimer);
    if (!current()) return { status: 'retired', responses: [] };
    if (state.rosterVersion <= state.publishedRosterVersion) {
      return { status: 'request-failed', responses: [], coverage: coverage() };
    }
    state.publishedRosterVersion = state.rosterVersion;
    const compactMarket = (market) => market && typeof market === 'object' ? {
      mi: market.mi, bti: market.bti, gp: market.gp, fieldlineObservedAtMs: market.fieldlineObservedAtMs,
      ws: Array.isArray(market.ws) ? market.ws.map(item => ({ wsi: item?.wsi, si: item?.si,
        hdp: item?.hdp, dih: item?.dih, o: item?.o })) : market.ws } : market;
    const responses = state.catalogs.map(catalog => ({ market: catalog.market,
      body: JSON.stringify({ StatusCode: catalog.parsed.StatusCode, sel: catalog.parsed.sel.map(event => {
        const merged = new Map(); const unkeyed = [];
        for (const market of event.mls) {
          if (market && market.mi !== undefined && market.mi !== null) merged.set(String(market.mi), market);
          else unkeyed.push(market);
        }
        const owner = state.owners.get(String(event.eid));
        if (owner?.identity === ownerIdentity(event)) for (const [id, market] of owner.markets) {
          const prior = merged.get(id);
          if (!prior || market.fieldlineObservedAtMs > prior.fieldlineObservedAtMs) merged.set(id, market);
        }
        if (owner?.identity === ownerIdentity(event)) unkeyed.push(...owner.unkeyed);
        return { eid: event.eid, edt: event.edt, htn: event.htn, atn: event.atn, cn: event.cn,
          isrbt: event.isrbt, iscyb: event.iscyb, hs: event.hs, as: event.as, rbt: event.rbt,
          mls: [...merged.values(), ...unkeyed].map(compactMarket) };
      }) }) }));
    return { status: state.rosterFailures ? 'request-failed' : 'catalog-requested', responses, coverage: coverage() };
  })()`;
}

export const IM_CATALOG_DISCOVERY_EXPRESSION = buildImCatalogRefreshExpression('legacy');
