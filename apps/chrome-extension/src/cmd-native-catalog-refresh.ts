/** Count-only diagnostics from our collector; never copy native text or identities. */
export function formatCmdNativeCatalogDiagnostic(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "CMD_NATIVE[unavailable]";
  const status = value as Record<string, unknown>;
  const fields: string[] = [];
  if (["frame-unavailable", "scope-unavailable", "ready", "roster-pending"].includes(String(status.status))) {
    fields.push(`status:${status.status}`);
  }
  for (const name of ["todayRows", "earlyRows", "runningRows", "groups", "done", "pending", "failed",
    "active", "rosterActive", "requestStatus", "requestRetryInMs"]) {
    const count = status[name];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) fields.push(`${name}:${count}`);
  }
  for (const name of ["rosterFailed", "requestPaused"]) {
    if (typeof status[name] === "boolean") fields.push(`${name}:${status[name] ? 1 : 0}`);
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
      todayRows: 0, earlyRows: 0, runningRows: 0, rosterAtMs: 0, rosterFailed: false };
    // Keep backpressure in the document across worker/source-epoch changes.
    state.retryAtMs ??= 0; state.failureAtMs ??= -1; state.requestFailures ??= 0;
    state.requestStatus ??= 0; state.nextMoreAt ??= 0; state.pumpTimer ??= null;
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
    const rows = (value) => Array.isArray(value) && value.length <= 20000 &&
      value.every((row) => fullRow(row) || metadataRow(row));
    const fullResponse = (value, index) => value && typeof value === 'object' && value.a === true &&
      /^(?:0|[1-9]\d*)$/u.test(String(value.t)) && Number.isSafeInteger(Number(value.t)) &&
      Object.prototype.hasOwnProperty.call(value, 'f') && rows(value.today) &&
      (index === 0 ? rows(value.data) : value.data === undefined || rows(value.data)) &&
      Object.keys(value).every((name) => ['a', 't', 'data', 'today', 'f'].includes(name));
    const diagnostics = () => {
      const owners = [...state.owners.values()];
      const done = owners.filter((owner) => owner.doneAt > 0).length;
      const result = { status: state.rosterAtMs > 0 ? 'ready' : 'roster-pending', generation: state.generation,
        todayRows: state.todayRows, earlyRows: state.earlyRows, runningRows: state.runningRows,
        groups: owners.length, done, pending: owners.length - done,
        failed: owners.filter((owner) => owner.failed).length, active: state.active.size,
        rosterActive: state.rosterActive, rosterFailed: state.rosterFailed, rosterAtMs: state.rosterAtMs,
        requestPaused: paused(), requestStatus: state.requestStatus,
        requestRetryInMs: Math.max(0, state.retryAtMs - Date.now()) };
      root.dataset.fieldlineCmdNativeCoverage = JSON.stringify(result);
      return result;
    };
    const enqueue = () => {
      const queued = new Set(state.queue);
      for (const [id, owner] of state.owners) {
        if (owner.nextAt <= Date.now() && !queued.has(id) && !state.active.has(id)) state.queue.push(id);
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
        if (!owner || owner.nextAt > Date.now() || state.active.has(id)) continue;
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
            owner.nextAt = Date.now() + (valid ? 45000 : 15000);
            if (valid) {
              requestSucceeded(job.startedAtMs);
              owner.doneAt = Date.now();
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
      for (const row of [...today, ...early]) {
        if (row[51] !== 'S' || liveGroups.has(row[34])) continue;
        let events = discovered.get(row[34]);
        if (!events) discovered.set(row[34], events = new Set());
        events.add(String(row[0]));
      }
      const owners = new Map();
      for (const [id, events] of discovered) {
        const prior = state.owners.get(id);
        owners.set(id, prior && prior.events.size === events.size && [...events].every((event) => prior.events.has(event))
          ? prior : { events, doneAt: 0, nextAt: 0, failed: false });
      }
      state.owners = owners;
      state.queue = state.queue.filter((id) => owners.has(id));
      state.todayRows = today.length; state.earlyRows = early.length; state.runningRows = live.length;
      state.rosterAtMs = Date.now(); state.rosterFailed = false; state.nextRosterAt = Date.now() + 30000;
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
          if (fullResponse(value, index)) { cycle.values[index] = value; requestSucceeded(startedAtMs); }
          else cycle.failed = true;
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
