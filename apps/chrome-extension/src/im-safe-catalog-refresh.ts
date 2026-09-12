import { buildImCatalogRefreshExpression } from "./im-catalog-refresh.js";

/** Origin-wide admission survives document, extension and bridge generations. */
export function buildImSafeCatalogRefreshExpression(generation: string): string {
  const roster = buildImCatalogRefreshExpression(`safe:${generation}`, { allowDetails: false });
  return `(async () => {
    const gateDiagnostic = gate => ({
      diagnosticAtMs: Date.now(),
      retryInMs: gate ? Math.max(0, Math.max(gate.armedAtMs, gate.nextAtMs) - Date.now()) : null,
      failureCount: gate?.failures ?? null,
      lastFailureAtMs: Number.isSafeInteger(gate?.lastFailure?.observedAtMs) ? gate.lastFailure.observedAtMs : null,
      failureStage: ['SIGNATURE', 'NETWORK', 'BODY_READ'].includes(gate?.lastFailure?.failureStage)
        ? gate.lastFailure.failureStage : null,
      localFailureCount: gate?.localFailures ?? null,
      elapsedMs: Number.isSafeInteger(gate?.lastFailure?.elapsedMs) ? gate.lastFailure.elapsedMs : null,
      headAtMs: Number.isSafeInteger(gate?.lastFailure?.headAtMs) ? gate.lastFailure.headAtMs : null });
    // The pipeline's status vocabulary already carries native-status-<code>,
    // and nothing was ever emitting it: a refused round reported the generic
    // 'rate-limited', so the provider's own code never left the page. Measured
    // 2026-09-12, IM spent two hours refused with the code invisible, which is
    // the difference between a query over budget and a dead session.
    const nativeStatus = failure => {
      const code = failure?.nativeStatusCode;
      return Number.isSafeInteger(code) && code !== 100 && code >= 0 && code <= 999999
        ? 'native-status-' + code : null;
    };
    const empty = (status = 'collector-paused', lastFailure = null, gateReason = null, gate = null) => ({ status, responses: [],
      coverage: { lastFailure, gateReason, ...gateDiagnostic(gate) } });
    if (location.hostname !== 'imsports.directsb.net') return empty();
    try {
      if (!navigator.locks?.request || window.__fieldlineImSafeStorageFailed) return empty();
      return await navigator.locks.request('fieldline-im-safe-catalog-v1', { ifAvailable: true }, async lock => {
        if (!lock) return empty('rate-limited', null, 'LOCK_HELD');
        const storage = window.localStorage;
        const key = '__fieldlineImSafeCatalogGateV1';
        const save = gate => {
          const value = JSON.stringify(gate);
          storage.setItem(key, value);
          if (storage.getItem(key) !== value) throw new Error('storage-unavailable');
        };
        try {
          if (storage.getItem('__fieldlineImCollectorPaused') === '1') return empty();
          const prior = window.__fieldlineImNativeCatalogV1?.state;
          if (prior && prior.allowDetails !== false) {
            prior.retired = true;
            for (const controller of prior.controllers) controller.abort();
            for (const release of prior.waiters) release();
            if (prior.controllers.size > 0) return empty();
            window.__fieldlineImNativeCatalogV1.state = null;
          }
          const now = Date.now();
          const raw = storage.getItem(key);
          if (raw === null) {
            const gate = { version: 1, armedAtMs: now + 30_000, nextAtMs: now + 30_000,
              failures: 0, providerFailures: 0, localFailures: 0, hardBlocked: false, lastFailure: null };
            save(gate);
            return empty('collector-paused', null, null, gate);
          }
          const gate = JSON.parse(raw);
          if (gate?.version !== 1 || !Number.isFinite(gate.armedAtMs) || !Number.isFinite(gate.nextAtMs) ||
            !Number.isSafeInteger(gate.failures) || gate.failures < 0 || typeof gate.hardBlocked !== 'boolean') return empty();
          // A legacy lastFailure cannot disprove an earlier HTTP refusal or
          // Retry-After. Keep its existing deadline and count conservatively.
          if (gate.providerFailures === undefined) gate.providerFailures = gate.failures;
          if (!Number.isSafeInteger(gate.providerFailures) || gate.providerFailures < 0 ||
            gate.providerFailures > gate.failures) return empty();
          // A legacy gate carries no local-failure history. Treating the unknown
          // remainder as local keeps the escalating deadline conservative rather
          // than restarting a run of unanswered requests at the shortest wait.
          if (gate.localFailures === undefined) gate.localFailures = gate.failures - gate.providerFailures;
          if (!Number.isSafeInteger(gate.localFailures) || gate.localFailures < 0 ||
            gate.localFailures > gate.failures) return empty();
          // The escalating wait below exists to stop a dead lane retrying
          // forever (548 unanswered requests over 11.7 hours, measured
          // 2026-09-10) and it must survive a reload, or a page refresh would
          // restart that run at full rate. But it reached fifteen minutes and
          // lives in the provider origin's localStorage, so on 2026-09-12 a
          // reopened IM tab - the one remedy for a lane that answers nothing -
          // sat idle under an escalation earned by the lane it replaced.
          // A new document therefore does not clear the run, it only caps what
          // is left of the wait: a lane that is still dead re-escalates on its
          // very next round, at the cost of one request per document.
          window.__fieldlineImDocumentIdV1 = window.__fieldlineImDocumentIdV1 ||
            (Date.now() + ':' + Math.random().toString(36).slice(2, 10));
          if (gate.documentId !== window.__fieldlineImDocumentIdV1) {
            gate.documentId = window.__fieldlineImDocumentIdV1;
            if (gate.localFailures > 0 && !gate.hardBlocked) {
              gate.nextAtMs = Math.min(gate.nextAtMs, now + 60_000);
            }
            save(gate);
          }
          if (gate.hardBlocked) return empty('collector-paused', gate.lastFailure, null, gate);
          if (now < Math.max(gate.armedAtMs, gate.nextAtMs)) {
            return empty(nativeStatus(gate.lastFailure) || 'rate-limited', gate.lastFailure, 'COOLDOWN', gate);
          }
          // Persist before signing or fetching. A crash consumes this admission.
          // This spacing is the whole book's update rhythm: the provider sends
          // no delta, so nothing refreshes between admissions. Halving it to ten
          // seconds was tried on 2026-09-10 and measured again over a clean
          // window: p50 moved 15.6s to 15.3s and p95 stayed outside the
          // thirty-second contract, so it bought nothing, while doubling this
          // book's request rate against a shared response-body capture that
          // later began losing bodies on every book. The rate stays where the
          // evidence puts it; the contract is missed for reasons upstream of
          // this number.
          gate.nextAtMs = now + 20_000;
          save(gate);
          let roundFailed = false;
          let providerRoundFailed = false;
          let localRoundFailed = false;
          const fieldlineImSafeRecordFailure = failure => {
            if (!roundFailed) { gate.failures++; roundFailed = true; }
            const hard = failure.nativeStatusCode === 501 || failure.status === 401 || failure.status === 403;
            const local = (failure.status === null || failure.status === 200) &&
              (failure.nativeStatusCode === null || failure.nativeStatusCode === 100) &&
              ['SIGNATURE', 'NETWORK', 'BODY_READ'].includes(failure.failureStage) &&
              (failure.errorCategory === failure.failureStage || failure.errorCategory === 'REQUEST_TIMEOUT') &&
              !(Number.isFinite(failure.retryAfterMs) && failure.retryAfterMs > 0);
            if (!local && !providerRoundFailed) { gate.providerFailures++; providerRoundFailed = true; }
            if (local && !localRoundFailed) { gate.localFailures++; localRoundFailed = true; }
            if (!gate.hardBlocked || hard) gate.lastFailure = { status: failure.status,
              nativeStatusCode: failure.nativeStatusCode, errorCategory: failure.errorCategory,
              observedAtMs: failure.observedAtMs,
              failureStage: ['SIGNATURE', 'NETWORK', 'BODY_READ'].includes(failure.failureStage) ? failure.failureStage : null,
              elapsedMs: Number.isSafeInteger(failure.elapsedMs) ? failure.elapsedMs : null,
              headAtMs: Number.isSafeInteger(failure.headAtMs) ? failure.headAtMs : null };
            gate.hardBlocked = gate.hardBlocked || hard;
            // Local inability to obtain a response is not provider refusal, and
            // the first rounds stay prompt so an ordinary blip recovers fast.
            // A long run is different: measured 2026-09-10, this lane spent
            // 11.7 hours making 548 requests that never received a response
            // head at all (elapsedMs 15008, headAtMs null, every one of them),
            // because a flat wait retries a dead lane forever at full rate.
            // Escalating after the third keeps the prompt retries and stops the
            // run from sustaining itself. It still never sets the provider
            // breaker: an unanswered request is not a refusal we can read.
            const localWaitMs = Math.min(900_000, 30_000 * 2 ** Math.max(0, gate.localFailures - 3));
            gate.nextAtMs = Math.max(gate.nextAtMs,
              Date.now() + (!local && gate.providerFailures >= 3 ? 900_000 : local ? localWaitMs : 30_000),
              Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs : 0);
            try { save(gate); } catch (error) { window.__fieldlineImSafeStorageFailed = true; throw error; }
          };
          const result = await ${roster};
          const state = window.__fieldlineImNativeCatalogV1?.state;
          const failures = state?.safeFailures || [];
          const hard = failures.find(failure => failure.nativeStatusCode === 501 || failure.status === 401 || failure.status === 403);
          const failure = hard || failures[0] || null;
          if (failure || gate.hardBlocked || result.status === 'request-failed' || result.status === 'retired') {
            if (!roundFailed) fieldlineImSafeRecordFailure(failure || { status: null, nativeStatusCode: null,
              errorCategory: 'REQUEST_FAILED', observedAtMs: Date.now() });
            return empty(gate.hardBlocked ? 'collector-paused'
              : nativeStatus(failure) || 'rate-limited', gate.lastFailure, null, gate);
          }
          if (result.status === 'catalog-requested' && result.responses?.length === 2) {
            gate.failures = 0;
            gate.providerFailures = 0;
            gate.localFailures = 0;
            gate.lastFailure = null;
          }
          save(gate);
          return { ...result, coverage: { ...result.coverage, ...gateDiagnostic(gate) } };
        } catch {
          window.__fieldlineImSafeStorageFailed = true;
          return empty();
        }
      });
    } catch { return empty(); }
  })()`;
}
