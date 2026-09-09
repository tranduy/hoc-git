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
          if (gate.hardBlocked) return empty('collector-paused', gate.lastFailure, null, gate);
          if (now < Math.max(gate.armedAtMs, gate.nextAtMs)) return empty('rate-limited', gate.lastFailure, 'COOLDOWN', gate);
          // Persist before signing or fetching. A crash consumes this admission.
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
            // Counting local rounds does not change any deadline. It is the
            // record that tells a run of unanswered requests apart from one
            // slow round when the diagnostic is read later.
            if (!gate.hardBlocked || hard) gate.lastFailure = { status: failure.status,
              nativeStatusCode: failure.nativeStatusCode, errorCategory: failure.errorCategory,
              observedAtMs: failure.observedAtMs,
              failureStage: ['SIGNATURE', 'NETWORK', 'BODY_READ'].includes(failure.failureStage) ? failure.failureStage : null,
              elapsedMs: Number.isSafeInteger(failure.elapsedMs) ? failure.elapsedMs : null,
              headAtMs: Number.isSafeInteger(failure.headAtMs) ? failure.headAtMs : null };
            gate.hardBlocked = gate.hardBlocked || hard;
            // Local inability to obtain a response is not provider refusal.
            // Unknown failures retain the conservative provider breaker.
            gate.nextAtMs = Math.max(gate.nextAtMs, Date.now() + (!local && gate.providerFailures >= 3 ? 900_000 : 30_000),
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
            return empty(gate.hardBlocked ? 'collector-paused' : 'rate-limited', gate.lastFailure, null, gate);
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
