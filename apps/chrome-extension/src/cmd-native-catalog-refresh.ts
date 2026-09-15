/** Count-only diagnostics from our collector; never copy native text or identities. */
export function formatCmdNativeCatalogDiagnostic(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "CMD_NATIVE[unavailable]";
  const status = value as Record<string, unknown>;
  const fields: string[] = [];
  if (["frame-unavailable", "scope-unavailable", "ready", "roster-pending"].includes(String(status.status))) {
    fields.push(`status:${status.status}`);
  }
  for (const name of ["todayRows", "earlyRows", "runningRows", "groups", "done", "pending",
    "due", "waiting", "started", "passive", "unplanned", "rebuilt", "rebuiltCollected",
    "sharedEvents", "multiEventGroups", "groupsOneMatch", "groupsSeveralMatches", "partialGroups",
    "rowsNotSport", "rowsLiveGroup", "eventsDiscovered",
    "groupsCoveredTwice", "partialWanted",
    "cornerRows", "cornerSuffixOk", "cornerLooseOk", "cornerOneSided", "cornerNoParen",
    "bookingRows", "bookingSuffixOk", "failed",
    "active", "rosterActive", "requestStatus", "requestRetryInMs"]) {
    const count = status[name];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) fields.push(`${name}:${count}`);
  }
  // A page holding no scheduler reports -1 rather than nothing: an absent field
  // reads the same as a plan of zero, and that is how a missing plan hides.
  for (const name of ["planEvents", "planRevision"]) {
    const count = status[name];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= -1) fields.push(`${name}:${count}`);
  }
  for (const name of ["rosterFailed", "requestPaused"]) {
    if (typeof status[name] === "boolean") fields.push(`${name}:${status[name] ? 1 : 0}`);
  }
  // The parenthesised market suffix of a corner fixture the strict rule refused.
  // Bounded public label evidence, the same class the SABA walk reports, and
  // never the team it follows: without it the rule cannot be widened to exactly
  // what the provider writes.
  const shapes = status.cornerShapes;
  if (Array.isArray(shapes)) {
    const safe = shapes.filter((value): value is string => typeof value === "string" &&
      // A market tail, never a bare name: either parenthesised or introduced by
      // a dash. A widened class that accepted any word accepted team names too.
      // The separators this token is built from stay excluded.
      /^(?:\([\w\s.',\/&:-]{1,38}\)|-[\w\s.',\/&:-]{1,38})$/u.test(value)).slice(0, 6);
    if (safe.length > 0) fields.push(`cornerShapes:${safe.join("|")}`);
  }
  // Predicate name and row count only; anything else the page could put here is
  // dropped rather than carried into diagnostics.
  const reject = status.rosterReject;
  if (typeof reject === "string" && /^r[01]-[a-z-]{1,32}(?:-\d{1,9})?$/u.test(reject)) {
    fields.push(`rosterReject:${reject}`);
  }
  return `CMD_NATIVE[${fields.join(";")}]`;
}

// Native proof: CMD captures 1788862499540 (fc1/fc6 and row[34] group UUID),
// 1788862579593 (GetAllOdds). HTTP observation owns publication; this closure
// returns counts only and never invokes the provider's rendering callbacks.
export function buildCmdNativeCatalogRefreshExpression(generation: string): string {
  if (generation.length === 0 || generation.length > 512) throw new Error("CMD_GENERATION_INVALID");
  return String.raw`(() => {
    const generation = ${JSON.stringify(generation)};
    const root = document.documentElement;
    if (location.hostname !== 'cgnew.fts368.com' ||
      location.pathname !== '/Member/BetOdds/HdpDouble.aspx') return { status: 'frame-unavailable' };
    const key = '__fieldlineCmdNativeCatalogV1';
    let state = root[key];
    if (!state) state = root[key] = { generation, enabled: true, lastTick: 0, nextRosterAt: 0,
      rosterActive: 0, cycle: null, owners: new Map(), queue: [], active: new Map(),
      todayRows: 0, earlyRows: 0, runningRows: 0, rosterAtMs: 0, rosterFailed: false,
      rosterReject: null };
    // Keep backpressure in the document across worker/source-epoch changes.
    state.retryAtMs ??= 0; state.failureAtMs ??= -1; state.requestFailures ??= 0;
    state.requestStatus ??= 0; state.nextMoreAt ??= 0; state.pumpTimer ??= null;
    state.rebuilt ??= 0; state.rebuiltCollected ??= 0;
    state.sharedEvents ??= 0; state.multiEventGroups ??= 0;
    state.groupsOneMatch ??= 0; state.groupsSeveralMatches ??= 0;
    state.rowsNotSport ??= 0; state.rowsLiveGroup ??= 0; state.eventsDiscovered ??= 0;
    state.cornerRows ??= 0; state.cornerSuffixOk ??= 0;
    state.cornerLooseOk ??= 0; state.cornerOneSided ??= 0; state.cornerNoParen ??= 0;
    state.cornerShapes ??= [];
    state.bookingRows ??= 0; state.bookingSuffixOk ??= 0;
    const retire = () => {
      state.owners.clear(); state.queue = []; state.cycle = null; state.nextRosterAt = 0;
      state.todayRows = 0; state.earlyRows = 0; state.runningRows = 0; state.rosterAtMs = 0;
    };
    if (state.generation !== generation) { retire(); state.generation = generation; }
    const unavailable = () => {
      state.enabled = false; retire();
      return { status: 'scope-unavailable', generation };
    };
    if (typeof globalThis.GetOddsParams !== 'function' || typeof globalThis.GetOddsUrl !== 'function' ||
      typeof globalThis.callWebService !== 'function' ||
      (globalThis.ISPARLAYBETVIEW !== false && globalThis.ISPARLAYBETVIEW !== 0)) return unavailable();
    let requests;
    try {
      if (new URL(GetOddsUrl(), location.origin).href !==
        'https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx') return unavailable();
      requests = ['R_T_Full', 'E_Full'].map((kind) => GetOddsParams(kind, ''));
      const fields = { TimeFilter: '0', m_gameType: 'S_', m_SortByTime: '0', m_LeagueList: '',
        SingleDouble: 'double', clientTime: '', fav: '', exlist: '0', keywords: '', m_sp: '0' };
      if (requests.some((body, index) => {
        if (typeof body !== 'string' || body.length > 4096) return true;
        const params = new URLSearchParams(body);
        return Object.entries({ ...fields, fc: index === 0 ? '1' : '6' }).some(([name, value]) =>
          params.getAll(name).length !== 1 || params.get(name) !== value);
      })) return unavailable();
    } catch { return unavailable(); }
    state.enabled = true;
    state.lastTick = Date.now();
    const current = () => root[key] === state && state.enabled && state.generation === generation &&
      Date.now() - state.lastTick <= 15000;
    const paused = () => Date.now() < state.retryAtMs;
    const pauseRequests = (xhr) => {
      if (root[key] !== state) return;
      const now = Date.now();
      if (!paused()) {
        state.requestFailures = Math.min(30, state.requestFailures + 1);
        state.failureAtMs = now;
        state.retryAtMs = now + Math.min(300000, 30000 * 2 ** (state.requestFailures - 1));
      }
      const status = Number(xhr?.status);
      state.requestStatus = Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0;
      // Authentication refusal gets a longer quiet window. A page/session
      // change is not manufactured here, and no account value leaves the page.
      if (status === 401 || status === 403) state.retryAtMs = Math.max(state.retryAtMs, now + 900000);
      try {
        const header = xhr?.getResponseHeader?.('Retry-After');
        const delay = typeof header === 'string' && /^\d+(?:\.\d+)?$/u.test(header.trim())
          ? Number(header) * 1000 : Date.parse(header) - now;
        if (Number.isFinite(delay) && delay > 0 && Number.isSafeInteger(Math.ceil(now + delay))) {
          state.retryAtMs = Math.max(state.retryAtMs, Math.ceil(now + delay));
        }
      } catch { /* absent/blocked headers do not cancel the local backoff */ }
    };
    const requestSucceeded = (startedAtMs) => {
      if (!paused() && startedAtMs > state.failureAtMs) state.requestFailures = 0;
    };
    const uuid = (value) => typeof value === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
    const eventId = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ||
      typeof value === 'string' && /^[1-9]\d*$/u.test(value);
    const fullRow = (row) => Array.isArray(row) && row.length === 91 && eventId(row[0]) && uuid(row[34]);
    const metadataRow = (row) => Array.isArray(row) && row.length >= 128 && row.length <= 4096 &&
      row.length % 2 === 0 && row.every((value, index) => index % 2 === 0
        ? typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        : typeof value === 'string' && value.length > 0 && value.length <= 256);
    // A roster that fails validation used to report only that it failed, which
    // cannot tell a provider outage from our own bound being too small. The
    // reason is a predicate name and a row count - shape, never native content.
    const rowsReject = (value, label) => {
      if (!Array.isArray(value)) return label + '-absent';
      if (value.length > 20000) return label + '-over-cap-' + value.length;
      return value.every((row) => fullRow(row) || metadataRow(row)) ? null : label + '-row-shape';
    };
    const responseReject = (value, index) => {
      if (!value || typeof value !== 'object') return 'not-object';
      if (value.a !== true) return 'flag-a';
      if (!/^(?:0|[1-9]\d*)$/u.test(String(value.t)) || !Number.isSafeInteger(Number(value.t))) return 'field-t';
      if (!Object.prototype.hasOwnProperty.call(value, 'f')) return 'field-f';
      const today = rowsReject(value.today, 'today');
      if (today !== null) return today;
      if (index === 0 || value.data !== undefined) {
        const data = rowsReject(value.data, 'data');
        if (data !== null) return data;
      }
      return Object.keys(value).every((name) => ['a', 't', 'data', 'today', 'f'].includes(name))
        ? null : 'extra-key';
    };
    // "pending" counts every group not collected, which cannot tell a walk that
    // is behind from fixtures the plan never asked for. Name the gate instead.
    const RANK = { WAITING: 0, STARTED: 1, PASSIVE: 2, UNPLANNED: 3 };
    const ownerBlock = (owner) => {
      const scheduler = root.__fieldlineCollectionSchedulerV1;
      // A page can still hold a scheduler injected before this census existed.
      if (!scheduler || typeof scheduler.dueReason !== 'function') return 'WAITING';
      let worst = null;
      for (const id of owner.events) {
        const reason = scheduler.dueReason(id, owner.doneAt || null);
        if (reason === null) return null;
        if (worst === null || RANK[reason] < RANK[worst]) worst = reason;
      }
      return worst ?? 'WAITING';
    };
    const diagnostics = () => {
      const owners = [...state.owners.values()];
      const done = owners.filter((owner) => owner.doneAt > 0).length;
      const census = { due: 0, waiting: 0, started: 0, passive: 0, unplanned: 0 };
      for (const owner of owners) {
        if (ownerDue(owner)) { census.due += 1; continue; }
        const block = ownerBlock(owner);
        if (block === null) census.due += 1;
        else census[block.toLowerCase()] += 1;
      }
      const result = { status: state.rosterAtMs > 0 ? 'ready' : 'roster-pending', generation: state.generation,
        todayRows: state.todayRows, earlyRows: state.earlyRows, runningRows: state.runningRows,
        groups: owners.length, done, pending: owners.length - done,
        due: census.due, waiting: census.waiting, started: census.started,
        passive: census.passive, unplanned: census.unplanned,
        rebuilt: state.rebuilt, rebuiltCollected: state.rebuiltCollected,
        sharedEvents: state.sharedEvents, multiEventGroups: state.multiEventGroups,
        groupsOneMatch: state.groupsOneMatch, groupsSeveralMatches: state.groupsSeveralMatches,
        cornerRows: state.cornerRows, cornerSuffixOk: state.cornerSuffixOk,
        cornerLooseOk: state.cornerLooseOk, cornerOneSided: state.cornerOneSided,
        cornerNoParen: state.cornerNoParen, cornerShapes: state.cornerShapes,
        bookingRows: state.bookingRows, bookingSuffixOk: state.bookingSuffixOk,
        rowsNotSport: state.rowsNotSport, rowsLiveGroup: state.rowsLiveGroup,
        eventsDiscovered: state.eventsDiscovered,
        // A group reads as unplanned when the plan has not reached this page.
        // Without the plan's own size that is indistinguishable from a fixture
        // no other book carries.
        planEvents: (() => { const s = root.__fieldlineCollectionSchedulerV1;
          return s && typeof s.snapshot === 'function' ? s.snapshot().events : -1; })(),
        planRevision: (() => { const s = root.__fieldlineCollectionSchedulerV1;
          return s && typeof s.snapshot === 'function' ? s.snapshot().revision : -1; })(),
        partialGroups: owners.filter((owner) => owner.doneAt > 0 &&
          (owner.covered?.size ?? 0) < owner.events.size).length,
        // Whether asking the same group again ever moves the provider onto its
        // other event. If this stays 0 over many repeats, the uncovered events
        // have no More to fetch and re-asking would only spend request budget.
        groupsCoveredTwice: owners.filter((owner) => (owner.covered?.size ?? 0) > 1).length,
        // And whether anything uncovered is even wanted: an uncovered event no
        // other book carries is not a gap.
        partialWanted: owners.filter((owner) => {
          if (!(owner.doneAt > 0) || (owner.covered?.size ?? 0) >= owner.events.size) return false;
          const scheduler = root.__fieldlineCollectionSchedulerV1;
          if (!scheduler || typeof scheduler.dueReason !== 'function') return false;
          return [...owner.events].some((id) => !owner.covered?.has(id) &&
            scheduler.dueReason(id, null) !== 'UNPLANNED');
        }).length,
        failed: owners.filter((owner) => owner.failed).length, active: state.active.size,
        rosterActive: state.rosterActive, rosterFailed: state.rosterFailed, rosterAtMs: state.rosterAtMs,
        requestPaused: paused(), requestStatus: state.requestStatus,
        requestRetryInMs: Math.max(0, state.retryAtMs - Date.now()),
        rosterReject: state.rosterReject ?? null };
      root.dataset.fieldlineCmdNativeCoverage = JSON.stringify(result);
      return result;
    };
    const ownerDue = (owner) => {
      if (owner.failed && owner.nextAt > Date.now()) return false;
      const scheduler = root.__fieldlineCollectionSchedulerV1;
      return scheduler ? [...owner.events].some(id => scheduler.due(id, owner.doneAt || null))
        : owner.nextAt <= Date.now();
    };
    const enqueue = () => {
      state.queue = state.queue.filter(id => state.owners.has(id) && ownerDue(state.owners.get(id)));
      const queued = new Set(state.queue);
      for (const [id, owner] of state.owners) {
        if (ownerDue(owner) && !queued.has(id) && !state.active.has(id)) state.queue.push(id);
      }
      const scheduler = root.__fieldlineCollectionSchedulerV1;
      if (scheduler) {
        const ranked = scheduler.sort(state.queue.flatMap(id => [...state.owners.get(id).events]));
        const rank = new Map(ranked.map((id, index) => [id, index]));
        const priority = id => Math.min(...[...state.owners.get(id).events].map(event => rank.get(event) ?? Infinity));
        state.queue.sort((a, b) => priority(a) - priority(b));
      }
    };
    const pump = () => {
      if (!current() || paused()) return;
      enqueue();
      if (state.queue.length > 0 && state.active.size < 2 && Date.now() < state.nextMoreAt) {
        if (state.pumpTimer === null) state.pumpTimer = setTimeout(() => {
          state.pumpTimer = null; state.pump();
        }, state.nextMoreAt - Date.now());
        return;
      }
      while (current() && !paused() && Date.now() >= state.nextMoreAt && state.active.size < 2 && state.queue.length > 0) {
        const id = state.queue.shift();
        const owner = state.owners.get(id);
        if (!owner || !ownerDue(owner) || state.active.has(id)) continue;
        const job = { owner, generation, startedAtMs: Date.now() };
        state.active.set(id, job);
        const finish = (value) => {
          if (state.active.get(id) !== job) return;
          state.active.delete(id);
          state.nextMoreAt = Math.max(state.nextMoreAt, Date.now() + 500);
          if (current() && state.owners.get(id) === owner) {
            const valid = value && Array.isArray(value.d) && value.d.length === 4 && value.d[0] === id &&
              owner.events.has(String(value.d[1])) && Array.isArray(value.d[2]) && Array.isArray(value.d[3]);
            owner.failed = !valid;
            const scheduler = root.__fieldlineCollectionSchedulerV1;
            const refreshMs = scheduler ? Math.min(...[...owner.events].map(event =>
              scheduler.policy(event).refreshMs ?? Infinity)) : 45000;
            owner.nextAt = Date.now() + (valid ? refreshMs : 15000);
            if (valid) {
              requestSucceeded(job.startedAtMs);
              owner.doneAt = Date.now();
              // Which event the provider actually answered for.
              //
              // Every event in the group is marked collected below even though
              // the answer names one. That is deliberate and must stay: the
              // provider's own page has exactly one More call, LoadExtraBoxData,
              // and it sends m_groupId with no field naming an event or soc id -
              // LoadOtherBet reads both socId and listId off the button and uses
              // listId. There is no per-event request to make, and measured
              // groupsCoveredTwice stayed 0 across every repeat, so asking the
              // same group again never moves the provider onto its other event.
              //
              // Leaving those events uncollected would make the group due
              // forever and spend the request budget on an answer that cannot
              // change. partialWanted counts what is unreachable instead.
              (owner.covered ??= new Set()).add(String(value.d[1]));
              for (const event of owner.events) root.__fieldlineCollectionSchedulerV1?.completed(event, owner.doneAt);
              // Keep the latest bounded sports tuple for native/API coverage
              // comparison; it carries no request or account parameters.
              owner.nativeMore = { body: JSON.stringify(value), observedAtMs: owner.doneAt };
            }
          }
          // A retired callback releases its physical slot, then only the latest
          // maintenance generation may use that slot for another request.
          state.pump();
          diagnostics();
        };
        try {
          const body = JSON.stringify({ m_accType: globalThis.ISCACHEMODE ? 'MY+MR' : GetAccoutType(),
            c: globalThis.ISCACHEMODE ? 'A' : GetAccountCommission(), m_groupId: id,
            m_accId: GetAccountId(), isPar: globalThis.ISPARLAYBETVIEW });
          callWebService('/Member/BetsView/BetLight/DataOdds.asmx/GetAllOdds', body,
            (value) => finish(value), (xhr) => { pauseRequests(xhr); finish(null); }, false, 7500);
        } catch { pauseRequests(null); finish(null); }
      }
    };
    state.pump = pump;
    const commit = (cycle) => {
      if (state.cycle !== cycle || !current()) return;
      if (cycle.failed) { state.rosterFailed = true; state.nextRosterAt = Date.now() + 15000; return; }
      const live = cycle.values[0].data.filter(fullRow);
      const today = cycle.values[0].today.filter(fullRow);
      const early = cycle.values[1].today.filter(fullRow);
      const liveGroups = new Set(live.map((row) => row[34]));
      const discovered = new Map();
      // A group holding several events is either one match's several books or
      // several matches. One More response covers one event, so which of those
      // it is decides whether the rest are missing markets or have none to miss.
      // Fingerprints never leave this closure; only the counts do.
      const fixtures = new Map();
      // Which filter each roster row dies to. 52 paired fixtures inside 72 hours
      // carried no More while the walk reported nothing due, and "pending"
      // cannot say whether their group was never discovered or never asked.
      let notSport = 0, inLiveGroup = 0;
      for (const row of [...today, ...early]) {
        if (row[51] !== 'S') { notSport += 1; continue; }
        if (liveGroups.has(row[34])) { inLiveGroup += 1; continue; }
        let events = discovered.get(row[34]);
        if (!events) discovered.set(row[34], events = new Set());
        events.add(String(row[0]));
        let names = fixtures.get(row[34]);
        if (!names) fixtures.set(row[34], names = new Set());
        names.add(String(row[37]) + '|' + String(row[38]) + '|' + String(row[39]));
      }
      const owners = new Map();
      // A replaced owner loses doneAt while the scheduler keeps its receipt, so
      // the group reads as collected while carrying nothing. Count how often
      // that happens before deciding whether it explains the coverage gap.
      for (const [id, events] of discovered) {
        const prior = state.owners.get(id);
        const reusable = prior && prior.events.size === events.size &&
          [...events].every((event) => prior.events.has(event));
        if (prior && !reusable && prior.doneAt > 0) state.rebuiltCollected += 1;
        else if (prior && !reusable) state.rebuilt += 1;
        owners.set(id, reusable ? prior
          : { events, doneAt: 0, nextAt: 0, failed: false, covered: new Set() });
      }
      // A More response covers one event but marks every event in its group
      // collected, so two groups sharing an event starve each other: the second
      // is never due and never fetched. Count the sharing before deciding.
      const groupsPerEvent = new Map();
      for (const [id, events] of discovered) {
        for (const event of events) groupsPerEvent.set(event, (groupsPerEvent.get(event) ?? 0) + 1);
        void id;
      }
      state.sharedEvents = [...groupsPerEvent.values()].filter((count) => count > 1).length;
      state.multiEventGroups = [...discovered.values()].filter((events) => events.size > 1).length;
      let sameMatch = 0, severalMatches = 0;
      for (const [id, events] of discovered) {
        if (events.size <= 1) continue;
        if ((fixtures.get(id)?.size ?? 1) > 1) severalMatches += 1;
        else sameMatch += 1;
      }
      state.groupsOneMatch = sameMatch;
      state.groupsSeveralMatches = severalMatches;
      // The normalizer admits a "- CORNERS" league only when BOTH team names
      // carry an exact "(No. of Corners)" suffix, and drops the whole fixture
      // otherwise. Count the two separately: a league count far above the
      // suffix count means the suffix shape is the door, not the league.
      const cornerLeague = /\s-\sCORNERS\s*$/i;
      const bookingLeague = /\s-\sBOOKINGS\s*$/i;
      const cornerTeam = /\(\s*No\.?\s*of\s+Corners\s*\)\s*$/i;
      const bookingTeam = /\(\s*Total\s+Bookings\s*\)\s*$/i;
      // What shape the refused ones actually have, so the strict suffix can be
      // widened to exactly what the provider writes and nothing more.
      const cornerLoose = /\((?:No\.?\s*of\s+)?Corners?\)\s*$/i;
      const anyParen = /\([^)]*\)\s*$/;
      // A refused tail need not be parenthesised: the archived day-aggregate
      // rows end "- Tuesday - 6 Matches". Take the segment after the last dash.
      const tail = /-[^-]{1,38}$/;
      const shapeSafe = /^(?:\([\w\s.',\/&:-]{1,38}\)|-[\w\s.',\/&:-]{1,38})$/;
      let cornerRows = 0, cornerSuffix = 0, bookingRows = 0, bookingSuffix = 0;
      let cornerLooseOk = 0, cornerOneSided = 0, cornerNoParen = 0;
      const cornerShapes = new Set();
      for (const row of [...today, ...early]) {
        const league = String(row[37]);
        const teams = [String(row[38]), String(row[39])];
        if (cornerLeague.test(league)) {
          cornerRows += 1;
          if (teams.every((team) => cornerTeam.test(team))) cornerSuffix += 1;
          else {
            if (teams.every((team) => cornerLoose.test(team))) cornerLooseOk += 1;
            else if (teams.some((team) => cornerTeam.test(team))) cornerOneSided += 1;
            else if (!teams.some((team) => anyParen.test(team))) cornerNoParen += 1;
            // The parenthesised market suffix only, never the team it follows:
            // the same bounded public-label evidence the SABA walk already
            // reports, and the one thing that says what to widen the rule to.
            for (const team of teams) {
              if (cornerShapes.size >= 6) break;
              const match = anyParen.exec(team) ?? tail.exec(team);
              if (match === null) continue;
              const shape = match[0].trim().slice(0, 40);
              if (shapeSafe.test(shape)) cornerShapes.add(shape);
            }
          }
        } else if (bookingLeague.test(league)) {
          bookingRows += 1;
          if (teams.every((team) => bookingTeam.test(team))) bookingSuffix += 1;
        }
      }
      state.cornerRows = cornerRows; state.cornerSuffixOk = cornerSuffix;
      state.cornerLooseOk = cornerLooseOk; state.cornerOneSided = cornerOneSided;
      state.cornerNoParen = cornerNoParen;
      state.cornerShapes = [...cornerShapes];
      state.bookingRows = bookingRows; state.bookingSuffixOk = bookingSuffix;
      state.rowsNotSport = notSport;
      state.rowsLiveGroup = inLiveGroup;
      state.eventsDiscovered = groupsPerEvent.size;
      state.owners = owners;
      state.queue = state.queue.filter((id) => owners.has(id));
      state.todayRows = today.length; state.earlyRows = early.length; state.runningRows = live.length;
      state.rosterAtMs = Date.now(); state.rosterFailed = false; state.rosterReject = null;
      state.nextRosterAt = Date.now() + 30000;
      pump();
    };
    if (!paused() && state.rosterActive === 0 && Date.now() >= state.nextRosterAt) {
      const cycle = { values: [null, null], pending: 2, failed: false };
      state.cycle = cycle;
      state.rosterActive = 2;
      requests.forEach((body, index) => {
        const startedAtMs = Date.now();
        let finished = false;
        const finish = (value) => {
          if (finished) return;
          finished = true; state.rosterActive -= 1; cycle.pending -= 1;
          const reject = responseReject(value, index);
          if (reject === null) { cycle.values[index] = value; requestSucceeded(startedAtMs); }
          else { cycle.failed = true; state.rosterReject = 'r' + index + '-' + reject; }
          if (cycle.pending === 0) commit(cycle);
          diagnostics();
        };
        if (paused()) { finish(null); return; }
        try { callWebService(GetOddsUrl(), body, (value) => finish(value),
          (xhr) => { pauseRequests(xhr); finish(null); }, false, 7500); }
        catch { pauseRequests(null); finish(null); }
      });
    }
    pump();
    return diagnostics();
  })()`;
}
