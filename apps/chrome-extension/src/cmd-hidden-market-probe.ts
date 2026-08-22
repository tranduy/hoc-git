export interface CmdHiddenDomProbeResult {
  readonly found: boolean;
  readonly beforeMarketIds: readonly string[];
  readonly afterMarketIds: readonly string[];
  readonly clickedControls: readonly string[];
  readonly candidateControls: readonly string[];
  readonly marketStructures: readonly string[];
  readonly visibleEventIds: readonly string[];
  readonly stablePasses: number;
}

export interface CmdHiddenProtocolEvidence {
  readonly direction: "SENT" | "RECEIVED";
  readonly byteLength: number;
  readonly eventIdReferenced: boolean;
  readonly jsonKeys: readonly string[];
  readonly channelPaths: readonly string[];
}

const secretKeyPattern = /(?:auth|authorization|bearer|cookie|credential|jwt|password|secret|session|signature|token)/iu;
const pathTokenPattern = /\/(?:event|events|match|matches|market|markets|topic|sports)(?:\/[a-z0-9_.:-]+){1,8}/giu;

export function summarizeCmdHiddenProtocolFrame(payload: string, providerEventId: string,
  direction: CmdHiddenProtocolEvidence["direction"]): CmdHiddenProtocolEvidence {
  const keys = new Set<string>();
  const paths = new Set<string>();
  const visit = (value: unknown, key: string | null = null): void => {
    if (key !== null) {
      if (secretKeyPattern.test(key)) return;
      keys.add(key);
    }
    if (typeof value === "string") {
      for (const path of value.match(pathTokenPattern) ?? []) paths.add(path);
    } else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (typeof value === "object" && value !== null) {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  try { visit(JSON.parse(payload) as unknown); }
  catch { for (const path of payload.match(pathTokenPattern) ?? []) paths.add(path); }
  return { direction, byteLength: new TextEncoder().encode(payload).byteLength,
    eventIdReferenced: payload.includes(providerEventId), jsonKeys: [...keys].sort(), channelPaths: [...paths].sort() };
}

export function buildCmdHiddenMarketProbeExpression(providerEventId: string): string {
  const input = JSON.stringify({ providerEventId });
  return `(async () => {
    const input = ${input};
    const clean = (value, max = 120) => String(value ?? '').replace(/\\s+/gu, ' ').trim().slice(0, max);
    const normalize = (value) => clean(value).normalize('NFD').replace(/[\\u0300-\\u036f]/gu, '').toLowerCase();
    const exactOwner = () => {
      const matches = [...document.querySelectorAll('.c-match[data-matchid], .match[id]')]
        .filter((node) => node.getAttribute('data-matchid') === input.providerEventId || node.id === 'R_' + input.providerEventId);
      const score = (node) => (node.getClientRects().length > 0 ? 100000 : 0) +
        node.querySelectorAll('.c-odds[data-moid], .odds').length * 100 +
        node.querySelectorAll('.c-team-name, .team').length * 10 +
        node.querySelectorAll("button, a, [role='button'], [onclick]").length;
      return matches.sort((left, right) => score(right) - score(left))[0] || null;
    };
    const visibleEventIds = [...new Set([...document.querySelectorAll('.c-match[data-matchid], .match[id]')]
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => clean(node.getAttribute('data-matchid') || node.id.replace(/^R_/u, ''), 128)).filter(Boolean))];
    let owner = exactOwner();
    if (!owner) return { found: false, beforeMarketIds: [], afterMarketIds: [], clickedControls: [], candidateControls: [], marketStructures: [], visibleEventIds, stablePasses: 0 };
    const marketIds = () => {
      owner = exactOwner() || owner;
      const modern = [...owner.querySelectorAll('.c-odds[data-moid]')]
        .map((node) => clean(node.getAttribute('data-moid'), 128)).filter(Boolean);
      const legacy = [...owner.querySelectorAll('.odds')]
        .map((_node, index) => 'legacy-dom:' + input.providerEventId + ':' + index);
      return [...new Set([...modern, ...legacy])].sort();
    };
    const beforeMarketIds = marketIds();
    const marketStructures = [...new Set([...owner.querySelectorAll('.c-odds[data-moid], .odds')]
      .map((odds) => odds.closest('[data-bt], [class*="Dbox_"], .c-match__odds-group') || odds.parentElement)
      .filter(Boolean))].slice(0, 100).map((container) => {
        const clone = container.cloneNode(true);
        clone.querySelectorAll('.c-odds, .odds').forEach((node) => node.remove());
        const classes = [...container.classList].slice(0, 6).join('.');
        const identity = container.tagName.toLowerCase() + (classes ? '.' + classes : '');
        const betType = clean(container.getAttribute('data-bt') || '-', 32);
        const visible = container.getClientRects().length > 0 ? '1' : '0';
        const label = clean(clone.textContent, 80) || '-';
        const oddsCount = container.querySelectorAll('.c-odds[data-moid], .odds').length;
        return clean(identity + ' bt=' + betType + ' visible=' + visible + ' label=' + label + ' odds=' + oddsCount, 240);
      });
    const unsafeSelector = '.c-odds, [data-moid], [class*=selection], [class*=ticket], [class*=slip], [class*=betslip], [class*=stake], form';
    const safe = (control) => control && control.getClientRects().length > 0 && !control.hasAttribute('disabled') &&
      !control.matches(unsafeSelector) && !control.closest(unsafeSelector) && !control.querySelector('.c-odds, [data-moid]') &&
      !/(?:odd|price|selection|ticket|slip|stake)/u.test(normalize(control.className));
    const describe = (control) => clean(control.getAttribute('aria-label') || control.getAttribute('title') ||
      control.textContent || control.className, 120);
    const clickedControls = [];
    const nodes = [...owner.querySelectorAll("button, a, summary, [role='button'], [onclick], .c-team-name, .c-match__team, .c-match__info, .team")];
    const safeCandidates = [...new Set(nodes.map((node) => node.closest("button, a, summary, [role='button'], [onclick]") || node))]
      .filter(safe);
    const candidateControls = safeCandidates.slice(0, 24).map((control) => clean(
      control.tagName.toLowerCase() + '.' + [...control.classList].slice(0, 6).join('.') + ' ' + describe(control), 120));
    const openCandidates = safeCandidates.map((control) => {
        const evidence = normalize(control.className + ' ' + control.getAttribute('aria-label') + ' ' +
          control.getAttribute('title') + ' ' + control.textContent);
        const score = /(?:detail|view|more|expand|market|chi tiet|xem tran|keo)/u.test(evidence) ? 100 :
          /(?:match-info|team|event)/u.test(evidence) ? 50 : 0;
        return { control, score };
      }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score);
    if (openCandidates[0]) {
      const control = openCandidates[0].control;
      control.dataset.fieldlineCmdHiddenProbeClicked = '1';
      clickedControls.push(describe(control));
      control.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    let prior = marketIds();
    let stablePasses = 0;
    for (let pass = 0; pass < 8 && stablePasses < 2; pass += 1) {
      owner = exactOwner() || owner;
      const controls = [...owner.querySelectorAll("button, a, summary, [role='button'], [onclick]")]
        .filter((control) => {
          const label = normalize(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
          const evidence = normalize(control.className + ' ' + label);
          return safe(control) && control.dataset.fieldlineCmdHiddenProbeClicked !== '1' &&
            (/^(?:\\+\\s*\\d+|show more|more markets?|all markets?|xem them|them keo)$/u.test(label) ||
              /(?:show-more|market.*(?:more|expand)|(?:more|expand).*market)/u.test(evidence));
        }).slice(0, 8);
      for (const control of controls) {
        control.dataset.fieldlineCmdHiddenProbeClicked = '1';
        clickedControls.push(describe(control));
        control.click();
      }
      if (controls.length > 0) await new Promise((resolve) => setTimeout(resolve, 150));
      const current = marketIds();
      const changed = JSON.stringify(current) !== JSON.stringify(prior);
      stablePasses = controls.length === 0 && !changed ? stablePasses + 1 : 0;
      prior = current;
    }
    return { found: true, beforeMarketIds, afterMarketIds: marketIds(), clickedControls, candidateControls, marketStructures, visibleEventIds, stablePasses };
  })()`;
}
