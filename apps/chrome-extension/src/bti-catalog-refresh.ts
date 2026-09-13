// BTI page collector imported by NetworkObserver; deployment remains runtime-owner controlled.
export const BTI_CATALOG_REFRESH_EXPRESSION = String.raw`(async () => {
  const root = document.documentElement;
  const now = Date.now();
  // Shape only: how often the roster walk restarts, completes or loses its
  // session. Never deleted by a teardown, otherwise it could not count them.
  const statsKey = '__fieldlineBtiRosterStatsV1';
  const stats = root[statsKey] || (root[statsKey] = { starts: 0, completed: 0, failed: 0,
    teardownVersion: 0, teardownSession: 0, lostSession: 0, paused: 0, fetchNull: 0,
    partFail: { live: 0, prematch: 0, early: 0 }, startedAtMs: 0, completedAtMs: 0,
    doneEvents: 0, doneWithin24h: 0, doneLive: 0, donePrematch: 0, doneEarly: 0,
    gates: { live: '', prematch: '', early: '' },
    bodyLiveKb: 0, bodyLiveInitKb: 0, bodyPrematchKb: 0,
    shapes: { live: '', prematch: '', early: '' },
    answered: { live: '', prematch: '', early: '' } });
  if (!location.pathname || !location.hostname) return 'page-unavailable';
  const rosterWorkerKey = '__fieldlineBtiRosterWorkerV10';
  const detailBodiesKey = '__fieldlineBtiDetailBodiesV10';
  const detailWorkerKey = '__fieldlineBtiDetailWorkerV10';
  const detailStateKey = '__fieldlineBtiDetailStateV10';
  const authName = ['author', 'ization'].join('');
  const contextName = ['service', '-', 'context'].join('');
  const readAuth = () => localStorage.getItem(['CT_APP_', 'AUTH', 'ORIZATION'].join(''));
  const readContext = () => localStorage.getItem(['CT_APP_', 'SERVICE', '_CONTEXT'].join(''));
  const authValue = readAuth();
  const contextValue = readContext();
  const previousState = root[detailStateKey];
  const retainedBackpressure = previousState?.sameSession?.(authValue, contextValue) ? {
    requestRetryAtMs: previousState.requestRetryAtMs || 0,
    requestStatus: previousState.requestStatus || 0,
    requestFailures: previousState.requestFailures || 0,
    lastRequestFailureAtMs: previousState.lastRequestFailureAtMs || 0,
    authBlocked: previousState.authBlocked === true
  } : {};
  if (previousState && (previousState.collectorVersion !== 14 || !previousState.sameSession?.(authValue, contextValue))) {
    if (previousState.collectorVersion !== 14) stats.teardownVersion += 1;
    else stats.teardownSession += 1;
    const retainedBodies = previousState.sameSession?.(authValue, contextValue) &&
      Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
    for (const controller of previousState.listControllers || []) controller.abort();
    for (const controller of root[detailWorkerKey]?.controllers?.values?.() || []) controller.abort();
    for (const key of [rosterWorkerKey, detailWorkerKey, detailBodiesKey, detailStateKey]) delete root[key];
    if (retainedBodies.length > 0) root[detailBodiesKey] = retainedBodies;
    delete root.dataset.fieldlineBtiDetailVisits;
    delete root.dataset.fieldlineBtiCatalogRefreshAt;
  }
  const prior = Number(root.dataset.fieldlineBtiCatalogRefreshAt || 0);
  if (Number.isFinite(prior) && now - prior < 1800) return 'rate-limited';
  root.dataset.fieldlineBtiCatalogRefreshAt = String(now);
  // Acquisition deadlines, not freshness extensions. Missing kickoff is treated
  // conservatively as near-start; publication still uses the existing tick.
  const nearWindowMs = 6 * 60 * 60 * 1000;
  const nearTtlMs = 12000;
  const distantTtlMs = 60000;
  const retainedEventCap = 2048;
  const queueCap = 128;
  // Retire the incompatible queue. Its clockless cache cannot be replayed as new evidence.
  const legacyWorker = root.__fieldlineBtiDetailWorkerV9;
  if (legacyWorker) {
    for (const controller of legacyWorker.controllers?.values?.() || []) controller.abort();
    delete root.__fieldlineBtiDetailWorkerV9;
  }
  const detailState = root[detailStateKey] || { collectorVersion: 14, desired: new Set(), failures: new Map(), evicted: new Set(),
    starts: new Map(), listControllers: new Set(), committed: null, rosterRetryAtMs: 0, rosterRefreshFailed: false,
    requestRetryAtMs: 0, requestStatus: 0, requestFailures: 0, lastRequestFailureAtMs: 0, authBlocked: false,
    ...retainedBackpressure,
    sameSession: (auth, context) => auth === authValue && context === contextValue };
  root[detailStateKey] = detailState;
  const ownsSession = () => root[detailStateKey] === detailState && detailState.sameSession(readAuth(), readContext());
  const cancelled = () => ({ status: 'catalog-failed', responses: [] });
  const publishResult = (result) => ownsSession() && result?.status === 'catalog-requested' &&
    detailState.committed?.generation === result.generation
      ? detailState.committed.snapshot() : result;
  const requestsPaused = () => detailState.authBlocked || Date.now() < detailState.requestRetryAtMs;
  const recordBackpressure = (response) => {
    if (!ownsSession()) return;
    const status = Number(response?.status || 0);
    if (status !== 401 && status !== 403 && status !== 429 && !(status >= 500 && status <= 599)) return;
    const failedAtMs = Date.now();
    if (!requestsPaused()) {
      detailState.requestFailures = failedAtMs - detailState.lastRequestFailureAtMs > 5 * 60_000
        ? 1 : detailState.requestFailures + 1;
    }
    detailState.lastRequestFailureAtMs = failedAtMs;
    detailState.requestStatus = status;
    if (status === 401 || status === 403) detailState.authBlocked = true;
    const retryAfter = response?.headers?.get?.('Retry-After');
    const retryMs = typeof retryAfter === 'string' && /^\d+(?:\.\d+)?$/u.test(retryAfter.trim())
      ? Number(retryAfter) * 1000 : Date.parse(retryAfter || '') - failedAtMs;
    const backoffMs = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(4, detailState.requestFailures - 1));
    detailState.requestRetryAtMs = Math.max(detailState.requestRetryAtMs, failedAtMs + backoffMs,
      Number.isFinite(retryMs) && retryMs > 0 ? Math.min(Number.MAX_SAFE_INTEGER, failedAtMs + retryMs) : 0);
    // One provider refusal stops the shared queue, including already-owned
    // requests. Never walk every event or retry a rejected session on each tick.
    for (const controller of detailState.listControllers) controller.abort();
    for (const controller of root[detailWorkerKey]?.controllers?.values?.() || []) controller.abort();
  };
  const deadline = (eventId, cached) => {
    const start = detailState.starts.get(eventId);
    const scheduler = root.__fieldlineCollectionSchedulerV1;
    if (scheduler) return Math.max(
      scheduler.due(eventId, cached?.observedAtMs ?? null, Number.isFinite(start) ? start : undefined, false)
        ? 0 : Infinity, detailState.failures.get(eventId)?.retryAtMs || 0);
    const ttl = Number.isFinite(start) && start - Date.now() > nearWindowMs ? distantTtlMs : nearTtlMs;
    return Math.max(cached ? cached.observedAtMs + ttl : 0, detailState.failures.get(eventId)?.retryAtMs || 0);
  };
  const trimCache = () => {
    const cache = Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
    let bytes = cache.reduce((sum, item) => sum + item.body.length, 0);
    while (cache.length > retainedEventCap || bytes > 256 * 1024 * 1024) {
      const removed = cache.shift();
      bytes -= removed.body.length;
      detailState.evicted.add(removed.eventId);
    }
    root[detailBodiesKey] = cache;
  };
  const existingRosterWorker = root[rosterWorkerKey];
  if (requestsPaused()) return detailState.committed?.snapshot?.() || cancelled();
  if (!detailState.committed && now < detailState.rosterRetryAtMs) return cancelled();
  if (existingRosterWorker && existingRosterWorker.result &&
    (now - Number(existingRosterWorker.completedAt || 0) <= 12000 || now < detailState.rosterRetryAtMs)) {
    existingRosterWorker.pump?.();
    return existingRosterWorker.snapshot();
  }
  detailState.committed?.pump?.();
  if (existingRosterWorker && existingRosterWorker.promise && !existingRosterWorker.result) {
    if (detailState.committed?.snapshot) return detailState.committed.snapshot();
    return publishResult(await existingRosterWorker.promise);
  }
  const generation = 'bti:' + now + ':' + Math.floor(Math.random() * 1000000000);
  const rosterWorker = { generation, completedAt: 0, result: null, promise: null,
    coverage: { phase: 'INITIAL', liveLeagues: 0, prematchLeagues: 0, earlyLeagues: 0,
      earlyBatches: 0, earlyDone: 0,
      liveBatches: 0, prematchBatches: 0, liveDone: 0, prematchDone: 0, failed: 0,
      events: 0, namedEvents: 0, timedEvents: 0, marketEvents: 0, validEvents: 0,
      // Shape only: which fields an unnamed row carries and how far out it
      // kicks off. 1330 of 2386 discovered events were dropped for having no
      // name; this says whether those are today's fixtures worth recovering
      // or compact stubs that deserve dropping. No values, only field names.
      unnamedEvents: 0, unnamedWithin24h: 0, unnamedLater: 0, unnamedShapes: '',
      detailCachedEvents: 0, detailCachedBytes: 0, detailPendingEvents: 0 } };
  // The collector runs in whichever frame owns the provider API, so its
  // coverage on that frame's document can be unreachable from a probe that
  // evaluates in the top frame. Carry it back in the result as well: this path
  // reaches the API from the same frame that produced the roster.
  const publishedCoverage = () => {
    try {
      const text = String(root.dataset.fieldlineBtiRosterCoverage || '');
      return text.length > 0 && text.length <= 4096 ? text : '';
    } catch { return ''; }
  };
  const publishCoverage = () => {
    if (!ownsSession()) return;
    if (root[rosterWorkerKey] && root[rosterWorkerKey] !== rosterWorker) return;
    const cache = Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
    const cached = cache.filter((item) => detailState.desired.has(item.eventId));
    const worker = root[detailWorkerKey];
    const cachedById = new Map(cached.map((item) => [item.eventId, item]));
    const due = [...detailState.desired].filter((eventId) => deadline(eventId, cachedById.get(eventId)) <= Date.now()).length;
    Object.assign(rosterWorker.coverage, {
      detailRosterEvents: detailState.desired.size,
      detailCachedEvents: cached.length,
      detailCachedBytes: cached.reduce((sum, item) => sum + item.body.length, 0),
      detailEmptyEvents: cached.filter((item) => item.empty).length,
      detailPendingEvents: detailState.desired.size - cached.length,
      detailFailedEvents: detailState.failures.size,
      detailEvictedEvents: detailState.evicted.size,
      detailNearTtlMs: nearTtlMs, detailDistantTtlMs: distantTtlMs,
      detailDueEvents: due, detailDeferredEvents: detailState.desired.size - due,
      detailRetainedEventCap: retainedEventCap, detailQueueCap: queueCap,
      detailOverCapEvents: Math.max(0, detailState.desired.size - retainedEventCap),
      rosterRefreshFailed: detailState.rosterRefreshFailed,
      requestPaused: requestsPaused(), requestStatus: detailState.requestStatus,
      requestRetryInMs: Math.max(0, detailState.requestRetryAtMs - Date.now()),
      authBlocked: detailState.authBlocked,
      detailCoverageComplete: rosterWorker.coverage.phase === 'COMPLETE' &&
        !detailState.rosterRefreshFailed && detailState.desired.size <= retainedEventCap &&
        cached.length === detailState.desired.size && detailState.failures.size === 0 && detailState.evicted.size === 0,
      detailQueuedEvents: worker?.queue.length || 0,
      detailInFlightEvents: worker?.activeEventIds.size || 0,
      detailOldestReceiptAgeMs: cached.length > 0
        ? Math.max(...cached.map((item) => Math.max(0, Date.now() - item.observedAtMs))) : null,
      rosterStarts: stats.starts, rosterCompleted: stats.completed, rosterFailed: stats.failed,
      rosterTeardown: 'v' + stats.teardownVersion + '.s' + stats.teardownSession,
      rosterLostSession: stats.lostSession, rosterPaused: stats.paused,
      rosterFetchNull: stats.fetchNull,
      rosterPartFail: 'live:' + stats.partFail.live + ',pre:' + stats.partFail.prematch +
        ',early:' + stats.partFail.early,
      rosterDoneEvents: stats.doneEvents, rosterDoneWithin24h: stats.doneWithin24h,
      rosterDoneLive: stats.doneLive, rosterDonePrematch: stats.donePrematch,
      rosterDoneEarly: stats.doneEarly,
      rosterGateLive: stats.gates.live, rosterGateToday: stats.gates.prematch,
      rosterGateEarly: stats.gates.early,
      rosterBodyLiveKb: stats.bodyLiveKb, rosterBodyLiveInitKb: stats.bodyLiveInitKb,
      rosterBodyPrematchKb: stats.bodyPrematchKb,
      rosterShapeLive: stats.shapes.live, rosterShapeToday: stats.shapes.prematch,
      rosterShapeEarly: stats.shapes.early,
      rosterAnsweredLive: stats.answered.live, rosterAnsweredToday: stats.answered.prematch,
      rosterAnsweredEarly: stats.answered.early,
      rosterAgeMs: stats.startedAtMs > 0 ? Date.now() - stats.startedAtMs : null,
      rosterCompletedAgeMs: stats.completedAtMs > 0 ? Date.now() - stats.completedAtMs : null
    });
    root.dataset.fieldlineBtiRosterCoverage = JSON.stringify(rosterWorker.coverage);
  };
  stats.starts += 1;
  stats.startedAtMs = now;
  publishCoverage();
  root[rosterWorkerKey] = rosterWorker;
  rosterWorker.promise = (async () => {
  const listHeaders = { Accept: 'application/json', 'X-Fieldline-Generation': generation };
  if (authValue) listHeaders[authName] = authValue;
  if (contextValue) listHeaders[contextName] = contextValue;
  const listBase = '/api/eventlist/asia/leagues/v2/1/';
  const fetchList = async (path) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!ownsSession()) { stats.lostSession += 1; return null; }
      if (requestsPaused()) { stats.paused += 1; return null; }
      const controller = new AbortController();
      detailState.listControllers.add(controller);
      const requestedAtMs = Date.now();
      let timeoutId;
      const request = (async () => {
        const response = await fetch(path, { method: 'GET', credentials: 'include', cache: 'no-store',
          headers: listHeaders, signal: controller.signal });
        recordBackpressure(response);
        if (!response || !response.ok) return null;
        const body = typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json());
        return { path, body, payload: JSON.parse(body), requestedAtMs, observedAtMs: Date.now() };
      })().catch(() => null);
      const timeout = new Promise((resolve) => { timeoutId = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 5000); });
      const aborted = new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve(null), { once: true }));
      const result = await Promise.race([request, timeout, aborted]);
      clearTimeout(timeoutId);
      detailState.listControllers.delete(controller);
      if (!ownsSession()) { stats.lostSession += 1; return null; }
      if (result) return result;
      stats.fetchNull += 1;
    }
    return null;
  };
  const regionCandidate = globalThis.APP_USER_DATA?.countryCode ||
    globalThis.APP_USER_DATA?.userSettings?.countryCode;
  const regionCode = typeof regionCandidate === 'string' && /^[A-Za-z]{2}$/u.test(regionCandidate)
    ? regionCandidate.toUpperCase() : 'VN';
  const initialPlans = ['live', 'prematch'].map((partition) => ({
    partition,
    canonicalPath: listBase + partition,
    initialCanonicalPath: listBase + partition + '/initial',
    requestPath: listBase + partition + '/initial?regionCode=' +
      encodeURIComponent(regionCode) + '&leagueIds=01'
  }));
  // Native All Early is distinct from Today and spans beyond the calendar's
  // seven visible dates. Its initial response opens only ten leagues.
  const localDate = new Date(now);
  const earlyQuery = '?SportId=1&date=' + localDate.getFullYear() + '-' +
    String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(localDate.getDate()).padStart(2, '0') + '&allEvents=true';
  initialPlans.push({ partition: 'early', canonicalPath: '/api/eventlist/asia/leagues/v2/early',
    initialCanonicalPath: '/api/eventlist/asia/leagues/v2/early/initial',
    requestPath: '/api/eventlist/asia/leagues/v2/early/initial' + earlyQuery +
      '&regionCode=' + encodeURIComponent(regionCode) + '&leagueIds=01&returnAvailableDates=true' });
  const masterId = (league) => {
    const candidate = Array.isArray(league) ? league[3] ?? league[0] : null;
    return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : '';
  };
  // A row that carries two usable names is a roster row; one that does not is a
  // delta. Measured 2026-09-13: every live and today row reaching the API had no
  // participants and no display name, so the decoder dropped all 999 of them and
  // BTI held only All Early - 804 fixtures, none inside 24 hours.
  const rowHasNames = (event) => {
    const participants = Array.isArray(event?.[1]) ? event[1] : [];
    const names = participants.slice(0, 2).map((participant) => {
      const item = Array.isArray(participant) ? participant : null;
      const localized = item && item[1] && typeof item[1] === 'object' ? item[1] : {};
      const fallback = Object.values(localized).find((value) =>
        typeof value === 'string' && value.trim().length > 0);
      return String(localized.VI || localized.EN || localized.VN || fallback ||
        (item ? item[2] : '') || '').trim();
    });
    if (names.length === 2 && names.every(Boolean)) return true;
    const split = String(event?.[2] || '').split(/s+(?:v(?:s.?)?|[-–—])s+/iu)
      .map((name) => name.trim());
    return split.length === 2 && split.every(Boolean);
  };
  const namedLeagueRows = (league) => {
    let count = 0;
    for (const event of Array.isArray(league?.[12]) ? league[12] : []) {
      if (rowHasNames(event)) count += 1;
    }
    return count;
  };
  const namedRows = (payload) => {
    let count = 0;
    for (const league of Array.isArray(payload?.serializedData) ? payload.serializedData : []) {
      count += namedLeagueRows(league);
    }
    return count;
  };
  const hydratePartition = async (plan) => {
    // Every partition is addressed by master id, never by container id.
    // Measured 2026-09-13: asked for 72 live leagues and 267 of today's by
    // container id, the roster endpoint answered with its own default ten each
    // time, while early - which already asked by master id - was given all 156
    // it asked for. The rows carry both: index 0 is the container the merge is
    // keyed on, index 3 is the id the endpoint answers to.
    const requestId = (league) => masterId(league);
    let initial = await fetchList(plan.requestPath);
    if (!initial || !Array.isArray(initial.payload?.serializedData)) {
      stats.partFail[plan.partition] += 1;
      rosterWorker.coverage.failed += 1;
      rosterWorker.coverage.phase = 'FAILED';
      publishCoverage();
      return null;
    }
    // Live and prematch expose two endpoints under the same league ids: the
    // bare path answers with changed fields only, the /initial path with whole
    // roster rows. Expanding through the bare path is what stripped the names.
    // Early has no such split and keeps answering on its own canonical path.
    const hydrationPath = (ids) =>
      (plan.partition === 'early' ? plan.canonicalPath : plan.initialCanonicalPath) +
      (plan.partition === 'early' ? earlyQuery + '&' : '?') + 'leagueIds=' + ids.join(',');
    // Early has one endpoint that answers a request for ten league ids with
    // its full inventory, and it relies on that expansion: its initial response
    // opens only ten leagues. A failed expansion is fatal for early and merely
    // leaves live and prematch on their own initial list, which the league
    // discovery below then widens.
    if (initial.payload.serializedData.length > 0) {
      const identify = plan.partition === 'early' ? masterId : requestId;
      const expanded = initial.payload.serializedData.map(identify)
        .filter((id) => /^[A-Za-z0-9_-]+$/u.test(id)).slice(0, 10);
      const inventory = expanded.length > 0 ? await fetchList(hydrationPath(expanded)) : null;
      // More leagues is not more catalog. An expansion that returns a longer
      // list of rows the decoder cannot name is a loss, not a gain.
      const usable = inventory !== null && Array.isArray(inventory.payload?.serializedData) &&
        inventory.payload.serializedData.length >= initial.payload.serializedData.length &&
        namedRows(inventory.payload) >= namedRows(initial.payload);
      if (usable) initial = inventory;
      else if (plan.partition === 'early') {
        stats.partFail[plan.partition] += 1;
        rosterWorker.coverage.failed += 1;
        rosterWorker.coverage.phase = 'FAILED';
        publishCoverage();
        return null;
      }
    }
    // The roster endpoint answers with whole rows, but only for the leagues it
    // was asked about; the delta endpoint answers with the full league list, but
    // rows too thin to decode. Take the list from one and the rows from the
    // other rather than choosing between coverage and names: hydrating through
    // the delta path gave 291 of today's leagues and no usable row in any of
    // them, hydrating through the roster path alone gave whole rows for ten.
    const discovered = [];
    if (plan.partition !== 'early' && initial.payload.serializedData.length > 0) {
      const seed = initial.payload.serializedData.map(requestId)
        .filter((id) => /^[A-Za-z0-9_-]+$/u.test(id)).slice(0, 10);
      const catalogue = seed.length > 0
        ? await fetchList(plan.canonicalPath + '?leagueIds=' + seed.join(',')) : null;
      for (const league of Array.isArray(catalogue?.payload?.serializedData)
        ? catalogue.payload.serializedData : []) {
        const leagueId = requestId(league);
        if (leagueId && /^[A-Za-z0-9_-]+$/u.test(leagueId)) discovered.push(leagueId);
      }
    }
    const leagueIds = [];
    const seenLeagueIds = new Set();
    for (const league of initial.payload.serializedData) {
      const leagueId = requestId(league);
      if (!leagueId || !/^[A-Za-z0-9_-]+$/u.test(leagueId) || seenLeagueIds.has(leagueId)) continue;
      seenLeagueIds.add(leagueId);
      leagueIds.push(leagueId);
    }
    for (const leagueId of discovered) {
      if (seenLeagueIds.has(leagueId)) continue;
      seenLeagueIds.add(leagueId);
      leagueIds.push(leagueId);
    }
    const batches = [];
    for (let index = 0; index < leagueIds.length; index += 10) {
      batches.push(leagueIds.slice(index, index + 10));
    }
    rosterWorker.coverage[plan.partition + 'Leagues'] = leagueIds.length;
    rosterWorker.coverage[plan.partition + 'Batches'] = batches.length;
    rosterWorker.coverage.phase = 'HYDRATING';
    publishCoverage();
    const pages = new Array(batches.length);
    let nextBatch = 0;
    let failed = false;
    const worker = async () => {
      while (!failed) {
        const index = nextBatch;
        nextBatch += 1;
        if (index >= batches.length) return;
        const page = await fetchList(hydrationPath(batches[index]));
        if (!page || !Array.isArray(page.payload?.serializedData)) {
          failed = true;
          stats.partFail[plan.partition] += 1;
          rosterWorker.coverage.failed += 1;
          rosterWorker.coverage.phase = 'FAILED';
          publishCoverage();
          return;
        }
        pages[index] = page;
        rosterWorker.coverage[plan.partition + 'Done'] += 1;
        publishCoverage();
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, () => worker()));
    if (failed || pages.some((page) => !page)) return null;
    // Asking for a league is not the same as being given it. If the roster
    // endpoint answers a request for ten ids with only its own default set,
    // every batch after the first is wasted and coverage silently stops at ten
    // leagues however many the discovery step found.
    let requestedLeagues = 0;
    let answeredLeagues = 0;
    for (let index = 0; index < pages.length; index += 1) {
      const requested = new Set(batches[index]);
      requestedLeagues += requested.size;
      const answered = new Set();
      for (const league of pages[index].payload.serializedData) {
        const leagueId = requestId(league);
        if (requested.has(leagueId) && namedLeagueRows(league) > 0) answered.add(leagueId);
      }
      answeredLeagues += answered.size;
    }
    stats.answered[plan.partition] = requestedLeagues + '.' + answeredLeagues;
    const merged = new Map();
    const leagueClocks = new Map();
    const anonymous = [];
    const anonymousClocks = [];
    const rowRichness = (value) => {
      try { return JSON.stringify(value).length; } catch { return Array.isArray(value) ? value.length : 0; }
    };
    const addLeagues = (payload, clock) => {
      for (const league of payload.serializedData) {
        if (!Array.isArray(league)) continue;
        const candidate = league[0];
        const leagueId = typeof candidate === 'string' || typeof candidate === 'number'
          ? String(candidate) : '';
        if (!leagueId) {
          anonymous.push(league);
          if (Array.isArray(league[12]) && league[12].length > 0) anonymousClocks.push(clock);
          continue;
        }
        const existing = merged.get(leagueId);
        if (!Array.isArray(existing)) {
          merged.set(leagueId, league);
          leagueClocks.set(leagueId, clock);
          continue;
        }
        const events = new Map();
        const eventRows = [];
        const addEvents = (source) => {
          for (const event of Array.isArray(source?.[12]) ? source[12] : []) {
            if (!Array.isArray(event)) continue;
            const rawId = event[0];
            const eventId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
            if (!eventId) {
              eventRows.push(event);
              continue;
            }
            const retained = events.get(eventId);
            if (!retained) { events.set(eventId, event); continue; }
            // A named row beats an unnamed one whatever the byte counts say: a
            // delta row can serialize longer than a roster row and still be
            // undecodable. Richness only settles ties between rows of the same
            // kind.
            const incomingNamed = rowHasNames(event);
            if (incomingNamed !== rowHasNames(retained)) {
              if (incomingNamed) events.set(eventId, event);
              continue;
            }
            if (rowRichness(event) > rowRichness(retained)) events.set(eventId, event);
          }
        };
        addEvents(existing);
        addEvents(league);
        const richerLeague = rowRichness(league) > rowRichness(existing) ? league : existing;
        const combined = [...richerLeague];
        combined[12] = [...events.values(), ...eventRows];
        merged.set(leagueId, combined);
        const priorClock = leagueClocks.get(leagueId);
        leagueClocks.set(leagueId, { requestedAtMs: Math.min(priorClock.requestedAtMs, clock.requestedAtMs),
          observedAtMs: Math.min(priorClock.observedAtMs, clock.observedAtMs) });
      }
    };
    addLeagues(initial.payload, initial);
    for (let index = 0; index < pages.length; index += 1) {
      // An explicit league read supersedes that league's initial shell, even
      // when events/markets disappeared. Richness is not a freshness clock.
      // The one retirement that is never right is trading a league's named rows
      // for rows that carry no name: those decode to nothing, so the league
      // would simply disappear. That is how today's fixtures were lost. Any
      // other retirement, including one that empties a league, still stands.
      const requestedMasters = new Set(batches[index]);
      const incomingNamed = new Map();
      for (const league of pages[index].payload.serializedData) {
        const leagueId = requestId(league);
        if (leagueId !== '') incomingNamed.set(leagueId, namedLeagueRows(league) > 0);
      }
      for (const [containerId, league] of merged) {
        const leagueId = requestId(league);
        if (!requestedMasters.has(leagueId)) continue;
        if (namedLeagueRows(league) > 0 && incomingNamed.get(leagueId) !== true) continue;
        merged.delete(containerId);
        leagueClocks.delete(containerId);
      }
      // Every normal response also carries unexpanded shells for the other
      // leagues. Only the requested master IDs have authoritative full rows.
      addLeagues({ serializedData: pages[index].payload.serializedData.filter((league) =>
        plan.partition !== 'early' || requestedMasters.has(masterId(league))) }, pages[index]);
    }
    // The initial roster advertises hundreds of empty league shells. Returning
    // those shells (and the provider's unrelated top-level metadata) through
    // Runtime.evaluate can exceed CDP's by-value result limit, even though the
    // actual event catalog is much smaller. The adapter only consumes league
    // rows that own events, so keep every event-bearing row and discard only
    // provably empty shells from the direct recovery envelope.
    const populatedLeagues = [...merged.values(), ...anonymous].filter((league) =>
      Array.isArray(league?.[12]) && league[12].length > 0);
    const retainedClocks = [...merged].flatMap(([id, league]) =>
      Array.isArray(league?.[12]) && league[12].length > 0 ? [leagueClocks.get(id)] : []).concat(anonymousClocks);
    // One partition clock cannot express each league's age. Conservatively use
    // the oldest retained receipt; a slow/retried page must never freshen a fast
    // page's quotes. Empty snapshots use the authoritative request receipts.
    const clocks = retainedClocks.length > 0 ? retainedClocks : pages.length > 0 ? pages : [initial];
    const fieldlineBtiRoster = { requestedAtMs: Math.min(...clocks.map((clock) => clock.requestedAtMs)),
      observedAtMs: Math.min(...clocks.map((clock) => clock.observedAtMs)), generation, complete: true };
    const payload = { serializedData: populatedLeagues, fieldlineBtiRoster };
    const body = JSON.stringify(payload);
    return {
      partition: plan.partition,
      payload,
      responses: plan.partition === 'live'
        ? [{ path: plan.canonicalPath, body },
          { path: plan.initialCanonicalPath, body: JSON.stringify({ serializedData: [], fieldlineBtiRoster }) }]
        : [{ path: plan.initialCanonicalPath, body }]
    };
  };
  const partitions = await Promise.all(initialPlans.map(hydratePartition));
  if (!ownsSession()) return cancelled();
  if (!partitions.every(Boolean)) {
    detailState.rosterRefreshFailed = true;
    detailState.rosterRetryAtMs = Date.now() + 12000;
    const committed = detailState.committed;
    if (committed) {
      root[rosterWorkerKey] = committed;
      committed.pump();
      return committed.result;
    }
    throw new Error('ROSTER_UNAVAILABLE');
  }
  detailState.rosterRefreshFailed = false;
  detailState.rosterRetryAtMs = 0;
  const today = partitions.find((partition) => partition.partition === 'prematch');
  const early = partitions.find((partition) => partition.partition === 'early');
  const retainedPrematch = [today, early].filter((partition) => partition.payload.serializedData.length > 0);
  const prematchClocks = (retainedPrematch.length > 0 ? retainedPrematch : [today, early])
    .map((partition) => partition.payload.fieldlineBtiRoster);
  const prematchClock = { generation, complete: true,
    requestedAtMs: Math.min(...prematchClocks.map((clock) => clock.requestedAtMs)),
    observedAtMs: Math.min(...prematchClocks.map((clock) => clock.observedAtMs)) };
  // Native roster selections include many unused price formats and display
  // fields. Preserve the decoder's exact tuple positions and every native row
  // while keeping the complete Today + Early roster within the bridge budget.
  const compactRosterMarkets = (value) => {
    if (!Array.isArray(value)) return value;
    if (Array.isArray(value[3]) && Array.isArray(value[7])) {
      const market = value.slice();
      market[7] = value[7].map((selection) => {
        if (!Array.isArray(selection)) return selection;
        return selection.map((field, index) => index === 6 && Array.isArray(field)
          ? field.map((price, format) => format === 5 ? price : null)
          : [0, 1, 2, 3, 6, 7, 13].includes(index) ? field : null);
      });
      return market;
    }
    return value.map(compactRosterMarkets);
  };
  const compactRosterLeague = (league) => {
    if (!Array.isArray(league) || !Array.isArray(league[12])) return league;
    const next = league.slice();
    next[12] = league[12].map((event) => {
      if (!Array.isArray(event) || !Array.isArray(event[8])) return event;
      const row = event.slice();
      row[8] = compactRosterMarkets(event[8]);
      return row;
    });
    return next;
  };
  const listResponses = [...partitions.find((partition) => partition.partition === 'live').responses,
    { path: listBase + 'prematch/initial', body: JSON.stringify({
      serializedData: [...today.payload.serializedData, ...early.payload.serializedData].map(compactRosterLeague),
      fieldlineBtiRoster: prematchClock }) }];
  // Body size decides whether a partition can survive chunked assembly at all.
  // Kilobytes only, never content.
  for (const item of listResponses) {
    const kb = Math.round(item.body.length / 1024);
    if (item.path.endsWith('/live')) stats.bodyLiveKb = kb;
    else if (item.path.endsWith('/live/initial')) stats.bodyLiveInitKb = kb;
    else if (item.path.endsWith('/prematch/initial')) stats.bodyPrematchKb = kb;
  }
  const eventIds = [];
  const seen = new Set();
  const prematchEventIds = [];
  const seenPrematch = new Set();
  const liveIds = new Set(partitions.flatMap((entry) => entry.payload.serializedData.flatMap((league) =>
    (Array.isArray(league?.[12]) ? league[12] : []).flatMap((event) =>
      event?.[5] === true ? [String(event[0])] : []))));
  const unnamedShapeCounts = new Map();
  const starts = new Map();
  // Which partition actually carried events, and how many kick off soon. The
  // catalog holds 804 fixtures with none inside 24h; this says whether today's
  // and live's rows were never walked or were walked and then dropped later.
  const partitionEvents = { live: 0, prematch: 0, early: 0 };
  let within24h = 0;
  // The API drops a whole league when its name field is not a plain string,
  // and an event when its live flag, kickoff or two names fail. Replicate
  // those four gates here, per partition, so the one that rejects today and
  // live but not early is named instead of guessed. Counts only.
  const blank = () => ({ n: 0, f: 0, t: 0, m: 0, ok: 0 });
  const gates = { live: blank(), prematch: blank(), early: blank() };
  // Field positions and their types, never their contents: 'a2' is an array of
  // two, 's31' a string of 31 characters, 'o3' an object with three keys. One
  // row per partition is enough to see where live and today put the names that
  // early puts where the decoder looks.
  const shapes = { live: '', prematch: '', early: '' };
  const shapeOf = (value) => {
    if (value === null || value === undefined) return 'z';
    if (typeof value === 'boolean') return 'b';
    if (typeof value === 'number') return 'i';
    if (typeof value === 'string') return 's' + Math.min(999, value.length);
    if (Array.isArray(value)) return 'a' + Math.min(999, value.length);
    if (typeof value === 'object') return 'o' + Math.min(99, Object.keys(value).length);
    return 'u';
  };
  const rowShape = (event) => {
    const head = [];
    for (let index = 0; index < 13; index += 1) head.push(index + shapeOf(event?.[index]));
    const participant = Array.isArray(event?.[1]) ? event[1][0] : null;
    const tail = [];
    for (let index = 0; index < 4; index += 1) tail.push(index + shapeOf(participant?.[index]));
    return (head.join(',') + '.P.' + tail.join(',')).slice(0, 200);
  };
  const apiText = (value) => typeof value === 'string' ? value.trim() : '';
  const apiLocalized = (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
    return apiText(value.VI) || apiText(value.EN) || apiText(value.VN) ||
      Object.values(value).map(apiText).find((candidate) => candidate !== '') || '';
  };
  const apiNames = (event) => {
    const participants = Array.isArray(event[1]) ? event[1] : [];
    const names = participants.slice(0, 2).map((participant) => {
      const item = Array.isArray(participant) ? participant : null;
      return apiLocalized(item?.[1]) || apiText(item?.[2]);
    });
    if (names.length === 2 && names.every((name) => name !== '')) return names;
    const split = apiText(event[2]).split(/s+(?:v(?:s.?)?|[-–—])s+/iu).map((name) => name.trim());
    return split.length === 2 && split.every((name) => name !== '') ? split : names;
  };
  for (const entry of partitions) {
    const payload = entry?.payload;
    const leagues = Array.isArray(payload?.serializedData) ? payload.serializedData : [];
    for (const league of leagues) {
      const events = Array.isArray(league?.[12]) ? league[12] : [];
      for (const event of events) {
        const id = typeof event?.[0] === 'string' || typeof event?.[0] === 'number'
          ? String(event[0]) : '';
        if (!id) continue;
        partitionEvents[entry.partition] += 1;
        const gate = gates[entry.partition];
        const apiLeagueNamed = apiText(league?.[1]) !== '';
        const apiLiveFlag = event?.[5] === true || event?.[5] === false;
        const apiTimed = event?.[5] === true || Number.isFinite(Date.parse(apiText(event?.[3])));
        const apiNamed = apiNames(event).length === 2 && apiNames(event).every((name) => name !== '');
        if (!apiLeagueNamed) gate.n += 1;
        else if (!apiLiveFlag) gate.f += 1;
        else if (!apiTimed) gate.t += 1;
        else if (!apiNamed) gate.m += 1;
        else gate.ok += 1;
        // Record the first row that fails the name gate, and for a partition
        // with no failures the first row that passes, as the reference shape.
        if (shapes[entry.partition] === '' && (!apiNamed || gate.ok === 1)) {
          shapes[entry.partition] = rowShape(event);
        }
        if (entry?.partition !== 'live' && event?.[5] === false && !liveIds.has(id) && !seenPrematch.has(id)) {
          seenPrematch.add(id);
          prematchEventIds.push(id);
          starts.set(id, Date.parse(String(event[3] || '')));
        }
        if (seen.has(id)) continue;
        seen.add(id);
        eventIds.push(id);
        const kickoffMs = Date.parse(String(event?.[3] || ''));
        if (event?.[5] === true ||
          (Number.isFinite(kickoffMs) && kickoffMs - now < 86400000)) within24h += 1;
        const participants = Array.isArray(event?.[1]) ? event[1] : [];
        const names = participants.slice(0, 2).map((participant) => {
          const localized = Array.isArray(participant) && participant[1] &&
            typeof participant[1] === 'object' ? participant[1] : {};
          const fallback = Object.values(localized).find((value) =>
            typeof value === 'string' && value.trim().length > 0);
          return String(localized.VI || localized.EN || localized.VN || fallback ||
            (Array.isArray(participant) ? participant[2] : '') || '').trim();
        });
        const splitNames = String(event?.[2] || '').split(/\s+(?:v(?:s\.?)?|[-\u2013\u2014])\s+/iu)
          .map((name) => name.trim());
        const named = (names.length === 2 && names.every(Boolean)) ||
          (splitNames.length === 2 && splitNames.every(Boolean));
        const timed = event?.[5] === true || (event?.[5] === false &&
          Number.isFinite(Date.parse(String(event?.[3] || ''))));
        const hasMarkets = Array.isArray(event?.[8]) && event[8].length > 0;
        if (named) rosterWorker.coverage.namedEvents += 1;
        if (timed) rosterWorker.coverage.timedEvents += 1;
        if (hasMarkets) rosterWorker.coverage.marketEvents += 1;
        if (named && timed) rosterWorker.coverage.validEvents += 1;
        if (!named) {
          rosterWorker.coverage.unnamedEvents += 1;
          const startMs = Date.parse(String(event?.[3] || ''));
          if (Number.isFinite(startMs) && startMs - now < 86_400_000) {
            rosterWorker.coverage.unnamedWithin24h += 1;
          } else rosterWorker.coverage.unnamedLater += 1;
          const shape = [1, 2, 3, 5, 8].filter((index) => {
            const field = event?.[index];
            return Array.isArray(field) ? field.length > 0
              : typeof field === 'string' ? field.trim().length > 0 : field !== null && field !== undefined;
          }).join('.') || 'none';
          if (!unnamedShapeCounts.has(shape) && unnamedShapeCounts.size >= 8) { /* bounded */ }
          else unnamedShapeCounts.set(shape, (unnamedShapeCounts.get(shape) || 0) + 1);
        }
      }
    }
  }
  rosterWorker.coverage.phase = partitions.length === initialPlans.length && partitions.every(Boolean)
    ? 'COMPLETE' : 'FAILED';
  rosterWorker.coverage.events = eventIds.length;
  stats.doneEvents = eventIds.length;
  stats.doneWithin24h = within24h;
  stats.doneLive = partitionEvents.live;
  stats.donePrematch = partitionEvents.prematch;
  stats.doneEarly = partitionEvents.early;
  const gateText = (value) => 'n' + value.n + '.f' + value.f + '.t' + value.t +
    '.m' + value.m + '.ok' + value.ok;
  stats.gates = { live: gateText(gates.live), prematch: gateText(gates.prematch),
    early: gateText(gates.early) };
  stats.shapes = shapes;
  rosterWorker.coverage.unnamedShapes = [...unnamedShapeCounts]
    .sort((left, right) => right[1] - left[1])
    .map(([shape, count]) => shape + ':' + count).join(',');
  publishCoverage();
  let priorVisits = {};
  try {
    const parsed = JSON.parse(root.dataset.fieldlineBtiDetailVisits || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) priorVisits = parsed;
  } catch { /* A malformed page-owned dataset must not stop catalog refresh. */ }
  if (partitions.length === initialPlans.length && partitions.every(Boolean)) {
    const plannedEvents = root.__fieldlineCollectionPlanV1?.events;
    const plannedIds = Array.isArray(plannedEvents) ? new Set(plannedEvents.flatMap((item) =>
      item && typeof item.eventId === 'string' && item.eventId.length > 0 ? [item.eventId] : [])) : null;
    const detailEventIds = plannedIds === null ? prematchEventIds
      : prematchEventIds.filter((eventId) => plannedIds.has(eventId));
    const ranked = detailEventIds.map((eventId, index) => {
      const visitedAt = Number(priorVisits[eventId]);
      return { eventId, index, visitedAt: Number.isFinite(visitedAt) && visitedAt > 0 ? visitedAt : 0 };
    }).sort((left, right) => left.visitedAt - right.visitedAt || left.index - right.index);
    const selected = ranked.map(({ eventId }) => eventId);
    const desiredPrematchIds = new Set(selected);
    detailState.desired = desiredPrematchIds;
    detailState.starts = starts;
    detailState.committed = rosterWorker;
    for (const eventId of detailState.failures.keys()) {
      if (!desiredPrematchIds.has(eventId)) detailState.failures.delete(eventId);
    }
    for (const eventId of detailState.evicted) {
      if (!desiredPrematchIds.has(eventId)) detailState.evicted.delete(eventId);
    }
    const retainedDetailCache = (Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [])
      .filter((item) => {
        if (!item || typeof item.path !== 'string') return false;
        const prefix = '/api/eventpage/events/';
        if (!item.path.startsWith(prefix)) return false;
        try { return desiredPrematchIds.has(decodeURIComponent(item.path.slice(prefix.length))); }
        catch { return false; }
      });
    root[detailBodiesKey] = retainedDetailCache;
    const nextVisits = {};
    for (const [eventId, value] of Object.entries(priorVisits)) {
      const visitedAt = Number(value);
      if (desiredPrematchIds.has(eventId) && Number.isFinite(visitedAt) && visitedAt > 0 && now - visitedAt <= 10 * 60 * 1000) {
        nextVisits[eventId] = visitedAt;
      }
    }
    root.dataset.fieldlineBtiDetailVisits = JSON.stringify(nextVisits);
    const pump = () => {
    if (!ownsSession() || requestsPaused() || detailState.committed !== rosterWorker) return;
    trimCache();
    const cachedById = new Map(root[detailBodiesKey].map((item) => [item.eventId, item]));
    let dueIds = selected.filter((eventId) => deadline(eventId, cachedById.get(eventId)) <= Date.now())
      .sort((left, right) => (cachedById.get(left)?.observedAtMs || 0) - (cachedById.get(right)?.observedAtMs || 0));
    if (root.__fieldlineCollectionSchedulerV1) dueIds = root.__fieldlineCollectionSchedulerV1.sort(dueIds);
    const nextJob = { generation, headers: { ...listHeaders }, eventIds: selected, dueIds, publishCoverage };
    const currentWorker = root[detailWorkerKey];
    if (currentWorker && typeof currentWorker.update === 'function') {
      currentWorker.update(nextJob);
      // Refilling the queue is not the same as having anyone to drain it. A
      // lane exits when the queue runs dry, and the worker object only retires
      // once every lane has exited - so while a single slow lane survives, the
      // other two are gone for good and never restart. Measured 2026-09-13:
      // BTI sat at 186 events due and 107 queued with one lane in flight, and
      // every corner price on fixtures three to thirteen hours out was three
      // hours old, while the tiers either side of them were current.
      currentWorker.start?.();
    } else {
      // A worker from an older extension build cannot be trusted to own the
      // complete queue. Retire only that incompatible object; current workers
      // keep their in-flight request and adopt new generation headers.
      if (currentWorker) delete root[detailWorkerKey];
      const detailWorker = {
        generation: '',
        headers: nextJob.headers,
        desired: new Set(),
        queue: [],
        activeEventIds: new Set(),
        controllers: new Map(),
        lanes: 0,
        update(job) {
          this.generation = job.generation;
          this.headers = job.headers;
          this.publishCoverage = job.publishCoverage;
          const desired = new Set(job.eventIds);
          for (const [eventId, controller] of this.controllers) {
            if (!desired.has(eventId)) controller.abort();
          }
          this.queue = [];
          const queued = new Set(this.queue);
          for (const eventId of job.dueIds) {
            if (this.queue.length >= queueCap) break;
            if (this.activeEventIds.has(eventId) || queued.has(eventId) ||
              (detailState.failures.get(eventId)?.retryAtMs || 0) > Date.now()) continue;
            queued.add(eventId);
            this.queue.push(eventId);
          }
          this.desired = desired;
        },
        markVisited(eventId) {
          let visits = {};
          try {
            const parsed = JSON.parse(root.dataset.fieldlineBtiDetailVisits || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) visits = parsed;
          } catch { /* Rebuild malformed page-owned scheduling state. */ }
          visits[eventId] = Date.now();
          root.dataset.fieldlineBtiDetailVisits = JSON.stringify(visits);
        }
      };
      root[detailWorkerKey] = detailWorker;
      const runDetailLane = async () => {
        while (ownsSession() && !requestsPaused() && root[detailWorkerKey] === detailWorker && detailWorker.queue.length > 0) {
          const eventId = detailWorker.queue.shift();
          if (!eventId || !detailWorker.desired.has(eventId)) continue;
          const latest = root[detailBodiesKey]?.find(item => item.eventId === eventId);
          if (deadline(eventId, latest) > Date.now()) continue;
          detailWorker.activeEventIds.add(eventId);
          const headers = { ...detailWorker.headers };
          const requestedAtMs = Date.now();
          const controller = new AbortController();
          detailWorker.controllers.set(eventId, controller);
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          let successful = false;
          detailWorker.publishCoverage();
          try {
            const request = (async () => {
              const response = await fetch('/api/eventpage/events/' + encodeURIComponent(eventId) +
              '?hideX25X75Selections=false',
            { method: 'GET', credentials: 'include', cache: 'no-store', headers,
              signal: controller.signal });
            recordBackpressure(response);
            let body = '';
            if (typeof response?.text === 'function') body = await response.text();
            else if (typeof response?.json === 'function') body = JSON.stringify(await response.json());
            else if (typeof response?.arrayBuffer === 'function') {
              body = new TextDecoder().decode(await response.arrayBuffer());
            }
              return { response, body, observedAtMs: Date.now() };
            })().catch(() => null);
            const aborted = new Promise((resolve) => {
              controller.signal.addEventListener('abort', () => resolve(null), { once: true });
              if (controller.signal.aborted) resolve(null);
            });
            const result = await Promise.race([request, aborted]);
            if (!result || controller.signal.aborted) throw new Error('DETAIL_REQUEST_FAILED');
            const { response, body, observedAtMs } = result;
            const metadata = { eventId, requestedAtMs, observedAtMs,
              generation: headers['X-Fieldline-Generation'] };
            let compactBody = '';
            try {
              const payload = JSON.parse(body);
              if (payload && Array.isArray(payload.data) && payload.data.every((row) =>
                Array.isArray(row) && String(row[0]) === eventId)) {
                const compactLocalized = (value) => {
                  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
                  const compact = {};
                  for (const key of ['VI', 'EN', 'VN']) {
                    if (typeof value[key] === 'string' && value[key].trim()) compact[key] = value[key];
                  }
                  if (Object.keys(compact).length === 0) {
                    const fallback = Object.values(value).find((item) => typeof item === 'string' && item.trim());
                    if (fallback) compact._ = fallback;
                  }
                  return compact;
                };
                const compactName = (value) => {
                  if (typeof value === 'string') return value.trim();
                  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
                  for (const key of ['VI', 'EN', 'VN', '_']) {
                    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
                  }
                  return '';
                };
                const participantName = (value) => Array.isArray(value)
                  ? compactName(value[1]) || compactName(value[2]) : '';
                const placeholderPair = (participants) => {
                  if (!Array.isArray(participants) || participants.length < 2) return true;
                  const normalized = participants.slice(0, 2).map((participant) => participantName(participant)
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                    .replace(/[^a-z0-9]+/g, ' ').trim());
                  const pair = normalized.join('|');
                  return pair === 'home|away' || pair === 'team a|team b' ||
                    pair === 'doi nha|doi khach' || pair === 'chu nha|doi khach';
                };
                const compactParticipant = (value) => {
                  if (!Array.isArray(value)) return null;
                  const compact = Array(3).fill(null);
                  if (typeof value[0] === 'string' || typeof value[0] === 'number') compact[0] = value[0];
                  const candidates = [value[1], value[2]].map((candidate) => {
                    if (typeof candidate === 'string' && candidate.trim()) {
                      return { name: candidate.trim(), localized: { _: candidate.trim() }, raw: candidate.trim() };
                    }
                    const localized = compactLocalized(candidate);
                    return localized ? { name: compactName(localized), localized, raw: null } : null;
                  }).filter((candidate) => candidate && candidate.name);
                  const generic = (name) => /^(?:home|away|team [ab12]|doi nha|doi khach|chu nha)$/u.test(
                    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                      .replace(/[^a-z0-9]+/g, ' ').trim());
                  const selected = candidates.find((candidate) => !generic(candidate.name)) || candidates[0];
                  if (selected) {
                    compact[1] = selected.localized;
                    if (selected.raw) compact[2] = selected.raw;
                  }
                  return compact;
                };
                const compactSelection = (value) => {
                  if (!Array.isArray(value)) return null;
                  // Preserve every native selection. Whether its side, line,
                  // odds or settlement shape is comparison-safe belongs to
                  // the API inventory/mapping boundary; filtering here made
                  // unsupported card/corner/prop groups disappear silently.
                  const compact = Array(17).fill(null);
                  for (const index of [0, 5, 9, 13, 16]) compact[index] = value[index] ?? null;
                  compact[2] = typeof value[2] === 'string' ? value[2] : compactLocalized(value[2]);
                  const formats = Array.isArray(value[8]) ? Array(6).fill(null) : null;
                  if (formats) formats[5] = value[8][5] ?? null;
                  compact[8] = formats;
                  return compact;
                };
                const compactMarket = (value) => {
                  if (!Array.isArray(value)) return null;
                  const nativeType = Array.isArray(value[5]) ? value[5] : [];
                  const id = typeof value[0] === 'string' || typeof value[0] === 'number'
                    ? String(value[0]).trim() : '';
                  const label = compactName(value[1]);
                  const code = (typeof nativeType[0] === 'string' || typeof nativeType[0] === 'number'
                    ? String(nativeType[0]).trim() : compactName(nativeType[0])) ||
                    (typeof nativeType[1] === 'string' || typeof nativeType[1] === 'number'
                      ? String(nativeType[1]).trim() : compactName(nativeType[1])) || label;
                  const selections = Array.isArray(value[13])
                    ? value[13].map(compactSelection) : [];
                  const compact = Array(24).fill(null);
                  for (const index of [0, 1, 15, 23]) compact[index] = value[index] ?? null;
                  compact[1] = typeof value[1] === 'string' ? value[1] : compactLocalized(value[1]);
                  if (Array.isArray(value[5])) compact[5] = [
                    typeof value[5][0] === 'string' || typeof value[5][0] === 'number'
                      ? String(value[5][0]) : compactLocalized(value[5][0]),
                    typeof value[5][1] === 'string' || typeof value[5][1] === 'number'
                      ? String(value[5][1]) : compactLocalized(value[5][1])
                  ];
                  compact[13] = selections;
                  return compact;
                };
                const compactEvent = (value) => {
                  if (!Array.isArray(value)) return null;
                  const compact = Array(34).fill(null);
                  for (const index of [0, 2, 11, 13, 32]) compact[index] = value[index] ?? null;
                  let participants = Array.isArray(value[8])
                    ? value[8].slice(0, 2).map(compactParticipant).filter(Boolean) : [];
                  for (const index of [20, 33]) {
                    compact[index] = Array.isArray(value[index])
                      ? value[index].map(compactMarket).filter(Boolean) : [];
                  }
                  if (placeholderPair(participants)) {
                    const markets = [...compact[20], ...compact[33]];
                    for (const market of markets) {
                      const type = Array.isArray(market?.[5]) ? market[5] : [];
                      const code = String(type[0] || type[1] || market?.[1] || '').trim();
                      if (!/^HC(?:39|0|1)$/u.test(code)) continue;
                      const selections = Array.isArray(market?.[13]) ? market[13] : [];
                      const home = selections.find((selection) => Array.isArray(selection) && selection[9] === 1);
                      const away = selections.find((selection) => Array.isArray(selection) && selection[9] === 3);
                      if (!home || !away) continue;
                      const candidate = [home, away].map((selection, index) => {
                        const participant = Array.isArray(participants[index]) ? participants[index] : [];
                        const hydrated = Array(3).fill(null);
                        hydrated[0] = participant[0] ?? selection[0] ?? null;
                        if (selection[2] && typeof selection[2] === 'object') hydrated[1] = selection[2];
                        else if (typeof selection[2] === 'string') hydrated[2] = selection[2];
                        return hydrated;
                      });
                      if (!placeholderPair(candidate) && candidate.every((participant) => participantName(participant))) {
                        participants = candidate;
                        break;
                      }
                    }
                  }
                  compact[8] = participants;
                  return compact;
                };
                const compactEvents = payload.data.map(compactEvent).filter(Boolean);
                compactBody = JSON.stringify({ data: compactEvents, fieldlineBtiDetails: [metadata] });
              }
            } catch { /* Invalid or empty detail is not useful catalog evidence. */ }
            if (ownsSession() && root[detailWorkerKey] === detailWorker && !controller.signal.aborted &&
              detailWorker.desired.has(eventId) && response?.ok && compactBody.length > 0 &&
              compactBody.length <= 2 * 1024 * 1024) {
              const cached = Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
              const path = '/api/eventpage/events/' + encodeURIComponent(eventId);
              const existingIndex = cached.findIndex((item) => item && item.path === path);
              if (existingIndex >= 0) cached.splice(existingIndex, 1);
              cached.push({ path, body: compactBody, ...metadata, empty: JSON.parse(compactBody).data.length === 0 });
              successful = true;
              root.__fieldlineCollectionSchedulerV1?.completed(eventId, observedAtMs);
              detailState.failures.delete(eventId);
              detailState.evicted.delete(eventId);
              detailWorker.markVisited(eventId);
              root[detailBodiesKey] = cached;
              trimCache();
            }
          } catch { /* Detail enrichment must not invalidate the complete list generation. */ }
          finally {
            clearTimeout(timeoutId);
            if (!successful && ownsSession() && root[detailWorkerKey] === detailWorker && detailWorker.desired.has(eventId)) {
              const attempts = (detailState.failures.get(eventId)?.attempts || 0) + 1;
              detailState.failures.set(eventId, { attempts,
                retryAtMs: Date.now() + Math.min(60000, 12000 * (2 ** Math.min(attempts - 1, 3))) });
            }
            if (detailWorker.controllers.get(eventId) === controller) detailWorker.controllers.delete(eventId);
            detailWorker.activeEventIds.delete(eventId);
            detailWorker.publishCoverage();
            // Three lanes, at most six detail starts per second even when
            // responses are immediate. Real response latency slows this further.
            if (detailWorker.queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      };
      detailWorker.start = () => {
        while (detailWorker.lanes < 3 && detailWorker.queue.length > 0 &&
          root[detailWorkerKey] === detailWorker && ownsSession() && !requestsPaused()) {
          detailWorker.lanes += 1;
          void runDetailLane().catch(() => undefined).finally(() => {
            detailWorker.lanes -= 1;
            if (detailWorker.lanes === 0) {
              if (root[detailWorkerKey] === detailWorker) delete root[detailWorkerKey];
              detailWorker.publishCoverage();
            }
          });
        }
      };
      detailWorker.update(nextJob);
      detailWorker.start();
    }
    publishCoverage();
    };
    rosterWorker.pump = pump;
    pump();
  }
  const snapshot = () => {
  if (!ownsSession()) return cancelled();
  const detailCache = partitions.length === initialPlans.length && partitions.every(Boolean) &&
    Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
  rosterWorker.coverage.detailCachedBytes = detailCache.reduce((sum, item) => sum +
    (item && typeof item.body === 'string' ? item.body.length : 0), 0);
  const cachedEventIds = new Set(detailCache.flatMap((item) => {
    if (!item || typeof item.path !== 'string') return [];
    const prefix = '/api/eventpage/events/';
    if (!item.path.startsWith(prefix)) return [];
    try { return [decodeURIComponent(item.path.slice(prefix.length))]; } catch { return []; }
  }));
  rosterWorker.coverage.detailCachedEvents = prematchEventIds.filter((eventId) => cachedEventIds.has(eventId)).length;
  rosterWorker.coverage.detailPendingEvents = prematchEventIds.filter((eventId) => !cachedEventIds.has(eventId)).length;
  publishCoverage();
  const cachedDetails = [];
  if (detailCache.length > 0) {
    const cachedById = new Map(detailCache.filter((item) => item && typeof item.eventId === 'string' &&
      typeof item.body === 'string').map((item) => [item.eventId, item]));
    // Cache receipts move to the tail on refresh. Keep a separate cyclic owner
    // order across roster generations so those writes cannot starve replay.
    const deliveryOrder = (detailState.deliveryOrder || []).filter((eventId) => cachedById.has(eventId));
    const queued = new Set(deliveryOrder);
    for (const eventId of cachedById.keys()) if (!queued.has(eventId)) deliveryOrder.push(eventId);
    detailState.deliveryOrder = deliveryOrder;
    const deliveredClocks = detailState.deliveredClocks || new Map();
    detailState.deliveredClocks = deliveredClocks;
    const deliveredAt = detailState.deliveredAt || (detailState.deliveredAt = new Map());
    for (const eventId of deliveredAt.keys()) if (!cachedById.has(eventId)) deliveredAt.delete(eventId);
    for (const eventId of deliveredClocks.keys()) if (!cachedById.has(eventId)) deliveredClocks.delete(eventId);
    // New receipts must not wait a full 1500-owner replay cycle. Spend at most
    // four MiB on newest receipts, leaving room in the eight-batch limit for
    // fair replay after a lost forward or an API restart. These clocks only
    // schedule delivery; they never replace the provider receipt timestamps.
    const priorityIds = [];
    let priorityBytes = 0;
    for (const eventId of deliveryOrder.filter((id) => cachedById.get(id).observedAtMs >
      (deliveredClocks.get(id) || 0)).sort((a, b) => cachedById.get(b).observedAtMs - cachedById.get(a).observedAtMs)) {
      const size = cachedById.get(eventId).body.length;
      if (priorityBytes + size > 4 * 1024 * 1024) break;
      priorityIds.push(eventId);
      priorityBytes += size;
    }
    const prioritySet = new Set(priorityIds);
    const scheduledOrder = [...priorityIds, ...deliveryOrder.filter((id) => !prioritySet.has(id))];
    let batch = [];
    let batchMetadata = [];
    let batchBytes = 0;
    let batchIndex = 0;
    const flushBatch = () => {
      if (batchMetadata.length === 0) return;
      cachedDetails.push({ path: '/api/eventpage/events/__fieldline_batch_' + batchIndex + '__',
        body: JSON.stringify({ data: batch, fieldlineBtiDetails: batchMetadata }) });
      batchIndex += 1;
      batch = [];
      batchMetadata = [];
      batchBytes = 0;
    };
    for (const eventId of scheduledOrder) {
      const item = cachedById.get(eventId);
      const scheduler = root.__fieldlineCollectionSchedulerV1;
      if (scheduler && item.observedAtMs <= (deliveredClocks.get(eventId) || 0)) {
        const start = detailState.starts.get(eventId);
        const interval = Math.max(60_000, scheduler.policy(eventId,
          Number.isFinite(start) ? start : undefined, false).refreshMs ?? 3_600_000);
        if (Date.now() - (deliveredAt.get(eventId) || 0) < interval) continue;
      }
      // The collector admits at most two MiB per event. Eight bounded batches
      // leave the three authoritative list responses available on every tick.
      if (batchMetadata.length > 0 && batchBytes + item.body.length > 1536 * 1024) flushBatch();
      if (cachedDetails.length >= 8) break;
      deliveryOrder.splice(deliveryOrder.indexOf(eventId), 1);
      deliveryOrder.push(eventId);
      try {
        if (item.body.length > 2 * 1024 * 1024) continue;
        const payload = JSON.parse(item.body);
        if (!Array.isArray(payload?.data) || !Array.isArray(payload?.fieldlineBtiDetails) ||
          payload.fieldlineBtiDetails.length === 0) continue;
        batch.push(...payload.data);
        batchMetadata.push(...payload.fieldlineBtiDetails);
        batchBytes += item.body.length;
        deliveredClocks.set(eventId, item.observedAtMs);
        deliveredAt.set(eventId, Date.now());
      } catch { /* Ignore a stale malformed page-cache entry. */ }
    }
    flushBatch();
  }
  const responses = new Map();
  // Retained API detail survives a roster generation. A fresh decoder fills
  // incrementally; cyclic replay also retries a lost forward without changing
  // its original request/receipt clocks or duplicating the full page cache.
  for (const item of [...cachedDetails, ...listResponses]) {
    if (item && typeof item.path === 'string' && typeof item.body === 'string') {
      responses.set(item.path, { url: item.path, body: item.body });
    }
  }
  return {
    status: 'catalog-requested',
    generation,
    coverage: publishedCoverage(),
    origin: location.origin || ('https://' + location.hostname),
    responses: [...responses.values()]
  };
  };
  rosterWorker.snapshot = snapshot;
  // Background completion retains the roster for inventory inspection but
  // must not consume delivery priority for detail that nobody has forwarded.
  return { status: 'catalog-requested', generation, coverage: publishedCoverage(),
    origin: location.origin || ('https://' + location.hostname),
    responses: listResponses.map((item) => ({ url: item.path, body: item.body })) };
  })().then((result) => {
    if (!ownsSession()) return cancelled();
    if (root[rosterWorkerKey] === rosterWorker) {
      rosterWorker.result = result;
      rosterWorker.completedAt = Date.now();
      stats.completed += 1;
      stats.completedAtMs = rosterWorker.completedAt;
    }
    return result;
  }).catch(() => {
    if (!ownsSession()) return cancelled();
    stats.failed += 1;
    rosterWorker.coverage.phase = 'FAILED';
    rosterWorker.coverage.failed += 1;
    publishCoverage();
    if (root[rosterWorkerKey] === rosterWorker) delete root[rosterWorkerKey];
    return {
      status: 'catalog-failed', generation,
      origin: location.origin || ('https://' + location.hostname), responses: []
    };
  });
  // After bootstrap, a slow All Early walk must not hold detail publication
  // behind its network requests. Reuse only receipts with their original clocks
  // and let the one existing roster worker finish in the background.
  if (detailState.committed?.snapshot && detailState.committed !== rosterWorker) {
    let publicationTimer;
    try {
      const result = await Promise.race([rosterWorker.promise, new Promise((resolve) => {
        publicationTimer = setTimeout(() => resolve(null), 250);
      })]);
      return result === null ? detailState.committed.snapshot() : publishResult(result);
    } finally { clearTimeout(publicationTimer); }
  }
  return publishResult(await rosterWorker.promise);
})()`;
