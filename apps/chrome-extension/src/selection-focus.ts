export interface SelectionFocusIdentity {
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
}

export function buildCmdSelectionFocusExpression(identity: SelectionFocusIdentity): string {
  const selectionIndex = identity.providerSelectionId === `${identity.providerMarketId}:home`
      || identity.providerSelectionId === `${identity.providerMarketId}:over` ? 0
    : identity.providerSelectionId === `${identity.providerMarketId}:away`
      || identity.providerSelectionId === `${identity.providerMarketId}:under` ? 1
    : null;
  if (selectionIndex === null) throw new Error("SELECTION_IDENTITY_MISMATCH");
  const input = JSON.stringify({ ...identity, selectionIndex });
  return `(() => {
    const input = ${input};
    let target = null;
    const modernRows = [...document.querySelectorAll('.c-match[data-matchid]')]
      .filter((row) => row.getAttribute('data-matchid') === input.providerEventId);
    if (modernRows.length === 1) {
      const odds = [...modernRows[0].querySelectorAll('.c-odds[data-moid]')]
        .filter((node) => node.getAttribute('data-moid') === input.providerMarketId);
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
          if (rows[index].classList.contains('default-match')) {
            baseRow = rows[index];
            break;
          }
        }
        if (rowIndex >= 0 && baseRow?.id === 'R_' + input.providerEventId) {
          let firstHalfStarted = false;
          const candidates = [];
          for (const container of rowMatches[0].querySelectorAll('.Dbox_b2, .Dbox_b3, .Dbox_b5')) {
            const odds = [...container.querySelectorAll('.odds')].slice(0, 2);
            if (odds.length !== 2) continue;
            let containerBetType = null;
            if (container.classList.contains('Dbox_b5')) {
              firstHalfStarted = true;
              containerBetType = '7';
            } else if (container.classList.contains('Dbox_b2')) containerBetType = '1';
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
    if (!target) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    const previousOutline = target.style.outline;
    const previousBackground = target.style.backgroundColor;
    target.style.outline = '4px solid #35e886';
    target.style.backgroundColor = '#173f2b';
    setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.backgroundColor = previousBackground;
    }, 8000);
    return { ok: true };
  })()`;
}

export function buildGenericSelectionFocusExpression(identity: SelectionFocusIdentity): string {
  const input = JSON.stringify(identity);
  return `(() => {
    const input = ${input};
    const exactAttribute = (node, value) => node.id === value ||
      [...node.attributes].some((attribute) => attribute.value === value);
    const candidates = [...document.querySelectorAll('*')]
      .filter((node) => exactAttribute(node, input.providerSelectionId));
    if (candidates.length !== 1) return { ok: false, reason: 'EXACT_SELECTION_NOT_FOUND' };
    const target = candidates[0];
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    const previousOutline = target.style.outline;
    const previousBackground = target.style.backgroundColor;
    target.style.outline = '4px solid #35e886';
    target.style.backgroundColor = '#173f2b';
    setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.backgroundColor = previousBackground;
    }, 8000);
    return { ok: true };
  })()`;
}
