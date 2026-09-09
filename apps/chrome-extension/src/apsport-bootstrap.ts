/** Bootstrap reads page evidence only. It never guesses an API host or reads a credential. */
export const APSPORT_BOOTSTRAP_EXPRESSION = String.raw`(() => {
  try {
    const fieldlineApsportBootstrap = true;
    const fail = (reason) => ({ reason });
    const page = new URL(location.href);
    if (!fieldlineApsportBootstrap || page.protocol !== 'https:' || page.username || page.password ||
      !(page.hostname === 'agenate.com' || page.hostname.endsWith('.agenate.com') ||
        page.hostname === 'pacific.racern.com' || page.hostname === 'sport.asportsb.com')) {
      return fail('APSPORT_BOOTSTRAP_PAGE_UNSUPPORTED');
    }
    // SPA navigation can remove the launch query while the authenticated page
    // remains intact. Its explicit HTML language is current document evidence.
    const language = page.searchParams.get('lng') || document.documentElement?.lang || '';
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(language)) {
      return fail('APSPORT_BOOTSTRAP_LANGUAGE_MISSING');
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (timeZone.length > 128 || !/^[A-Za-z0-9_+.-]{1,64}(?:\/[A-Za-z0-9_+.-]{1,64})*$/u.test(timeZone)) {
      return fail('APSPORT_BOOTSTRAP_TIMEZONE_INVALID');
    }
    const apiHost = /^(?:spbui|spbtui)\.agenate\.com$/u;
    // A page already on the allowlisted API origin is direct origin evidence;
    // other pages still require a native API resource or explicit network hint.
    let origin = apiHost.test(page.hostname) ? page.origin : '';
    const resources = performance.getEntriesByType('resource')
      .map((entry) => typeof entry.name === 'string' ? entry.name : '');
    const hints = [...document.querySelectorAll('link[rel="dns-prefetch"],link[rel="preconnect"]')]
      .map((link) => typeof link.href === 'string' ? link.href : '');
    for (const [raw, resource] of [...resources.map((raw) => [raw, true]), ...hints.map((raw) => [raw, false])]) {
      if (origin !== '') break;
      try {
        const candidate = new URL(raw, page.origin);
        if (candidate.protocol !== 'https:' || candidate.username || candidate.password ||
          !apiHost.test(candidate.hostname) || candidate.port !== '') continue;
        if (resource && !candidate.pathname.startsWith('/be-ui/pac/api/v3/')) continue;
        origin = candidate.origin;
      } catch { /* Ignore malformed resource timing and link values. */ }
    }
    return origin === '' ? fail('APSPORT_BOOTSTRAP_ORIGIN_MISSING') : { origin, language, timeZone };
  } catch { return { reason: 'APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE' }; }
})()`;

const failurePriorities = {
  APSPORT_BOOTSTRAP_CONTEXT_UNAVAILABLE: 0,
  APSPORT_BOOTSTRAP_PAGE_UNSUPPORTED: 1,
  APSPORT_BOOTSTRAP_ORIGIN_MISSING: 2,
  APSPORT_BOOTSTRAP_LANGUAGE_MISSING: 3,
  APSPORT_BOOTSTRAP_TIMEZONE_INVALID: 4,
  APSPORT_BOOTSTRAP_DOCUMENT_CHANGED: 5
} as const;

export type ApsportBootstrapFailure = { readonly reason: keyof typeof failurePriorities };

/** Preserve the most relevant provider-frame failure instead of a shell-frame rejection. */
export function apsportBootstrapFailure(current: ApsportBootstrapFailure,
  value: unknown): ApsportBootstrapFailure {
  if (typeof value !== "object" || value === null || !("reason" in value) ||
    typeof value.reason !== "string" || !Object.hasOwn(failurePriorities, value.reason)) return current;
  const reason = value.reason as ApsportBootstrapFailure["reason"];
  return failurePriorities[reason] >= failurePriorities[current.reason] ? { reason } : current;
}
