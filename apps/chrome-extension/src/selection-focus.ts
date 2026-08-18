export interface SelectionFocusIdentity {
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
}

export function buildCmdSelectionFocusExpression(identity: SelectionFocusIdentity): string {
  const suffix = identity.providerSelectionId === `${identity.providerMarketId}:home` ? "home"
    : identity.providerSelectionId === `${identity.providerMarketId}:away` ? "away"
    : null;
  if (suffix === null) throw new Error("SELECTION_IDENTITY_MISMATCH");
  const input = JSON.stringify({ ...identity, selectionIndex: suffix === "home" ? 0 : 1 });
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
      const parts = input.providerMarketId.split(':');
      const rowId = parts[1] ?? '';
      if (rowId && rowId === input.providerEventId) {
        const rows = [...document.querySelectorAll('.match')]
          .filter((row) => row.id === 'R_' + rowId);
        if (rows.length === 1) {
          const odds = [...rows[0].querySelectorAll('.Dbox_b2 .odds')].slice(0, 2);
          if (odds.length === 2) target = odds[input.selectionIndex] ?? null;
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
