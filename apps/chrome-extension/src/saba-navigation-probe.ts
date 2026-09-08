const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_PROBE_MS = 60_000;
const SETTLE_POLL_MS = 100;
const MIN_STABLE_MS = 500;
const MAX_SETTLE_MS = 5_000;
const MAX_PERIOD_SETTLE_MS = 15_000;
const MAX_FAILURE_TRACE_ENTRIES = 16;
const MAX_FAILURE_TRACE_BYTES = 8 * 1024;

export type SabaProbeEvaluationFailure = "FRAME_COMMAND_TIMEOUT" | "CONTEXT_UNAVAILABLE" |
  "CDP_REJECTED" | "EXCEPTION_DETAILS" | "PAGE_NULL" | "STALE" | "DEADLINE";

type SabaMoreReadGuard = "DOCUMENT_TOKEN_CHANGED" | "OWNER_ABSENT" | "CONTROL_ABSENT";

interface SabaMoreReadUnavailable {
  unavailable: SabaMoreReadGuard;
}

interface SabaProbeFailureTrace {
  stage: string;
  ownerMatchId?: string;
  outcome: "LAST_READ_ABSENT" | "FINGERPRINT_UNSTABLE" | "STABILITY_WINDOW_EXHAUSTED" |
    "ACTION_UNCONFIRMED";
  reads?: number;
  elapsedMs?: number;
  evaluationFailure?: SabaProbeEvaluationFailure;
  evaluationTarget?: { kind: "ROOT" | "MAIN_WORLD" | "ISOLATED_WORLD";
    contextIdPresent: boolean; sessionIdPresent: boolean };
  guard?: SabaMoreReadGuard;
  before?: { relatedRowCount: number; marketIdCount: number };
  last?: { relatedRowCount: number; marketIdCount: number };
}

export interface SabaMoreRow {
  matchId: string;
  teamNames: string[];
  timeText: string;
  groupCount: number;
  nativeTypes: string[];
  marketIds: string[];
}

export interface SabaPanelSignature {
  tag: string;
  classes: string[];
  text: string;
}

export interface SabaMoreState {
  ownerMatchId: string;
  controlClasses: string[];
  relatedRows: SabaMoreRow[];
  panels: SabaPanelSignature[];
  fingerprint: string;
  truncated: boolean;
}

export interface SabaMoreChange {
  ownerMatchId: string;
  outcome: "ALTERNATE_ROWS_ADDED" | "OWNER_GROUPS_EXPANDED" | "PANEL_APPEARED" |
    "NO_STRUCTURAL_CHANGE" | "AMBIGUOUS_OR_RESTORE_FAILED";
  addedMatchIds: string[];
  addedNativeTypes: string[];
  addedMarketIds: string[];
  restored: boolean;
  truncated: boolean;
}

interface ProbePageState {
  documentToken: string;
  pageNowMs?: number;
  rowCount: number;
  tableCount: number;
  eligibleMoreCount: number;
  eligibleMoreOwners: string[];
  moreCandidates: Array<{ ownerMatchId: string; classes: string[]; text: string;
    hasHref: boolean; hrefKind: "EMPTY" | "FRAGMENT" | "JAVASCRIPT_NOOP" | "NAVIGATION";
    eligible: boolean }>;
  rosterMatchIds: string[];
  rosterSamples: Array<{ matchId: string; timeText: string; teamNames: string[];
    timeMetadata: Record<string, string> }>;
  timeShapes: Record<string, number>;
  dateContexts: Array<{ tag: string; classes: string[]; text: string; dataDate?: string }>;
  headerControls: Array<{ tag: string; classes: string[]; text: string; optionTexts?: string[] }>;
  fingerprint: string;
  activePeriod: "TODAY" | "EARLY" | "UNKNOWN";
  activePeriodEvidence: "TAB_STATE" | "FOOTBALL_PAGE_HEADING" | "CONFLICT" | "NONE";
  periodControls: Array<{ tag: string; classes: string[]; text: string; period: string;
    parentTag: string; parentClasses: string[]; ariaSelected: boolean | null;
    ariaCurrent: string | null; ariaExpanded: boolean | null; dataState: string | null;
    structure: { ancestors: unknown[]; descendants: unknown[]; groupDescendants: unknown[];
      truncated: boolean } }>;
  navRootChildren: unknown[];
  navRootTopology: unknown[];
  truncated: boolean;
}

export interface RunSabaNavigationProbeOptions {
  evaluate: (expression: string) => Promise<unknown>;
  evaluationFailure?: () => SabaProbeEvaluationFailure | null;
  evaluationTarget?: () => { kind: "ROOT" | "MAIN_WORLD" | "ISOLATED_WORLD";
    contextIdPresent: boolean; sessionIdPresent: boolean };
  isCurrent: () => boolean;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
  deadlineMs?: number;
  discoveryOnly?: boolean;
}

export interface SabaNavigationProbeResult {
  body: string;
  viewRestored: boolean;
}

function unique(values: string[], cap = 128): string[] {
  return [...new Set(values)].slice(0, cap);
}

export function classifySabaMoreChange(
  before: SabaMoreState,
  after: SabaMoreState,
  restored: boolean,
  restorationTruncated = false
): SabaMoreChange {
  const beforeIds = new Set(before.relatedRows.map((row) => row.matchId));
  const beforeTypes = new Set(before.relatedRows.flatMap((row) => row.nativeTypes));
  const beforeMarkets = new Set(before.relatedRows.flatMap((row) => row.marketIds));
  const addedMatchIds = unique(after.relatedRows.map((row) => row.matchId)
    .filter((value) => value && !beforeIds.has(value)));
  const addedNativeTypes = unique(after.relatedRows.flatMap((row) => row.nativeTypes)
    .filter((value) => !beforeTypes.has(value)));
  const addedMarketIds = unique(after.relatedRows.flatMap((row) => row.marketIds)
    .filter((value) => !beforeMarkets.has(value)));

  let outcome: SabaMoreChange["outcome"];
  if (!restored) {
    outcome = "AMBIGUOUS_OR_RESTORE_FAILED";
  } else if (addedMatchIds.length > 0) {
    outcome = "ALTERNATE_ROWS_ADDED";
  } else if (after.relatedRows.some((row, index) =>
    row.groupCount > (before.relatedRows[index]?.groupCount ?? 0)) ||
    addedNativeTypes.length > 0 || addedMarketIds.length > 0) {
    outcome = "OWNER_GROUPS_EXPANDED";
  } else if (after.panels.some((panel) =>
    !before.panels.some((candidate) => candidate.tag === panel.tag &&
      candidate.classes.join(" ") === panel.classes.join(" ") && candidate.text === panel.text))) {
    outcome = "PANEL_APPEARED";
  } else {
    outcome = "NO_STRUCTURAL_CHANGE";
  }
  return { ownerMatchId: before.ownerMatchId, outcome, addedMatchIds, addedNativeTypes,
    addedMarketIds, restored, truncated: before.truncated || after.truncated || restorationTruncated };
}

// This expression is intentionally read-only. It is also used by the observer to find a
// suitable public Sports document before any bounded action is attempted.
export const SABA_NAVIGATION_PROBE_READ_EXPRESSION = `(() => {
  const clean = (value, cap = 160) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, cap);
  const classes = (node) => Array.from(node && node.classList || []).map((v) => clean(v, 64))
    .filter((v) => /^[a-z0-9_-]{1,64}$/i.test(v)).slice(0, 16);
  const visible = (node) => { if (!(node instanceof Element)) return false; const s = getComputedStyle(node); const r = node.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const excluded = (node) => Boolean(node.closest('form,.betslip,[class*="betslip" i],.account,[class*="account" i],[class*="wallet" i],.c-odds,.c-odds-button'));
  const fold = (value) => clean(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/\\u0110/g, 'D').replace(/\\u0111/g, 'd').toUpperCase();
  const triState = (node, name) => { const value = node?.getAttribute(name);
    return value === 'true' ? true : value === 'false' ? false : null; };
  const enumState = (node, name, allowed) => { const value = fold(node?.getAttribute(name));
    return !value ? null : allowed.includes(value) ? value : 'OTHER'; };
  const describe = (node, extra = {}) => { const foldedLabel = fold(node?.textContent)
    .replace(/\\u0110/g, 'D');
    const knownLabel = /^(?:BONG DA|FOOTBALL|SOCCER)$/.test(foldedLabel) ?
      clean(node?.textContent) : '';
    return ({ ...extra,
    tag: String(node?.tagName || '').toLowerCase().slice(0, 24), classes: classes(node),
    visible: visible(node), ariaSelected: triState(node, 'aria-selected'),
    ariaCurrent: enumState(node, 'aria-current',
      ['PAGE', 'STEP', 'LOCATION', 'DATE', 'TIME', 'TRUE', 'FALSE']),
    ariaExpanded: triState(node, 'aria-expanded'),
    dataState: enumState(node, 'data-state',
      ['ACTIVE', 'CURRENT', 'SELECTED', 'OPEN', 'CLOSED', 'EXPANDED', 'COLLAPSED', 'ON', 'OFF']),
    ...(knownLabel ? { knownLabel } : {})
  }); };
  const walk = (root, maxDepth, maxNodes) => { const nodes = []; let truncated = false;
    let visited = 0;
    const visit = (parent, path, depth) => { const children = parent?.children;
      if (!children) return true;
      for (let index = 0; index < children.length; index += 1) {
        if (visited >= maxNodes) { truncated = true; return false; }
        const child = children.item(index); if (!child) continue; visited += 1;
        if (excluded(child)) continue; const childPath = [...path, index];
        if (visible(child)) nodes.push(describe(child, { path: childPath }));
        if (depth < maxDepth) { if (!visit(child, childPath, depth + 1)) return false; }
        else if (child.children.length > 0) truncated = true;
      }
      return true;
    };
    visit(root, [], 1); return { nodes, truncated };
  };
  const shape = (value) => { const text = fold(value); if (/^\\dH\\d{1,2}(?:\\+\\d{1,2})?'$/.test(text)) return 'LIVE_CLOCK'; if (text === 'TRUC TIEP') return 'BARE_LIVE'; if (/^TRUC TIEP\\s+\\d{1,2}:\\d{2}(?:AM|PM)$/.test(text)) return 'PREFIXED_KICKOFF'; if (/^\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}(?:AM|PM)?$/.test(text)) return 'DATED_KICKOFF'; if (/^\\d{1,2}:\\d{2}(?:AM|PM)$/.test(text)) return 'UNDATED_KICKOFF'; return 'UNKNOWN'; };
  const sportsRoots = Array.from(document.querySelectorAll('.c-side-nav.c-side-nav--event')).filter((root) => { const header=root.querySelector(':scope > .c-side-nav__header'); const label=header?.querySelector('.c-text,.c-side-nav__title')||header; return /^(?:THE THAO|SPORTS)$/.test(fold(label?.textContent)); });
  const navRoot = sportsRoots.find((root) => Array.from(root.querySelectorAll('.c-side-nav__tab')).some((tab) => visible(tab) && /^(?:HOM NAY|TODAY)$/.test(fold(tab.textContent)))) || null;
  const tables = Array.from(document.querySelectorAll('.c-odds-table--sport1')).filter(visible);
  if (!navRoot || tables.length === 0) return null;
  if (!globalThis.__fieldlineSabaNavigationProbeDocV1) globalThis.__fieldlineSabaNavigationProbeDocV1 = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const rows = tables.flatMap((table) => Array.from(table.querySelectorAll('.c-match[data-matchid]')).filter(visible));
  const validDate=(value)=>/^(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2})$/.test(value);
  const validClock=(value)=>/^\\d{1,2}:\\d{2}(?:AM|PM)$/i.test(value);
  const validDateTime=(value)=>/^(?:\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:?\\d{2})?|\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}(?:AM|PM)?)$/i.test(value);
  const validTitle=(value)=>/^(?:(?:TODAY|TOMORROW|EARLY)\\s+)?(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2})(?:\\s+\\d{1,2}:\\d{2}(?:AM|PM)?)?$/i.test(value)||validClock(value)||validDateTime(value);
  const rowData = rows.map((row) => { const time=row.querySelector('.c-match-time'); const timeText = clean(time?.textContent); const field=(attribute,validator)=>{const value=clean(time?.getAttribute(attribute)||row.getAttribute(attribute));return validator(value)?value:''}; const entries=[['title',field('title',validTitle)],['dateTime',field('datetime',(v)=>validDate(v)||validClock(v)||validDateTime(v))],['dataDate',field('data-date',validDate)],['dataStartTime',field('data-start-time',(v)=>validDate(v)||validClock(v)||validDateTime(v))],['dataKickoff',field('data-kickoff',(v)=>validDate(v)||validClock(v)||validDateTime(v))]].filter((entry)=>entry[1]); return { matchId: clean(row.getAttribute('data-matchid')), timeText, teamNames: Array.from(row.querySelectorAll('.c-team-name')).map((n) => clean(n.textContent)).filter(Boolean).slice(0, 4), timeMetadata:Object.fromEntries(entries), shape: shape(timeText) }; });
  const aggregateParticipants = (row) => { const participants=Array.from(row.querySelectorAll('.c-team-name')).map((node)=>fold(node.textContent)); if(participants.length!==2)return false; const parse=(value)=>{const match=/^(DOI NHA|DOI KHACH)\\s*-\\s*(\\S(?:.*\\S)?)\\s*-\\s*(\\d+)\\s+TRAN DAU$/.exec(value);if(!match)return null;return {role:match[1],bucket:match[2],count:Number(match[3])}}; const home=parse(participants[0]),away=parse(participants[1]); return home?.role==='DOI NHA'&&away?.role==='DOI KHACH'&&home.count>=2&&home.count===away.count&&home.bucket===away.bucket; };
  const eligible = rows.filter((row) => { const s = shape(row.querySelector('.c-match-time')?.textContent); const control = row.querySelector(':scope a.c-btn.c-btn--more.c-is-close'); return !aggregateParticipants(row) && (s === 'DATED_KICKOFF' || s === 'PREFIXED_KICKOFF' || s === 'UNDATED_KICKOFF') && control && visible(control) && !excluded(control) && !control.hasAttribute('href'); });
  eligible.sort((a, b) => Number(shape(b.querySelector('.c-match-time')?.textContent) === 'DATED_KICKOFF') - Number(shape(a.querySelector('.c-match-time')?.textContent) === 'DATED_KICKOFF'));
  const moreCandidates = rows.flatMap((row) => { const control=row.querySelector(':scope a.c-btn.c-btn--more'); if(!control||!visible(control)||excluded(control))return []; const raw=control.getAttribute('href'); const href=clean(raw); const hrefKind=raw===null||href===''?'EMPTY':href.startsWith('#')?'FRAGMENT':/^javascript:\\s*(?:void\\s*\\(\\s*0\\s*\\)|;?)$/i.test(href)?'JAVASCRIPT_NOOP':'NAVIGATION'; return [{ownerMatchId:clean(row.getAttribute('data-matchid')),classes:classes(control),text:clean(control.textContent),hasHref:raw!==null,hrefKind,eligible:eligible.includes(row)}]; }).slice(0,20);
  const timeShapes = { DATED_KICKOFF: 0, PREFIXED_KICKOFF: 0, UNDATED_KICKOFF: 0, BARE_LIVE: 0, LIVE_CLOCK: 0, UNKNOWN: 0 };
  for (const row of rowData) timeShapes[row.shape] += 1;
  const dateNodes = [];
  for (const table of tables) { if (table.hasAttribute('data-date')) dateNodes.push(table); let node = table.previousElementSibling; for (let i = 0; node && i < 3; i += 1, node = node.previousElementSibling) if (/date|header/i.test(node.className || '') && visible(node)) dateNodes.push(node); }
  const dateContexts = Array.from(new Set(dateNodes)).slice(0, 3).map((node) => {const dataDate=clean(node.getAttribute('data-date'));return { tag: node.tagName.toLowerCase(), classes: classes(node), text: node.matches('.c-odds-table--sport1') ? '' : clean(node.textContent, 512), ...(validDate(dataDate) ? { dataDate } : {}) }});
  const headerCandidates = tables.flatMap((table) => Array.from(table.querySelectorAll('header button,header select,header [role="button"],.market-header button,.c-odds-table__header button'))).filter((node) => visible(node) && !excluded(node));
  const headerControls = headerCandidates.slice(0, 16).map((node) => ({ tag: node.tagName.toLowerCase(), classes: classes(node), text: clean(node.tagName === 'SELECT' ? node.getAttribute('aria-label') : node.textContent, 512), ...(node.tagName === 'SELECT' ? { optionTexts: Array.from(node.querySelectorAll('option')).map((option) => clean(option.textContent)).slice(0, 16) } : {}) }));
  const periodKind = (tab) => { const text = fold(tab?.textContent);
    if (/^(?:HOM NAY|TODAY)$/.test(text)) return 'TODAY';
    if (/^(?:SOM|EARLY)$/.test(text)) return 'EARLY';
    if (/^(?:TRUC TIEP|LIVE)\\s*\\d{0,4}$/.test(text)) return 'LIVE';
    return 'UNKNOWN';
  };
  const selectedTabs = Array.from(navRoot.querySelectorAll('.c-side-nav__tab')).filter((tab) => { const ancestry=[tab,tab.parentElement].filter(Boolean); return tab.getAttribute('aria-selected') === 'true' || ancestry.some((node) => /(^|\\s)(?:active|selected|current)(?:-|_|\\s|$)/i.test(node.className || '')); });
  const tabPeriod = selectedTabs.length === 1 ? periodKind(selectedTabs[0]) : 'UNKNOWN';
  const tabConflict = selectedTabs.length > 1 || selectedTabs.length === 1 &&
    tabPeriod !== 'TODAY' && tabPeriod !== 'EARLY';
  const footballContent = Array.from(navRoot.children).filter((node) =>
    node.matches('.c-side-nav__content') && visible(node));
  const footballOwned = footballContent.some((content) => Array.from(content.querySelectorAll('.c-text,.c-side-nav__title'))
    .some((label) => visible(label) && /^(?:BONG DA|FOOTBALL|SOCCER)$/.test(fold(label.textContent))));
  let headingPeriod = 'UNKNOWN'; let headingConflict = false;
  const tableParents = new Set(tables.map((table) => table.parentElement).filter(Boolean));
  if (footballOwned && tableParents.size === 1) {
    const ownedByTable = tables.map((table) => { const found=[]; let node=table.previousElementSibling;
      for(let index=0;node&&index<3;index+=1,node=node.previousElementSibling)
        if(node.matches('.c-odds-page__header')&&visible(node))found.push(node); return found; });
    const ownedHeadings = Array.from(new Set(ownedByTable.flat()));
    if (ownedHeadings.length > 1) headingConflict = true;
    else if (ownedHeadings.length === 1 && ownedByTable.every((items) => items.includes(ownedHeadings[0]))) {
      const match=/^(?:BONG DA|FOOTBALL|SOCCER)\\s*\\/\\s*(HOM NAY|TODAY|SOM|EARLY)(?=\\s|$|TAT CA)/.exec(fold(ownedHeadings[0].textContent));
      if(match)headingPeriod=/^(?:HOM NAY|TODAY)$/.test(match[1])?'TODAY':'EARLY';
    }
  }
  const recognizedTab = tabPeriod === 'TODAY' || tabPeriod === 'EARLY';
  const recognizedHeading = headingPeriod === 'TODAY' || headingPeriod === 'EARLY';
  const conflict = tabConflict || headingConflict || recognizedTab && recognizedHeading && tabPeriod !== headingPeriod;
  const activePeriod = conflict ? 'UNKNOWN' : recognizedTab ? tabPeriod : recognizedHeading ? headingPeriod : 'UNKNOWN';
  const activePeriodEvidence = conflict ? 'CONFLICT' : recognizedTab ? 'TAB_STATE' :
    recognizedHeading ? 'FOOTBALL_PAGE_HEADING' : 'NONE';
  const rawPeriodControls = Array.from(navRoot.querySelectorAll('.c-side-nav__tab')).filter(visible);
  const periodControls = rawPeriodControls.slice(0, 6).map((tab) => {
    const ancestors = []; let ancestor = tab.parentElement;
    while (ancestor && ancestors.length < 6) { ancestors.push(describe(ancestor,
      { distance: ancestors.length + 1 })); if (ancestor === navRoot) break;
      ancestor = ancestor.parentElement; }
    const descendants = walk(tab, 4, 12);
    const group = tab.closest('.c-side-nav__tab-group');
    const groupTree = group && navRoot.contains(group) ? walk(group, 5, 32) :
      { nodes: [], truncated: false };
    const period = periodKind(tab);
    return { ...describe(tab), period, text: period === 'UNKNOWN' ? '' : clean(tab.textContent),
      parentTag: tab.parentElement?.tagName.toLowerCase() || '',
      parentClasses: classes(tab.parentElement),
      structure: { ancestors, descendants: descendants.nodes, groupDescendants: groupTree.nodes,
        truncated: descendants.truncated || groupTree.truncated ||
          Boolean(ancestor && ancestor !== navRoot) } };
  });
  const directRootChildren = Array.from(navRoot.children).filter((node) => !excluded(node));
  const navRootChildren = directRootChildren.slice(0, 16)
    .map((node, childIndex) => describe(node, { childIndex }));
  const rootTree = walk(navRoot, 6, 96);
  const navRootTopology = rootTree.nodes;
  const rosterMatchIds = rowData.map((row) => row.matchId).filter(Boolean);
  return { documentToken: clean(globalThis.__fieldlineSabaNavigationProbeDocV1), pageNowMs:Date.now(), rowCount: rows.length, tableCount: tables.length, activePeriod, activePeriodEvidence, periodControls, navRootChildren, navRootTopology, eligibleMoreCount: eligible.length, eligibleMoreOwners: eligible.map((row) => clean(row.getAttribute('data-matchid'))).filter(Boolean).slice(0, 20), moreCandidates, rosterMatchIds: rosterMatchIds.slice(0, 512), rosterSamples: rowData.slice(0, 20).map(({ matchId, timeText, teamNames, timeMetadata }) => ({ matchId, timeText, teamNames, timeMetadata })), timeShapes, dateContexts, headerControls, fingerprint: JSON.stringify([activePeriod,activePeriodEvidence,tables.length,rosterMatchIds,eligible.length]), truncated: rows.length > 512 || eligible.length > 20 || moreCandidates.length >= 20 || headerCandidates.length > 16 || dateNodes.length > 3 || rawPeriodControls.length > 6 || directRootChildren.length > 16 || rootTree.truncated || periodControls.some((control) => control.structure.truncated) };
})()`;

export function periodClickExpression(period: "today" | "early", token: string, pageDeadlineMs?: number): string {
  const expected = period === "today" ? "HOM NAY" : "SOM";
  const alternate = period === "today" ? "TODAY" : "EARLY";
  return `(() => { const clean=(v)=>String(v||'').replace(/\\s+/g,' ').trim(); const fold=(v)=>clean(v).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase(); const visible=(n)=>{if(!(n instanceof Element))return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}; if(${pageDeadlineMs === undefined ? "false" : `Date.now()>=${Math.floor(pageDeadlineMs)}`})return false; if(globalThis.__fieldlineSabaNavigationProbeDocV1!==${JSON.stringify(token)})return false; const roots=Array.from(document.querySelectorAll('.c-side-nav.c-side-nav--event')).filter((r)=>{const header=r.querySelector(':scope > .c-side-nav__header');const label=header?.querySelector('.c-text,.c-side-nav__title')||header;return /^(?:THE THAO|SPORTS)$/.test(fold(label?.textContent))}); const root=roots.find((r)=>Array.from(r.querySelectorAll('.c-side-nav__tab')).some((t)=>visible(t)&&/^(?:HOM NAY|TODAY)$/.test(fold(t.textContent)))); if(!root)return false; const target=Array.from(root.querySelectorAll('.c-side-nav__tab')).find((t)=>visible(t)&&(fold(t.textContent)===${JSON.stringify(expected)}||fold(t.textContent)===${JSON.stringify(alternate)})&&!t.closest('form,.betslip,[class*="betslip" i],.account,[class*="account" i],[class*="wallet" i]')); if(!target||target.hasAttribute('href'))return false; target.click(); return true; })()`;
}

export function moreReadExpression(ownerMatchId: string, token: string): string {
  return `(() => {
    const clean=(v,c=160)=>String(v||'').replace(/\\s+/g,' ').trim().slice(0,c);
    const cls=(n)=>Array.from(n?.classList||[]).map((v)=>clean(v)).filter(Boolean).slice(0,16);
    const ownerId=${JSON.stringify(ownerMatchId)}, token=${JSON.stringify(token)};
    if(globalThis.__fieldlineSabaNavigationProbeDocV1!==token)
      return {unavailable:'DOCUMENT_TOKEN_CHANGED'};
    const owner=Array.from(document.querySelectorAll('.c-match[data-matchid]'))
      .find((n)=>clean(n.getAttribute('data-matchid'))===ownerId);
    if(!owner)return {unavailable:'OWNER_ABSENT'};
    const control=owner.querySelector(':scope a.c-btn.c-btn--more');
    if(!control)return {unavailable:'CONTROL_ABSENT'};
    const related=[owner];
    let next=owner.nextElementSibling;
    while(next&&related.length<10&&next.matches('.c-match[data-matchid]')&&
      !next.querySelector(':scope a.c-btn.c-btn--more')){related.push(next);next=next.nextElementSibling}
    const relatedRows=related.map((row)=>({
      matchId:clean(row.getAttribute('data-matchid')),
      teamNames:Array.from(row.querySelectorAll('.c-team-name')).map((n)=>clean(n.textContent)).filter(Boolean).slice(0,4),
      timeText:clean(row.querySelector('.c-match-time')?.textContent),
      groupCount:row.querySelectorAll('.c-match__odds-group').length,
      nativeTypes:Array.from(row.querySelectorAll('[data-bt]')).map((n)=>clean(n.getAttribute('data-bt')))
        .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,128),
      marketIds:Array.from(row.querySelectorAll('[data-moid]')).map((n)=>clean(n.getAttribute('data-moid')))
        .filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,128)
    }));
    const panels=Array.from(document.querySelectorAll(
      '.all-market-panel,[class*="all-market-panel" i],[class*="market-panel" i]'))
      .filter((n)=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=='none'&&
        s.visibility!=='hidden'&&r.width>0&&r.height>0}).slice(0,8)
      .map((n)=>({tag:n.tagName.toLowerCase(),classes:cls(n),
        text:clean(n.querySelector('header,h1,h2,h3,[class*="header" i]')?.textContent||
          n.getAttribute('aria-label'))}));
    return {ownerMatchId:ownerId,controlClasses:cls(control),relatedRows,panels,
      fingerprint:JSON.stringify([cls(control),relatedRows,panels]),
      truncated:related.length>=10||panels.length>=8||relatedRows.some((r)=>
        r.nativeTypes.length>=128||r.marketIds.length>=128)};
  })()`;
}

export function moreClickExpression(ownerMatchId: string, token: string, restore: boolean,
  pageDeadlineMs?: number): string {
  return `(() => { const clean=(v)=>String(v||'').replace(/\\s+/g,' ').trim(); if(${pageDeadlineMs === undefined ? "false" : `Date.now()>=${Math.floor(pageDeadlineMs)}`})return false; if(globalThis.__fieldlineSabaNavigationProbeDocV1!==${JSON.stringify(token)})return false; const owner=Array.from(document.querySelectorAll('.c-match[data-matchid]')).find((n)=>clean(n.getAttribute('data-matchid'))===${JSON.stringify(ownerMatchId)}); const control=owner?.querySelector(':scope a.c-btn.c-btn--more'); if(!control||control.hasAttribute('href')||control.closest('form,.betslip,[class*="betslip" i],.account,[class*="account" i],[class*="wallet" i],.c-odds,.c-odds-button'))return false; if(${restore ? "true" : "false"}&&!control.classList.contains('c-is-open'))return false; if(${restore ? "false" : "true"}&&!control.classList.contains('c-is-close'))return false; control.click(); return true; })()`;
}

function parse<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

function isMoreReadUnavailable(value: unknown): value is SabaMoreReadUnavailable {
  if (!value || typeof value !== "object") return false;
  const guard = (value as { unavailable?: unknown }).unavailable;
  return guard === "DOCUMENT_TOKEN_CHANGED" || guard === "OWNER_ABSENT" ||
    guard === "CONTROL_ABSENT";
}

function moreCounts(state: SabaMoreState | null | undefined):
{ relatedRowCount: number; marketIdCount: number } | undefined {
  if (!state) return undefined;
  return { relatedRowCount: state.relatedRows.length,
    marketIdCount: new Set(state.relatedRows.flatMap((row) => row.marketIds)).size };
}

function appendFailureTrace(trace: SabaProbeFailureTrace[], entry: SabaProbeFailureTrace): void {
  const safeEntry = { ...entry,
    ...(entry.ownerMatchId === undefined ? {} : {
      ownerMatchId: entry.ownerMatchId.replace(/[^a-z0-9:_-]/giu, "").slice(0, 80)
    }) };
  trace.push(safeEntry);
  while (trace.length > MAX_FAILURE_TRACE_ENTRIES ||
    new TextEncoder().encode(JSON.stringify(trace)).byteLength > MAX_FAILURE_TRACE_BYTES) trace.shift();
}

function restoredRoster(before: ProbePageState, after: ProbePageState): boolean {
  if (before.tableCount !== after.tableCount || before.rowCount === 0) return false;
  const afterIds = new Set(after.rosterMatchIds);
  const overlap = before.rosterMatchIds.filter((id) => afterIds.has(id)).length;
  const allowedDrift = Math.max(5, Math.ceil(before.rowCount * 0.1));
  return overlap / Math.max(1, before.rosterMatchIds.length) >= 0.9 &&
    Math.abs(before.rowCount - after.rowCount) <= allowedDrift;
}

function unknownProbeBody(initial: ProbePageState,
  status: "NO_ACTION_UNCONFIRMED_SELECTION" | "NO_ACTION_INITIAL_TODAY_NOT_STABLE" =
    "NO_ACTION_UNCONFIRMED_SELECTION",
  reason?: string,
  failureTrace: SabaProbeFailureTrace[] = []
): string {
  const envelope = { kind: "SABA_NAVIGATION_PROBE", version: 1,
    status, coverageClaim: "PUBLIC_STRUCTURE_ONLY",
    mutated: false, viewRestored: true, ...(reason === undefined ? {} : { reason }) } as const;
  let body = JSON.stringify({ ...envelope, initial, periodControls: initial.periodControls, failureTrace,
    today: null, early: null, expansions: [], truncated: initial.truncated });
  if (new TextEncoder().encode(body).byteLength <= MAX_DIAGNOSTIC_BYTES) return body;

  const reducedInitial = { ...initial, eligibleMoreOwners: initial.eligibleMoreOwners.slice(0, 10),
    moreCandidates: initial.moreCandidates.slice(0, 10), rosterMatchIds: initial.rosterMatchIds.slice(0, 20),
    rosterSamples: initial.rosterSamples.slice(0, 10), headerControls: initial.headerControls.slice(0, 8),
    truncated: true };
  body = JSON.stringify({ ...envelope, initial: reducedInitial,
    periodControls: reducedInitial.periodControls, today: null, early: null, expansions: [], failureTrace,
    truncated: true });
  if (new TextEncoder().encode(body).byteLength <= MAX_DIAGNOSTIC_BYTES) return body;

  const compactClasses = (value: unknown, cap = 4): string[] => {
    if (!Array.isArray(value)) return [];
    const safe = value.filter((item): item is string => typeof item === "string" &&
      /^[a-z0-9_-]{1,64}$/iu.test(item));
    const modifiers = safe.filter((item) => /(?:^|[-_])(?:active|selected|current|open|opened|expanded|shown)(?:$|[-_])/iu
      .test(item));
    return [...new Set([...modifiers, ...safe])].slice(0, cap);
  };
  const compactNode = (value: unknown): Record<string, unknown> => {
    const node = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {
      tag: typeof node.tag === "string" ? node.tag.slice(0, 24) : "",
      classes: compactClasses(node.classes),
      visible: node.visible === true,
      ariaSelected: typeof node.ariaSelected === "boolean" ? node.ariaSelected : null,
      ariaCurrent: typeof node.ariaCurrent === "string" ? node.ariaCurrent : null,
      ariaExpanded: typeof node.ariaExpanded === "boolean" ? node.ariaExpanded : null,
      dataState: typeof node.dataState === "string" ? node.dataState : null
    };
    if (Array.isArray(node.path)) result.path = node.path.slice(0, 5);
    if (typeof node.distance === "number") result.distance = node.distance;
    if (typeof node.childIndex === "number") result.childIndex = node.childIndex;
    if (typeof node.knownLabel === "string" && /^(?:bong da|football|soccer)$/u.test(
      node.knownLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\u0111/giu, "d").toLowerCase())) {
      result.knownLabel = node.knownLabel.slice(0, 160);
    }
    return result;
  };
  const compactControls = initial.periodControls.slice(0, 6).map((control) => ({
    period: control.period, text: control.text, tag: control.tag, classes: compactClasses(control.classes),
    parentTag: control.parentTag, parentClasses: compactClasses(control.parentClasses),
    ariaSelected: control.ariaSelected, ariaCurrent: control.ariaCurrent,
    ariaExpanded: control.ariaExpanded, dataState: control.dataState,
    structure: { ancestors: control.structure.ancestors.slice(0, 6).map(compactNode),
      descendants: control.structure.descendants.slice(0, 4).map(compactNode),
      groupDescendants: control.structure.groupDescendants.slice(0, 6).map(compactNode),
      truncated: true }
  }));
  const terminalInitial = { rowCount: initial.rowCount, tableCount: initial.tableCount,
    activePeriod: initial.activePeriod, activePeriodEvidence: initial.activePeriodEvidence,
    eligibleMoreCount: initial.eligibleMoreCount,
    eligibleMoreOwners: initial.eligibleMoreOwners.slice(0, 3),
    moreCandidates: initial.moreCandidates.slice(0, 3), rosterMatchIds: initial.rosterMatchIds.slice(0, 5),
    rosterSamples: initial.rosterSamples.slice(0, 3), timeShapes: initial.timeShapes,
    dateContexts: initial.dateContexts.slice(0, 3), headerControls: initial.headerControls.slice(0, 3),
    periodControls: compactControls, navRootChildren: initial.navRootChildren.slice(0, 8).map(compactNode),
    navRootTopology: initial.navRootTopology.slice(0, 24).map(compactNode),
    truncated: true };
  body = JSON.stringify({ ...envelope, initial: terminalInitial, periodControls: compactControls, failureTrace,
    today: null, early: null, expansions: [], truncated: true });
  if (new TextEncoder().encode(body).byteLength <= MAX_DIAGNOSTIC_BYTES) return body;

  const minimalControls = compactControls.map((control) => ({ ...control,
    classes: compactClasses(control.classes, 2), parentClasses: compactClasses(control.parentClasses, 2),
    structure: { ancestors: control.structure.ancestors.slice(0, 3),
      descendants: control.structure.descendants.slice(0, 2),
      groupDescendants: control.structure.groupDescendants.slice(0, 3), truncated: true } }));
  return JSON.stringify({ ...envelope, initial: { rowCount: initial.rowCount,
    tableCount: initial.tableCount, activePeriod: initial.activePeriod,
    activePeriodEvidence: initial.activePeriodEvidence,
    eligibleMoreCount: initial.eligibleMoreCount, eligibleMoreOwners: initial.eligibleMoreOwners.slice(0, 1),
    moreCandidates: initial.moreCandidates.slice(0, 1), rosterMatchIds: initial.rosterMatchIds.slice(0, 1),
    rosterSamples: initial.rosterSamples.slice(0, 1), timeShapes: initial.timeShapes,
    dateContexts: initial.dateContexts.slice(0, 1), headerControls: initial.headerControls.slice(0, 1),
    periodControls: minimalControls, navRootChildren: initial.navRootChildren.slice(0, 4).map(compactNode),
    navRootTopology: initial.navRootTopology.slice(0, 8).map(compactNode), truncated: true },
  periodControls: minimalControls, today: null, early: null, expansions: [], failureTrace, truncated: true });
}

function unavailableInitialProbeBody(failureTrace: SabaProbeFailureTrace[]): string {
  return JSON.stringify({ kind: "SABA_NAVIGATION_PROBE", version: 1,
    status: "NO_ACTION_INITIAL_STATE_UNAVAILABLE", coverageClaim: "PUBLIC_STRUCTURE_ONLY",
    mutated: false, viewRestored: true, failureTrace, truncated: false });
}

function collectorTargetBody(initial: ProbePageState): string {
  return JSON.stringify({ kind: "SABA_NAVIGATION_PROBE", version: 1,
    status: "NO_ACTION_COLLECTOR_TARGET_BOUND", mutated: false, viewRestored: true,
    initial: { documentToken: initial.documentToken, activePeriod: initial.activePeriod,
      activePeriodEvidence: initial.activePeriodEvidence }, truncated: false });
}

export async function runSabaNavigationProbe(
  options: RunSabaNavigationProbeOptions
): Promise<SabaNavigationProbeResult | null> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const deadline = Math.min(now() + MAX_PROBE_MS, options.deadlineMs ?? Number.POSITIVE_INFINITY);
  const failureTrace: SabaProbeFailureTrace[] = [];
  let lastEvaluationFailure: SabaProbeEvaluationFailure | null = null;
  let lastEvaluationElapsedMs = 0;
  const evaluationDetails = (): Partial<SabaProbeFailureTrace> => ({
    ...(lastEvaluationFailure === null ? {} : { evaluationFailure: lastEvaluationFailure }),
    ...(options.evaluationTarget === undefined ? {} : { evaluationTarget: options.evaluationTarget() })
  });
  const evaluate = async <T>(expression: string): Promise<T | null> => {
    lastEvaluationElapsedMs = 0;
    if (!options.isCurrent()) {
      lastEvaluationFailure = "STALE";
      return null;
    }
    if (now() >= deadline) {
      lastEvaluationFailure = "DEADLINE";
      return null;
    }
    const evaluationStartedAtMs = now();
    const value = await options.evaluate(expression);
    lastEvaluationElapsedMs = Math.max(0, now() - evaluationStartedAtMs);
    if (!options.isCurrent()) {
      lastEvaluationFailure = "STALE";
      return null;
    }
    if (now() >= deadline) {
      lastEvaluationFailure = "DEADLINE";
      return null;
    }
    const parsed = parse<T>(value);
    lastEvaluationFailure = parsed === null ? options.evaluationFailure?.() ?? "PAGE_NULL" : null;
    return parsed;
  };
  const evaluateAction = async (stage: string, expression: string,
    ownerMatchId?: string): Promise<boolean | null> => {
    const confirmed = await evaluate<boolean>(expression);
    if (!confirmed) appendFailureTrace(failureTrace, { stage,
      ...(ownerMatchId === undefined ? {} : { ownerMatchId }), outcome: "ACTION_UNCONFIRMED",
      reads: 1, elapsedMs: lastEvaluationElapsedMs, ...evaluationDetails() });
    return confirmed;
  };
  const settlePage = async (expectedPeriod: "TODAY" | "EARLY", stage: string):
  Promise<ProbePageState | null> => {
    const startedAtMs = now();
    const settleDeadline = Math.min(deadline, startedAtMs +
      (stage === "INITIAL_TODAY_SETTLE" ? MAX_SETTLE_MS : MAX_PERIOD_SETTLE_MS));
    let previousFingerprint: string | null = null;
    let stableSinceMs: number | null = null;
    let reads = 0;
    let changed = false;
    let lastWasPageNull = false;
    while (now() < settleDeadline) {
      const state = await evaluate<ProbePageState>(SABA_NAVIGATION_PROBE_READ_EXPRESSION);
      reads += 1;
      if (!state) {
        if (lastEvaluationFailure !== "PAGE_NULL") {
          appendFailureTrace(failureTrace, { stage, outcome: "LAST_READ_ABSENT", reads,
            elapsedMs: now() - startedAtMs, ...evaluationDetails() });
          return null;
        }
        lastWasPageNull = true;
        previousFingerprint = null;
        stableSinceMs = null;
      } else {
        lastWasPageNull = false;
        if (state.activePeriod !== expectedPeriod) {
          stableSinceMs = null;
        } else if (previousFingerprint !== state.fingerprint || stableSinceMs === null) {
          changed ||= previousFingerprint !== null && previousFingerprint !== state.fingerprint;
          stableSinceMs = now();
        } else if (now() - stableSinceMs >= MIN_STABLE_MS) {
          return state;
        }
        previousFingerprint = state.fingerprint;
      }
      const remainingMs = settleDeadline - now();
      if (remainingMs <= 0) break;
      await wait(Math.min(SETTLE_POLL_MS, remainingMs));
    }
    appendFailureTrace(failureTrace, { stage, outcome: lastWasPageNull ? "LAST_READ_ABSENT" :
      changed ? "FINGERPRINT_UNSTABLE" : "STABILITY_WINDOW_EXHAUSTED", reads,
      elapsedMs: now() - startedAtMs, ...(lastWasPageNull ? evaluationDetails() : {}) });
    return null;
  };
  const settleMore = async (owner: string, token: string, stage: string,
    before?: SabaMoreState): Promise<SabaMoreState | null> => {
    const startedAtMs = now();
    const settleDeadline = Math.min(deadline, startedAtMs + MAX_SETTLE_MS);
    let previousFingerprint: string | null = null;
    let stableSinceMs: number | null = null;
    let reads = 0;
    let changed = false;
    let last: SabaMoreState | null = null;
    while (now() < settleDeadline) {
      const state = await evaluate<SabaMoreState | SabaMoreReadUnavailable>(moreReadExpression(owner, token));
      reads += 1;
      if (!state || isMoreReadUnavailable(state)) {
        const beforeCounts = moreCounts(before);
        const lastCounts = moreCounts(last);
        appendFailureTrace(failureTrace, { stage, ownerMatchId: owner, outcome: "LAST_READ_ABSENT",
          reads, elapsedMs: now() - startedAtMs,
          ...(!state ? evaluationDetails() : {}),
          ...(isMoreReadUnavailable(state) ? { guard: state.unavailable } : {}),
          ...(beforeCounts === undefined ? {} : { before: beforeCounts }),
          ...(lastCounts === undefined ? {} : { last: lastCounts }) });
        return null;
      }
      last = state;
      if (previousFingerprint !== state.fingerprint || stableSinceMs === null) stableSinceMs = now();
      else if (now() - stableSinceMs >= MIN_STABLE_MS) return state;
      changed ||= previousFingerprint !== null && previousFingerprint !== state.fingerprint;
      previousFingerprint = state.fingerprint;
      const remainingMs = settleDeadline - now();
      if (remainingMs <= 0) break;
      await wait(Math.min(SETTLE_POLL_MS, remainingMs));
    }
    const beforeCounts = moreCounts(before);
    const lastCounts = moreCounts(last);
    appendFailureTrace(failureTrace, { stage, ownerMatchId: owner,
      outcome: changed ? "FINGERPRINT_UNSTABLE" : "STABILITY_WINDOW_EXHAUSTED", reads,
      elapsedMs: now() - startedAtMs,
      ...(beforeCounts === undefined ? {} : { before: beforeCounts }),
      ...(lastCounts === undefined ? {} : { last: lastCounts }) });
    return null;
  };
  if (!options.isCurrent() || now() >= deadline) return null;
  const initial = await evaluate<ProbePageState>(SABA_NAVIGATION_PROBE_READ_EXPRESSION);
  if (!initial) {
    if (!options.isCurrent()) return null;
    appendFailureTrace(failureTrace, { stage: "INITIAL_READ", outcome: "LAST_READ_ABSENT",
      reads: 1, elapsedMs: lastEvaluationElapsedMs, ...evaluationDetails() });
    return { body: unavailableInitialProbeBody(failureTrace), viewRestored: true };
  }
  if (initial.activePeriod === "UNKNOWN") {
    return { body: unknownProbeBody(initial), viewRestored: true };
  }
  if (options.discoveryOnly === true) {
    if (initial.activePeriod !== "TODAY" || typeof initial.documentToken !== "string" ||
      initial.documentToken.trim().length === 0) {
      return { body: unknownProbeBody(initial), viewRestored: true };
    }
    return { body: collectorTargetBody(initial), viewRestored: true };
  }
  const token = initial.documentToken;
  const pageDeadlineMs = typeof initial.pageNowMs === "number"
    ? initial.pageNowMs + Math.max(0, deadline - now()) : undefined;
  const expansions: SabaMoreChange[] = [];
  const abortAfterAction = async (reason: string,
    baseline: ProbePageState = initial): Promise<SabaNavigationProbeResult | null> => {
    if (!options.isCurrent()) return null;
    const clicked = await evaluate<boolean>(periodClickExpression("today", token, pageDeadlineMs));
    if (!clicked) appendFailureTrace(failureTrace, { stage: "RESTORE_TODAY_ACTION",
      outcome: "ACTION_UNCONFIRMED", reads: 1, elapsedMs: lastEvaluationElapsedMs, ...evaluationDetails() });
    const restoredState = clicked ? await settlePage("TODAY", "RESTORE_TODAY_SETTLE") : null;
    if (!options.isCurrent()) return null;
    const viewRestored = Boolean(restoredState && restoredRoster(baseline, restoredState));
    let body = JSON.stringify({ kind: "SABA_NAVIGATION_PROBE", version: 1,
      status: "AMBIGUOUS_OR_RESTORE_FAILED", coverageClaim: "PUBLIC_STRUCTURE_ONLY",
      reason: reason.slice(0, 160), today: baseline, early: null, expansions,
      failureTrace, viewRestored, truncated: baseline.truncated });
    if (new TextEncoder().encode(body).byteLength > MAX_DIAGNOSTIC_BYTES) {
      body = JSON.stringify({ kind: "SABA_NAVIGATION_PROBE", version: 1,
        status: "AMBIGUOUS_OR_RESTORE_FAILED", coverageClaim: "PUBLIC_STRUCTURE_ONLY",
        reason: reason.slice(0, 160), today: { rowCount: baseline.rowCount,
          tableCount: baseline.tableCount, activePeriod: baseline.activePeriod,
          activePeriodEvidence: baseline.activePeriodEvidence },
        early: null, expansions: [], failureTrace, viewRestored, truncated: true });
    }
    return { body, viewRestored };
  };
  let today: ProbePageState | null;
  if (initial.activePeriod === "TODAY") {
    today = await settlePage("TODAY", "INITIAL_TODAY_SETTLE");
    if (!today) {
      if (!options.isCurrent()) return null;
      return { body: unknownProbeBody(initial, "NO_ACTION_INITIAL_TODAY_NOT_STABLE",
        "INITIAL_TODAY_NOT_STABLE", failureTrace), viewRestored: true };
    }
    if (today.documentToken !== token) {
      return { body: unknownProbeBody(initial, "NO_ACTION_INITIAL_TODAY_NOT_STABLE",
        "DOCUMENT_TOKEN_CHANGED", failureTrace), viewRestored: true };
    }
  } else {
    if (!await evaluate<boolean>(periodClickExpression("today", token, pageDeadlineMs))) {
      appendFailureTrace(failureTrace, { stage: "TODAY_ACTION", outcome: "ACTION_UNCONFIRMED",
        reads: 1, elapsedMs: lastEvaluationElapsedMs, ...evaluationDetails() });
      return abortAfterAction("TODAY_ACTION_UNCONFIRMED");
    }
    today = await settlePage("TODAY", "TODAY_SETTLE");
    if (!today || today.documentToken !== token) return abortAfterAction("TODAY_NOT_STABLE");
  }

  let safelyRestored = true;
  for (const owner of today.eligibleMoreOwners.slice(0, 2)) {
    const beforeStartedAt = now();
    const beforeResult = await evaluate<SabaMoreState | SabaMoreReadUnavailable>(moreReadExpression(owner, token));
    if (!beforeResult || isMoreReadUnavailable(beforeResult)) {
      appendFailureTrace(failureTrace, { stage: "MORE_BEFORE", ownerMatchId: owner,
        outcome: "LAST_READ_ABSENT", reads: 1, elapsedMs: now() - beforeStartedAt,
        ...(!beforeResult ? evaluationDetails() : {}),
        ...(isMoreReadUnavailable(beforeResult) ? { guard: beforeResult.unavailable } : {}) });
      return abortAfterAction("MORE_BEFORE_UNAVAILABLE", today);
    }
    const before = beforeResult;
    if (!await evaluate<boolean>(moreClickExpression(owner, token, false, pageDeadlineMs))) {
      appendFailureTrace(failureTrace, { stage: "MORE_ACTION", ownerMatchId: owner,
        outcome: "ACTION_UNCONFIRMED", reads: 1, elapsedMs: lastEvaluationElapsedMs, ...evaluationDetails() });
      return abortAfterAction("MORE_ACTION_UNCONFIRMED", today);
    }
    const after = await settleMore(owner, token, "MORE_AFTER_SETTLE", before);
    if (!after) return abortAfterAction("MORE_AFTER_NOT_STABLE", today);
    const beforeIds = new Set(before.relatedRows.map((row) => row.matchId));
    const beforeTypes = new Set(before.relatedRows.flatMap((row) => row.nativeTypes));
    const beforeMarkets = new Set(before.relatedRows.flatMap((row) => row.marketIds));
    const ownerExpanded = after.relatedRows.some((row, index) =>
      !beforeIds.has(row.matchId) || row.groupCount > (before.relatedRows[index]?.groupCount ?? 0) ||
      row.nativeTypes.some((value) => !beforeTypes.has(value)) ||
      row.marketIds.some((value) => !beforeMarkets.has(value)));
    const controlOpened = !before.controlClasses.includes("c-is-open") &&
      after.controlClasses.includes("c-is-open");
    const requiresRestore = ownerExpanded || controlOpened;
    let restorationTruncated = false;
    let restored = after.fingerprint === before.fingerprint;
    if (requiresRestore) {
      const clicked = await evaluateAction("MORE_RESTORE_ACTION",
        moreClickExpression(owner, token, true, pageDeadlineMs), owner);
      if (clicked) {
        const restoredState = await settleMore(owner, token, "MORE_RESTORE_SETTLE", before);
        restorationTruncated = restoredState?.truncated === true;
        restored = Boolean(restoredState && restoredState.fingerprint === before.fingerprint);
      }
    }
    safelyRestored &&= restored;
    expansions.push(classifySabaMoreChange(before, after, restored, restorationTruncated));
    if (!restored) break;
  }

  let early: ProbePageState | null = null;
  if (safelyRestored && await evaluateAction("EARLY_ACTION", periodClickExpression("early", token, pageDeadlineMs))) {
    early = await settlePage("EARLY", "EARLY_SETTLE");
  }
  let finalToday: ProbePageState | null = null;
  if (await evaluateAction("FINAL_TODAY_ACTION", periodClickExpression("today", token, pageDeadlineMs))) {
    finalToday = await settlePage("TODAY", "FINAL_TODAY_SETTLE");
  }
  let viewRestored = Boolean(finalToday && restoredRoster(today, finalToday));
  if ((!viewRestored || !safelyRestored) && options.isCurrent() && now() < deadline &&
    await evaluateAction("FINAL_TODAY_RETRY_ACTION", periodClickExpression("today", token, pageDeadlineMs))) {
    finalToday = await settlePage("TODAY", "FINAL_TODAY_RETRY_SETTLE");
    viewRestored = Boolean(finalToday && restoredRoster(today, finalToday));
  }
  viewRestored &&= safelyRestored;
  const payload = { kind: "SABA_NAVIGATION_PROBE", version: 1,
    status: viewRestored && early ? "COMPLETE_EVIDENCE" : "AMBIGUOUS_OR_RESTORE_FAILED",
    coverageClaim: "PUBLIC_STRUCTURE_ONLY", today, early, expansions, failureTrace, viewRestored,
    truncated: Boolean(today.truncated || early?.truncated || expansions.some((item) =>
      item.addedMarketIds.length >= 128 || item.addedNativeTypes.length >= 128 || item.truncated)) };
  let body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > MAX_DIAGNOSTIC_BYTES) {
    body = JSON.stringify({ ...payload, today: { ...today, rosterMatchIds: today.rosterMatchIds.slice(0, 20),
      rosterSamples: today.rosterSamples.slice(0, 10), headerControls: today.headerControls.slice(0, 8) },
    early: early ? { ...early, rosterMatchIds: early.rosterMatchIds.slice(0, 20),
      rosterSamples: early.rosterSamples.slice(0, 10), headerControls: early.headerControls.slice(0, 8) } : null,
    truncated: true });
  }
  if (new TextEncoder().encode(body).byteLength > MAX_DIAGNOSTIC_BYTES) {
    body = JSON.stringify({ kind: "SABA_NAVIGATION_PROBE", version: 1,
      status: payload.status, coverageClaim: "PUBLIC_STRUCTURE_ONLY",
      today: { rowCount: today.rowCount, tableCount: today.tableCount,
        activePeriod: today.activePeriod, activePeriodEvidence: today.activePeriodEvidence },
      early: early ? { rowCount: early.rowCount, tableCount: early.tableCount,
        activePeriod: early.activePeriod, activePeriodEvidence: early.activePeriodEvidence } : null,
      expansions: [], failureTrace, viewRestored, truncated: true });
  }
  return { body, viewRestored };
}
