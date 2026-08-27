/**
 * What the APSPORT capture actually sees, gate by gate.
 *
 * The capture expression opens with `if (footballRoots.length !== 1) return []`
 * and every later step fails the same way: an empty catalog, no reason given.
 * Measured 2026-08-27: the page's own menu counted 554 football fixtures while
 * the catalog held one, and nothing in the pipeline could say whether the root
 * was missing, duplicated, hidden, still loading, or found with no rows under it.
 *
 * This reports counts and class names only - never a team, a price or a URL.
 */
export const TSPORT_CATALOG_SHAPE_EXPRESSION = `(() => {
  const count = (selector) => {
    try { return document.querySelectorAll(selector).length; } catch { return -1; }
  };
  const roots = [...document.querySelectorAll(
    '[data-sport-id="1"], [data-sportid="1"],' +
    '[data-football-event-list="true"][data-loaded="true"],' +
    '[data-role="football-event-list"][data-loaded="true"],' +
    '.football-match-list[data-loaded="true"],' +
    '.match-list[data-sport-id="1"][data-loaded="true"],' +
    '.match-list[data-sportid="1"][data-loaded="true"]')];
  const hidden = roots.filter((root) => {
    try {
      const style = getComputedStyle(root);
      return style.display === 'none' || style.visibility === 'hidden';
    } catch { return true; }
  }).length;
  // The class of whatever holds the most .match rows, so a renamed container is
  // named rather than guessed at. Shape only: no text is read from it.
  const rows = [...document.querySelectorAll('.match')];
  const parents = new Map();
  for (const row of rows) {
    const parent = row.parentElement;
    if (parent === null) continue;
    parents.set(parent, (parents.get(parent) || 0) + 1);
  }
  let bestParent = null;
  let bestCount = 0;
  for (const [parent, total] of parents) {
    if (total > bestCount) { bestParent = parent; bestCount = total; }
  }
  const describe = (element) => {
    if (element === null) return '';
    const classes = String(element.className || '').split(/\\s+/u)
      .filter((value) => value.length > 0 && value.length < 32).slice(0, 4).join('.');
    return (element.tagName || '').toLowerCase() + (classes.length > 0 ? '.' + classes : '');
  };
  return JSON.stringify({
    roots: roots.length,
    rootsHidden: hidden,
    rootLoaded: roots.length === 1 ? String(roots[0].getAttribute('data-loaded')) : '',
    rootBusy: roots.length === 1 ? String(roots[0].getAttribute('aria-busy')) : '',
    matchRows: rows.length,
    rowsUnderRoot: roots.length === 1 ? roots[0].querySelectorAll('.match').length : 0,
    biggestRowHost: describe(bestParent),
    biggestRowCount: bestCount,
    sportId1: count('[data-sport-id="1"]'),
    sportid1: count('[data-sportid="1"]'),
    matchList: count('.match-list'),
    footballList: count('.football-match-list'),
    teamNames: count('.match__team-name'),
    oddPairs: count('.match-odd-pair-list')
  });
})()`;
