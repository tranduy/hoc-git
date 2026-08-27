/**
 * Selecting a lobby's time tab by its label rather than its markup.
 *
 * NOT WIRED UP, and it must not be until a caller scopes it to the football
 * section first. A lobby carries the same labels in more than one place: SABA's
 * Asian Games section has its own "som | hom nay | truc tiep" strip, and this
 * expression - matching on label alone - clicked that one and left the page on
 * a section with no fixtures in it. A page showing nothing subscribes to
 * nothing, so its socket then carried no football at all and the book went
 * dark. KSPORT's selector finds its football group before it looks for a tab,
 * which is the part this is missing.
 *
 * KSPORT's selector is written against that site's own class names, which do
 * not exist anywhere else. SABA and APSPORT publish only what their page is
 * showing, so a book left on "live" never reports the fixtures that have not
 * kicked off - measured 2026-08-27: SABA carried 39 running fixtures and 3
 * upcoming, while BTI carried the same day's list a median of twelve hours
 * ahead. Those upcoming fixtures are almost all of what the other books can be
 * compared against.
 *
 * The expression reports the labels it considered whether or not it found one,
 * so a page that names its tabs differently says so instead of failing silently.
 * It reads text and clicks one control; it never submits anything.
 */
export function timeTabExpression(labels: readonly string[], force = false): string {
  return `(() => {
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D')
      .trim().toLowerCase().replace(/\\s+/g, ' ');
    const wanted = ${JSON.stringify(labels)};
    const nodes = [...document.querySelectorAll(
      'a, button, li, [role="tab"], [class*="tab"], [class*="menu"] > *')];
    const seen = [];
    let match = null;
    for (const node of nodes) {
      if (node.children.length > 2) continue;
      const text = normalize(node.textContent);
      if (text.length === 0 || text.length > 24) continue;
      if (seen.length < 24 && !seen.includes(text)) seen.push(text);
      if (match === null && wanted.includes(text)) match = node;
    }
    if (match === null) return { status: 'time-tab-not-found', labels: seen, nodes: nodes.length };
    const active = /(?:^|\\s)(?:active|selected|current)(?:\\s|$)/u
      .test(String(match.className || '')) || match.getAttribute('aria-selected') === 'true';
    if (active && !${JSON.stringify(force)}) return { status: 'time-tab-active', labels: seen };
    match.click();
    return { status: active ? 'time-tab-reselected' : 'time-tab-selected', labels: seen };
  })()`;
}

export const TODAY_TAB_LABELS = ["hom nay", "today"] as const;
export const LIVE_TAB_LABELS = ["truc tiep", "live", "dang da", "in play", "in-play"] as const;
