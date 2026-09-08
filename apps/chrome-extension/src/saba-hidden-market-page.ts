import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import type { SabaCollectorBinding, SabaCollectorOwnerCaptureResult,
  SabaCollectorPageAdapter, SabaCollectorPeriod, SabaCollectorRecord,
  SabaCollectorRosterOwner, SabaCollectorRosterResult,
  SabaCollectorTodayRestoreResult } from "./saba-hidden-market-collector.js";
import { moreClickExpression, moreReadExpression, periodClickExpression,
  SABA_NAVIGATION_PROBE_READ_EXPRESSION } from "./saba-navigation-probe.js";

const OPERATION_TIMEOUT_MS = 30_000;
const PERIOD_SETTLE_MS = 15_000;
const STABLE_MS = 500;

type ProbeState = { readonly documentToken: string; readonly pageNowMs?: number;
  readonly activePeriod: "TODAY" | "EARLY" | "UNKNOWN"; readonly fingerprint: string;
  readonly activePeriodEvidence?: "TAB_STATE" | "FOOTBALL_PAGE_HEADING" | "CONFLICT" | "NONE";
  readonly tableCount?: number; readonly eligibleMoreCount?: number;
  readonly rosterMatchIds?: readonly string[] };
type RosterMetadata = { readonly documentToken: string; readonly rows: readonly {
  readonly matchId: string; readonly timeShape: "DATED_KICKOFF" | "PREFIXED_KICKOFF" |
    "UNDATED_KICKOFF"; readonly control: "ELIGIBLE_MORE" | "OPEN_MORE" |
    "NO_ELIGIBLE_CONTROL" | "UNSAFE";
  readonly kickoffDate: { readonly kind: "EXPLICIT"; readonly isoDate: string } |
    { readonly kind: "UNKNOWN" } }[] };
type RosterMetadataRow = RosterMetadata["rows"][number];
type MetadataMismatchReason = "METADATA_MEMBERSHIP" | "METADATA_CONTROL" |
  "METADATA_TIME" | "METADATA_DATE";
type MoreState = { readonly ownerMatchId: string; readonly controlClasses: readonly string[];
  readonly relatedRows: readonly { readonly matchId: string; readonly groupCount: number;
    readonly nativeTypes: readonly string[]; readonly marketIds: readonly string[] }[];
  readonly panels: readonly { readonly tag: string; readonly classes: readonly string[];
    readonly text: string }[]; readonly fingerprint: string; readonly truncated: boolean };
type MoreUnavailable = { readonly unavailable: "DOCUMENT_TOKEN_CHANGED" | "OWNER_ABSENT" |
  "CONTROL_ABSENT" };
export type SabaUnrepresentedOwnerOddsShape = { readonly nativeId: string;
  readonly nativeType: string | null; readonly elementTag: string;
  readonly elementClasses: readonly string[];
  readonly parentChain: readonly { readonly tag: string; readonly classes: readonly string[] }[];
  readonly inOddsGroup: boolean; readonly isOdds: boolean; readonly priceText: string };
export type SabaUnrepresentedOwnerGroupShape = { readonly tag: string;
  readonly classes: readonly string[];
  readonly nativeAttributes: readonly { readonly name: string; readonly value: string }[];
  readonly nativeIdCount: number };
export type SabaUnrepresentedOwnerDiagnostic = { readonly binding: SabaCollectorBinding;
  readonly period: SabaCollectorPeriod; readonly ownerMatchId: string;
  readonly capturedAtMs: number; readonly capturedMonotonicMs: number;
  readonly reason: "ADDED_NATIVE_IDS" | "GROUP_COUNT_CHANGED" |
    "NATIVE_TYPE_ORDER_CHANGED" | "NATIVE_TYPES_CHANGED" | "OWNER_STRUCTURE_CHANGED";
  readonly before: { readonly groupCount: number; readonly nativeTypes: readonly string[];
    readonly nativeIdCount: number };
  readonly after: { readonly groupCount: number; readonly nativeTypes: readonly string[];
    readonly nativeIdCount: number; readonly addedNativeIds: readonly string[] };
  readonly catalog: { readonly groupCount: number; readonly nativeIdCount: number };
  readonly unmatched: readonly SabaUnrepresentedOwnerOddsShape[];
  readonly addedGroupShapes: readonly SabaUnrepresentedOwnerGroupShape[] };
export interface SabaPeriodUnstablePhaseSummary {
  readonly actualPeriod: "TODAY" | "EARLY" | "UNKNOWN";
  readonly activePeriodEvidence?: "TAB_STATE" | "FOOTBALL_PAGE_HEADING" | "CONFLICT" | "NONE";
  readonly tableCount: number;
  readonly publicRosterLength: number;
  readonly eligibleMoreCount: number;
  readonly metadataPrematchCount: number;
  readonly probeFingerprintHash: string;
  readonly metadataRowsHash: string;
}
export interface SabaPeriodUnstableDiagnostic {
  readonly expectedPeriod: SabaCollectorPeriod;
  readonly readCount: number;
  readonly elapsedMs: number;
  readonly fingerprintSame: boolean;
  readonly metadataSame: boolean;
  readonly ownerPreparationReason?: "OWNER_ABSENT" | "CONTROL_NOT_ELIGIBLE" |
    "FINGERPRINT_UNSTABLE";
  readonly finalPhases: readonly SabaPeriodUnstablePhaseSummary[];
}
export interface SabaRestoreRosterMembershipSummary {
  readonly actualPeriod: "TODAY" | "EARLY" | "UNKNOWN";
  readonly rowCount: number;
  readonly uniqueCount: number;
  readonly addedCount: number;
  readonly missingCount: number;
  readonly duplicateCount: number;
  readonly addedMatchIds: readonly string[];
  readonly missingMatchIds: readonly string[];
  readonly duplicateMatchIds: readonly string[];
  readonly controlCounts: { readonly eligibleMore: number; readonly openMore: number;
    readonly noEligibleControl: number; readonly unsafe: number };
  readonly timeShapeCounts: { readonly datedKickoff: number; readonly prefixedKickoff: number;
    readonly undatedKickoff: number };
  readonly dateCounts: { readonly explicit: number; readonly unknown: number };
}
export interface SabaRestoreRosterMismatchDiagnostic {
  readonly binding: SabaCollectorBinding;
  readonly period: SabaCollectorPeriod;
  readonly ownerMatchId: string;
  readonly phase?: "OPEN" | "RESTORE";
  readonly reason: MetadataMismatchReason;
  readonly capturedAtMs: number;
  readonly capturedMonotonicMs: number;
  readonly changedRows?: readonly { readonly matchId: string;
    readonly beforeControl: RosterMetadataRow["control"] | null;
    readonly afterControl: RosterMetadataRow["control"] | null;
    readonly timeShapeChanged: boolean; readonly dateChanged: boolean }[];
  readonly baseline: SabaRestoreRosterMembershipSummary;
  readonly restoredReads: { readonly first: SabaRestoreRosterMembershipSummary | null;
    readonly final: SabaRestoreRosterMembershipSummary | null };
}
type PagePhase = { readonly probe: ProbeState; readonly metadata: RosterMetadata;
  readonly catalog: readonly SabaCollectorRecord[]; readonly more: MoreState | MoreUnavailable | null;
  readonly unmatched: readonly SabaUnrepresentedOwnerOddsShape[];
  readonly ownerGroups: readonly SabaUnrepresentedOwnerGroupShape[] };
type StablePhase = { readonly first: PagePhase; readonly second: PagePhase };
const SUPPLEMENTAL_UNSAFE_REASONS = ["RECORD_GROUP_SHAPE_OR_LIMIT", "OWNER_MATCH_ID_INVALID",
  "OWNER_RECORD_AMBIGUOUS", "OWNER_RECORD_UNBOUND", "ODDS_ID_OR_PRICE_INVALID", "OUTCOME_LIMIT",
  "NATIVE_TYPE_LENGTH", "NATIVE_TYPE_CONFLICT", "DUPLICATE_NATIVE_ID_ACROSS_BLOCKS",
  "LABEL_LIMIT_OR_LENGTH", "STATUS_OR_GREY_LENGTH", "RECORD_GROUP_LIMIT", "SERIALIZE_FAILED",
  "PAYLOAD_LIMIT"] as const;
type SupplementalUnsafeReason = typeof SUPPLEMENTAL_UNSAFE_REASONS[number];

export interface SabaHiddenMarketPageAdapterOptions {
  readonly binding: SabaCollectorBinding;
  readonly evaluate: (expression: string) => Promise<unknown>;
  readonly isCurrent: () => boolean;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly deadlineMs?: () => number | undefined;
  readonly onUnrepresentedOwner?: (diagnostic: SabaUnrepresentedOwnerDiagnostic) => void;
  readonly onPeriodUnstable?: (diagnostic: SabaPeriodUnstableDiagnostic) => void;
  readonly onRestoreRosterMismatch?: (diagnostic: SabaRestoreRosterMismatchDiagnostic) => void;
}

const rosterMetadataExpression = (token: string): string => `(() => {
  const token=${JSON.stringify(token)};
  if(globalThis.__fieldlineSabaNavigationProbeDocV1!==token)return {documentToken:'',rows:[]};
  const clean=(value,cap=160)=>{const result=String(value??'').replace(/\\s+/g,' ').trim();return result.length<=cap?result:''};
  const fold=(value)=>clean(value).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\u0110/g,'D').replace(/\\u0111/g,'d').toUpperCase();
  const visible=(node)=>{if(!(node instanceof Element))return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};
  const excluded=(node)=>Boolean(node.closest('form,.betslip,[class*="betslip" i],.account,[class*="account" i],[class*="wallet" i],.c-odds,.c-odds-button'));
  const shape=(value)=>{const text=fold(value);if(/^\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}(?:AM|PM)?$/.test(text))return 'DATED_KICKOFF';if(/^TRUC TIEP\\s+\\d{1,2}:\\d{2}(?:AM|PM)$/.test(text))return 'PREFIXED_KICKOFF';if(/^\\d{1,2}:\\d{2}(?:AM|PM)$/.test(text))return 'UNDATED_KICKOFF';return null};
  const validCalendar=(year,month,day)=>{const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];return month>=1&&month<=12&&day>=1&&day<=days[month-1]};
  const literalDate=(value)=>{const match=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);return validCalendar(year,month,day)?match[1]+'-'+match[2]+'-'+match[3]:null};
  const zonedDate=(value)=>{const match=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?(Z|([+-])(\\d{2}):?(\\d{2}))$/.exec(value);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]??0),millisecond=Number((match[7]??'').padEnd(3,'0')),offsetHour=match[8]==='Z'?0:Number(match[10]),offsetMinute=match[8]==='Z'?0:Number(match[11]);if(!validCalendar(year,month,day)||hour>23||minute>59||second>59||offsetHour>14||offsetMinute>59||(offsetHour===14&&offsetMinute!==0))return null;const instant=new Date(0);instant.setUTCFullYear(year,month-1,day);instant.setUTCHours(hour,minute,second,millisecond);const offset=match[8]==='Z'?0:(match[9]==='+'?1:-1)*(offsetHour*60+offsetMinute);const provider=new Date(instant.getTime()-offset*60000+8*60*60000);return String(provider.getUTCFullYear()).padStart(4,'0')+'-'+String(provider.getUTCMonth()+1).padStart(2,'0')+'-'+String(provider.getUTCDate()).padStart(2,'0')};
  const explicitDate=(row,time)=>{const table=row.closest('.c-odds-table--sport1');const values=[];for(const node of [time,row,table]){if(!node)continue;for(const name of ['data-date','datetime','data-start-time','data-kickoff']){const raw=clean(node.getAttribute(name),80),value=name==='data-date'?literalDate(raw):zonedDate(raw);if(value)values.push(value)}}const unique=[...new Set(values)];return unique.length===1?{kind:'EXPLICIT',isoDate:unique[0]}:{kind:'UNKNOWN'}};
  const aggregate=(row)=>{const names=Array.from(row.querySelectorAll('.c-team-name')).map((node)=>fold(node.textContent));if(names.length!==2)return false;const parse=(value)=>{const match=/^(DOI NHA|DOI KHACH)\\s*-\\s*(\\S(?:.*\\S)?)\\s*-\\s*(\\d+)\\s+TRAN DAU$/.exec(value);return match?{role:match[1],bucket:match[2],count:Number(match[3])}:null};const home=parse(names[0]),away=parse(names[1]);return home?.role==='DOI NHA'&&away?.role==='DOI KHACH'&&home.count>=2&&home.count===away.count&&home.bucket===away.bucket};
  const rows=[];
  for(const row of document.querySelectorAll('.c-odds-table--sport1 .c-match[data-matchid]')){
    if(!visible(row)||aggregate(row))continue;const time=row.querySelector('.c-match-time');const timeShape=shape(time?.textContent);if(!timeShape)continue;
    const matchId=clean(row.getAttribute('data-matchid'),128);if(!matchId)continue;
    const controls=Array.from(row.querySelectorAll(':scope .c-btn.c-btn--more'));
    let control='NO_ELIGIBLE_CONTROL';
    if(controls.length>0){const candidate=controls.length===1?controls[0]:null;const safe=candidate&&candidate.tagName==='A'&&visible(candidate)&&!excluded(candidate)&&!candidate.hasAttribute('href');control=safe&&candidate.classList.contains('c-is-close')&&!candidate.classList.contains('c-is-open')?'ELIGIBLE_MORE':safe&&candidate.classList.contains('c-is-open')&&!candidate.classList.contains('c-is-close')?'OPEN_MORE':'UNSAFE'}
    rows.push({matchId,timeShape,control,kickoffDate:explicitDate(row,time)});
  }
  return {documentToken:token,rows};
})()`;

const pagePhaseExpression = (token: string, ownerMatchId?: string,
  requireCatalog = true): string => {
  const metadataPrefix = `(() => {
  const probe=(${SABA_NAVIGATION_PROBE_READ_EXPRESSION});
  const metadata=(${rosterMetadataExpression(token)});`;
  if (!requireCatalog) return `${metadataPrefix}
  return {probe,metadata,catalog:'[]',more:null,supplementalUnsafe:false,unmatched:[],ownerGroups:[]};
})()`;
  return `${metadataPrefix}
  const baseCatalog=(${CMD_PUBLIC_CATALOG_EXPRESSION});
  const supplemental=(()=>{
    let records;try{records=JSON.parse(baseCatalog)}catch{return{catalog:baseCatalog,unsafe:false}}if(!Array.isArray(records))return{catalog:baseCatalog,unsafe:false};
    const privateSelector='form,.betslip,[class*="betslip" i],.account,[class*="account" i],[class*="wallet" i]';
    const normalized=(value)=>String(value??'').replace(/\\s+/g,' ').trim(),bounded=(value,cap)=>{const text=normalized(value);return text.length>0&&text.length<=cap?text:null};
    const blocks=Array.from(document.querySelectorAll('.c-bettype')).filter((block)=>!block.closest('.c-match__odds-group')&&!block.closest(privateSelector));
    const ownersByMatchId=new Map();for(const owner of document.querySelectorAll('.c-match[data-matchid]')){const matchId=bounded(owner.getAttribute('data-matchid'),128);if(!matchId)continue;let owners=ownersByMatchId.get(matchId);if(!owners){owners=[];ownersByMatchId.set(matchId,owners)}owners.push(owner)}
    const representedByRecord=new Map(),supplementalByRecord=new Map();
    for(const record of records){if(!record||typeof record!=='object'||typeof record.matchId!=='string'||!Array.isArray(record.groups))continue;if(record.groups.length>128||record.groups.some((group)=>!group||!Array.isArray(group.odds)||group.odds.length>128))return{catalog:baseCatalog,unsafe:'RECORD_GROUP_SHAPE_OR_LIMIT'};const represented=new Set();for(const group of record.groups){for(const odd of group.odds){const id=bounded(odd?.marketOddsId,128);if(id)represented.add(id)}}representedByRecord.set(record,represented);supplementalByRecord.set(record,[])}
    const labelsFor=(block,rows)=>{const labels=[],seen=new Set(),rowSet=new Set(rows);for(const element of block.querySelectorAll('*')){if(element.children.length!==0||element.matches('i,svg,path,.c-odds')||element.closest('.c-team-name')||element.closest(privateSelector)||element.closest('.c-odds-button'))continue;const row=element.closest('.c-bettype__row');if(row?(!block.contains(row)||!rowSet.has(row)):element.closest('.c-bettype')!==block)continue;const raw=normalized(element.textContent);if(raw.length>80)return null;const text=raw||null;if(text&&!seen.has(text)){seen.add(text);labels.push(text);if(labels.length>32)return null}}return labels};
    for(const record of records){const owners=ownersByMatchId.get(record.matchId)??[];if(owners.length!==1)continue;const owner=owners[0];for(const group of record.groups){if(!Array.isArray(group.betTypeIds)||group.betTypeIds.length!==1||!['461','462'].includes(group.betTypeIds[0])||!Array.isArray(group.labels))continue;const ids=[...new Set(group.odds.map((odd)=>bounded(odd?.marketOddsId,128)).filter(Boolean))];if(ids.length!==1)continue;const nativeId=ids[0],nodes=Array.from(owner.querySelectorAll('.c-match__odds-group .c-odds[data-moid]')).filter((node)=>node.closest('.c-match[data-matchid]')===owner&&bounded(node.getAttribute('data-moid'),128)===nativeId);if(nodes.length!==group.odds.length)continue;const owningBlocks=[...new Set(nodes.map((node)=>node.closest('.c-bettype')).filter(Boolean))];if(owningBlocks.length!==1)continue;const block=owningBlocks[0];if(block.closest('.c-match[data-matchid]')!==owner||block.closest(privateSelector)||nodes.some((node)=>node.closest('.c-bettype')!==block))continue;const rows=[...new Set(nodes.map((node)=>node.closest('.c-bettype__row')).filter(Boolean))];if(rows.some((row)=>Array.from(row.querySelectorAll('.c-odds[data-moid]')).some((node)=>node.closest('.c-bettype')===block&&bounded(node.getAttribute('data-moid'),128)!==nativeId)))continue;const headerLabels=labelsFor(block,[]);if(headerLabels===null||headerLabels.length===0)continue;const publicLabels=labelsFor(block,rows);if(publicLabels===null)continue;const labels=[...group.labels];for(const label of publicLabels)if(!labels.includes(label))labels.push(label);if(labels.length<=32)group.labels=labels}}
    for(const block of blocks){
      const match=block.closest('.c-match[data-matchid]');if(!match)continue;const matchId=bounded(match.getAttribute('data-matchid'),128);if(!matchId)return{catalog:baseCatalog,unsafe:'OWNER_MATCH_ID_INVALID'};
      const matches=records.filter((record)=>record?.matchId===matchId);if(matches.length===0)continue;if(matches.length!==1)return{catalog:baseCatalog,unsafe:'OWNER_RECORD_AMBIGUOUS'};const record=matches[0],represented=representedByRecord.get(record),groups=supplementalByRecord.get(record);if(!represented||!groups)return{catalog:baseCatalog,unsafe:'OWNER_RECORD_UNBOUND'};
      const oddsNodes=Array.from(block.querySelectorAll('.c-odds[data-moid]')).filter((node)=>node.closest('.c-bettype')===block&&!node.closest('.c-match__odds-group')&&!node.closest(privateSelector));
      const byNativeId=new Map();
      for(const node of oddsNodes){const nativeId=bounded(node.getAttribute('data-moid'),128),priceText=bounded(node.textContent,32);if(!nativeId||!priceText)return{catalog:baseCatalog,unsafe:'ODDS_ID_OR_PRICE_INVALID'};if(represented.has(nativeId))continue;let group=byNativeId.get(nativeId);if(!group){group={nativeId,nodes:[],rows:[],types:new Set()};byNativeId.set(nativeId,group)}group.nodes.push(node);if(group.nodes.length>128)return{catalog:baseCatalog,unsafe:'OUTCOME_LIMIT'};const row=node.closest('.c-bettype__row');if(row&&block.contains(row)&&!group.rows.includes(row))group.rows.push(row);const typed=node.closest('[data-bt]');if(typed&&block.contains(typed)){const rawType=normalized(typed.getAttribute('data-bt'));if(/^\\d+$/.test(rawType)&&rawType.length>80)return{catalog:baseCatalog,unsafe:'NATIVE_TYPE_LENGTH'};const nativeType=rawType.length<=80&&/^\\d+$/.test(rawType)?rawType:null;if(nativeType)group.types.add(nativeType);if(group.types.size>1)return{catalog:baseCatalog,unsafe:'NATIVE_TYPE_CONFLICT'}}}
      for(const group of byNativeId.values()){if(groups.some((existing)=>existing.nativeId===group.nativeId))return{catalog:baseCatalog,unsafe:'DUPLICATE_NATIVE_ID_ACROSS_BLOCKS'};const labels=labelsFor(block,group.rows);if(labels===null)return{catalog:baseCatalog,unsafe:'LABEL_LIMIT_OR_LENGTH'};const odds=[];for(const node of group.nodes){const button=node.closest('.c-odds-button'),ownedButton=button&&block.contains(button)?button:null,rawStatus=ownedButton?normalized(ownedButton.getAttribute('data-odds-status')):'',rawGreyed=ownedButton?normalized(ownedButton.getAttribute('data-grey-out')):'';if(rawStatus.length>32||rawGreyed.length>16)return{catalog:baseCatalog,unsafe:'STATUS_OR_GREY_LENGTH'};odds.push({marketOddsId:group.nativeId,priceText:bounded(node.textContent,32),status:rawStatus||null,greyedOut:rawGreyed||null})}groups.push({nativeId:group.nativeId,betTypeIds:[...group.types],labels,odds})}
    }
    for(const record of records){const groups=supplementalByRecord.get(record);if(!groups)continue;if(groups.length+record.groups.length>128)return{catalog:baseCatalog,unsafe:'RECORD_GROUP_LIMIT'};if(groups.length)record.groups=[...record.groups,...groups.map(({nativeId:_,...group})=>group)]}
    let serialized;try{serialized=JSON.stringify(records)}catch{return{catalog:baseCatalog,unsafe:'SERIALIZE_FAILED'}}if(new TextEncoder().encode(serialized).byteLength>20*1024*1024)return{catalog:baseCatalog,unsafe:'PAYLOAD_LIMIT'};
    return{catalog:serialized,unsafe:false};
  })();
  const catalog=supplemental.catalog;
  const more=${ownerMatchId === undefined ? "null" : `(${moreReadExpression(ownerMatchId, token)})`};
  const ownerEvidence=(()=>{if(${ownerMatchId === undefined ? "true" : "false"})return{unmatched:[],ownerGroups:[]};
    const ownerId=${JSON.stringify(ownerMatchId ?? "")},clean=(v,c=64)=>String(v??'').replace(/\\s+/g,' ').trim().slice(0,c),safeClass=(v)=>clean(v).replace(/[^a-z0-9:_-]/giu,'').slice(0,64);
    const owner=Array.from(document.querySelectorAll('.c-match[data-matchid]')).find((node)=>clean(node.getAttribute('data-matchid'),128)===ownerId);if(!owner)return{unmatched:[],ownerGroups:[]};
    let records=[];try{records=JSON.parse(catalog)}catch{return{unmatched:[],ownerGroups:[]}};const record=records.find((value)=>value?.matchId===ownerId),represented=new Set((record?.groups??[]).flatMap((group)=>group?.odds??[]).map((odd)=>clean(odd?.marketOddsId,128)).filter(Boolean));
    const seen=new Set(),result=[];for(const node of owner.querySelectorAll('[data-moid]')){const nativeId=clean(node.getAttribute('data-moid'),128);if(!nativeId||seen.has(nativeId)||represented.has(nativeId))continue;seen.add(nativeId);const classes=Array.from(node.classList).map(safeClass).filter(Boolean).slice(0,12),parentChain=[];let parent=node.parentElement;while(parent&&parent!==owner.parentElement&&parentChain.length<4){parentChain.push({tag:parent.tagName.toLowerCase(),classes:Array.from(parent.classList).map(safeClass).filter(Boolean).slice(0,12)});if(parent===owner)break;parent=parent.parentElement}const typed=node.closest('[data-bt]');result.push({nativeId,nativeType:typed&&owner.contains(typed)?clean(typed.getAttribute('data-bt'),64)||null:null,elementTag:node.tagName.toLowerCase(),elementClasses:classes,parentChain,inOddsGroup:Boolean(node.closest('.c-match__odds-group')),isOdds:node.matches('.c-odds'),priceText:clean(node.textContent,32)});if(result.length>=12)break}
    const ownerGroups=Array.from(owner.querySelectorAll(':scope .c-match__odds-group')).slice(0,64).map((group)=>{const nativeAttributes=[];for(const node of [group,...Array.from(group.querySelectorAll('[data-bt],[data-type],[data-market-type]')).slice(0,16)]){for(const attribute of Array.from(node.attributes)){const name=attribute.name.toLowerCase();if(!/^data-(?:bt|type|market-type)$/.test(name))continue;const value=clean(attribute.value,64).replace(/[^a-z0-9:_.+-]/giu,'');if(value)nativeAttributes.push({name,value});if(nativeAttributes.length>=16)break}if(nativeAttributes.length>=16)break}return{tag:group.tagName.toLowerCase(),classes:Array.from(group.classList).map(safeClass).filter(Boolean).slice(0,12),nativeAttributes,nativeIdCount:new Set(Array.from(group.querySelectorAll('[data-moid]')).map((node)=>clean(node.getAttribute('data-moid'),128)).filter(Boolean)).size}});return{unmatched:result,ownerGroups}})();
  return {probe,metadata,catalog,more,supplementalUnsafe:supplemental.unsafe,...ownerEvidence};
})()`;
};

function parse<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function supplementalUnsafeReason(value: unknown): SupplementalUnsafeReason | "UNCLASSIFIED" {
  return typeof value === "string" && (SUPPLEMENTAL_UNSAFE_REASONS as readonly string[]).includes(value)
    ? value as SupplementalUnsafeReason : "UNCLASSIFIED";
}

function validCatalogRecord(value: unknown): value is SabaCollectorRecord {
  if (!isRecord(value) || value.sportId !== "1" || typeof value.matchId !== "string" ||
    !value.matchId || typeof value.leagueId !== "string" || typeof value.leagueName !== "string" ||
    typeof value.timeText !== "string" || !Array.isArray(value.teamNames) || value.teamNames.length < 2 ||
    !value.teamNames.every((name) => typeof name === "string" && name.length > 0) || !Array.isArray(value.groups)) {
    return false;
  }
  return true;
}

function isMoreUnavailable(value: unknown): value is MoreUnavailable {
  if (!isRecord(value)) return false;
  return value.unavailable === "DOCUMENT_TOKEN_CHANGED" || value.unavailable === "OWNER_ABSENT" ||
    value.unavailable === "CONTROL_ABSENT";
}

function recordIdentity(record: SabaCollectorRecord): string {
  return JSON.stringify([record.sportId, record.leagueId, record.leagueName, record.matchId,
    record.timeText, record.teamNames]);
}

function recordStructure(record: SabaCollectorRecord): string {
  return JSON.stringify(record.groups.map((group) => [group.betTypeIds,
    group.odds.map(({ marketOddsId, lineText }) => [marketOddsId, lineText ?? null])]));
}

function metadataMismatch(expected: readonly RosterMetadataRow[], actual: readonly RosterMetadataRow[],
  controlOverride?: ReadonlyMap<string, RosterMetadataRow["control"]>): MetadataMismatchReason | null {
  const expectedById = new Map(expected.map((row) => [row.matchId, row]));
  const actualById = new Map(actual.map((row) => [row.matchId, row]));
  if (expectedById.size !== expected.length || actualById.size !== actual.length ||
    [...expectedById.keys()].some((matchId) => !actualById.has(matchId))) {
    return "METADATA_MEMBERSHIP";
  }
  for (const [matchId, before] of expectedById) {
    const after = actualById.get(matchId)!;
    if (after.control !== (controlOverride?.get(matchId) ?? before.control)) return "METADATA_CONTROL";
    if (after.timeShape !== before.timeShape) return "METADATA_TIME";
    if (after.kickoffDate.kind !== before.kickoffDate.kind ||
      (after.kickoffDate.kind === "EXPLICIT" && before.kickoffDate.kind === "EXPLICIT" &&
        after.kickoffDate.isoDate !== before.kickoffDate.isoDate)) return "METADATA_DATE";
  }
  return expectedById.size === actualById.size ? null : "METADATA_MEMBERSHIP";
}

function isSafeAppendOnlyRosterGrowth(expected: readonly RosterMetadataRow[],
  actual: readonly RosterMetadataRow[], catalog: readonly SabaCollectorRecord[],
  controlOverride?: ReadonlyMap<string, RosterMetadataRow["control"]>,
  forbiddenAddedMatchIds: ReadonlySet<string> = new Set()): boolean {
  const expectedById = new Map(expected.map((row) => [row.matchId, row]));
  const actualById = new Map(actual.map((row) => [row.matchId, row]));
  if (expectedById.size !== expected.length || actualById.size !== actual.length ||
    actualById.size <= expectedById.size) return false;
  for (const [matchId, before] of expectedById) {
    const after = actualById.get(matchId);
    if (after === undefined || after.control !== (controlOverride?.get(matchId) ?? before.control) ||
      after.timeShape !== before.timeShape ||
      after.kickoffDate.kind !== before.kickoffDate.kind ||
      (after.kickoffDate.kind === "EXPLICIT" && before.kickoffDate.kind === "EXPLICIT" &&
        after.kickoffDate.isoDate !== before.kickoffDate.isoDate)) return false;
  }
  const catalogCounts = new Map<string, number>();
  for (const record of catalog) {
    catalogCounts.set(record.matchId, (catalogCounts.get(record.matchId) ?? 0) + 1);
  }
  for (const [matchId, row] of actualById) {
    if (expectedById.has(matchId)) continue;
    if (forbiddenAddedMatchIds.has(matchId) || row.control === "OPEN_MORE" || row.control === "UNSAFE" ||
      catalogCounts.get(matchId) !== 1) return false;
  }
  return true;
}

function ownerMoreFingerprint(state: MoreState): string {
  const owner = state.relatedRows[0];
  return JSON.stringify([state.controlClasses, owner?.groupCount, owner?.nativeTypes,
    owner?.marketIds, state.panels]);
}

function ownerRowFingerprint(state: MoreState): string {
  const owner = state.relatedRows[0];
  return JSON.stringify([owner?.groupCount, owner?.nativeTypes, owner?.marketIds]);
}

function addedGroupShapes(before: readonly SabaUnrepresentedOwnerGroupShape[],
  after: readonly SabaUnrepresentedOwnerGroupShape[]): readonly SabaUnrepresentedOwnerGroupShape[] {
  const remaining = new Map<string, number>();
  for (const shape of before) {
    const key = JSON.stringify(shape);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const added: SabaUnrepresentedOwnerGroupShape[] = [];
  for (const shape of after) {
    const key = JSON.stringify(shape);
    const count = remaining.get(key) ?? 0;
    if (count > 0) remaining.set(key, count - 1);
    else if (added.length < 8) added.push(shape);
  }
  return added;
}

function boundedCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeEvidence(value: unknown): SabaPeriodUnstablePhaseSummary["activePeriodEvidence"] {
  return value === "TAB_STATE" || value === "FOOTBALL_PAGE_HEADING" || value === "CONFLICT" ||
    value === "NONE" ? value : undefined;
}

function diagnosticHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function periodPhaseSummary(phase: PagePhase): SabaPeriodUnstablePhaseSummary {
  const evidence = safeEvidence(phase.probe.activePeriodEvidence);
  return { actualPeriod: phase.probe.activePeriod,
    ...(evidence === undefined ? {} : { activePeriodEvidence: evidence }),
    tableCount: boundedCount(phase.probe.tableCount),
    publicRosterLength: Array.isArray(phase.probe.rosterMatchIds) ?
      phase.probe.rosterMatchIds.length : 0,
    eligibleMoreCount: boundedCount(phase.probe.eligibleMoreCount),
    metadataPrematchCount: phase.metadata.rows.length,
    probeFingerprintHash: diagnosticHash(phase.probe.fingerprint),
    metadataRowsHash: diagnosticHash(JSON.stringify(phase.metadata.rows)) };
}

function restoreRosterMembershipSummary(phase: PagePhase,
  baselineRows: readonly RosterMetadataRow[]): SabaRestoreRosterMembershipSummary {
  const baselineIds = new Set(baselineRows.map(({ matchId }) => matchId));
  const counts = new Map<string, number>();
  for (const { matchId } of phase.metadata.rows) counts.set(matchId, (counts.get(matchId) ?? 0) + 1);
  const actualIds = new Set(counts.keys());
  const addedMatchIds = [...actualIds].filter((matchId) => !baselineIds.has(matchId)).sort();
  const missingMatchIds = [...baselineIds].filter((matchId) => !actualIds.has(matchId)).sort();
  const duplicateMatchIds = [...counts].filter(([, count]) => count > 1)
    .map(([matchId]) => matchId).sort();
  const controlCounts = { eligibleMore: 0, openMore: 0, noEligibleControl: 0, unsafe: 0 };
  const timeShapeCounts = { datedKickoff: 0, prefixedKickoff: 0, undatedKickoff: 0 };
  const dateCounts = { explicit: 0, unknown: 0 };
  for (const row of phase.metadata.rows) {
    if (row.control === "ELIGIBLE_MORE") controlCounts.eligibleMore += 1;
    else if (row.control === "OPEN_MORE") controlCounts.openMore += 1;
    else if (row.control === "NO_ELIGIBLE_CONTROL") controlCounts.noEligibleControl += 1;
    else controlCounts.unsafe += 1;
    if (row.timeShape === "DATED_KICKOFF") timeShapeCounts.datedKickoff += 1;
    else if (row.timeShape === "PREFIXED_KICKOFF") timeShapeCounts.prefixedKickoff += 1;
    else timeShapeCounts.undatedKickoff += 1;
    if (row.kickoffDate.kind === "EXPLICIT") dateCounts.explicit += 1;
    else dateCounts.unknown += 1;
  }
  return { actualPeriod: phase.probe.activePeriod, rowCount: phase.metadata.rows.length,
    uniqueCount: actualIds.size, addedCount: addedMatchIds.length,
    missingCount: missingMatchIds.length,
    duplicateCount: phase.metadata.rows.length - actualIds.size,
    addedMatchIds: addedMatchIds.slice(0, 16), missingMatchIds: missingMatchIds.slice(0, 16),
    duplicateMatchIds: duplicateMatchIds.slice(0, 16), controlCounts, timeShapeCounts, dateCounts };
}

function changedRosterRows(expected: readonly RosterMetadataRow[], actual: readonly RosterMetadataRow[],
  controlOverride?: ReadonlyMap<string, RosterMetadataRow["control"]>):
NonNullable<SabaRestoreRosterMismatchDiagnostic["changedRows"]> {
  const expectedById = new Map(expected.map((row) => [row.matchId, row]));
  const actualById = new Map(actual.map((row) => [row.matchId, row]));
  const expectedCounts = new Map<string, number>();
  const actualCounts = new Map<string, number>();
  for (const row of expected) expectedCounts.set(row.matchId, (expectedCounts.get(row.matchId) ?? 0) + 1);
  for (const row of actual) actualCounts.set(row.matchId, (actualCounts.get(row.matchId) ?? 0) + 1);
  const sameDate = (left: RosterMetadataRow["kickoffDate"] | undefined,
    right: RosterMetadataRow["kickoffDate"] | undefined): boolean => left?.kind === right?.kind &&
      (left?.kind !== "EXPLICIT" || right?.kind !== "EXPLICIT" || left.isoDate === right.isoDate);
  return [...new Set([...expectedById.keys(), ...actualById.keys()])].sort().flatMap((matchId) => {
    const before = expectedById.get(matchId);
    const after = actualById.get(matchId);
    const timeShapeChanged = before?.timeShape !== after?.timeShape;
    const dateChanged = !sameDate(before?.kickoffDate, after?.kickoffDate);
    const controlChanged = after?.control !== (controlOverride?.get(matchId) ?? before?.control);
    const countChanged = (expectedCounts.get(matchId) ?? 0) !== (actualCounts.get(matchId) ?? 0);
    return !countChanged && !controlChanged && !timeShapeChanged && !dateChanged ? [] : [{ matchId,
      beforeControl: before?.control ?? null, afterControl: after?.control ?? null,
      timeShapeChanged, dateChanged }];
  }).slice(0, 16);
}

class SabaHiddenMarketPageAdapter implements SabaCollectorPageAdapter {
  readonly #binding: SabaCollectorBinding;
  readonly #evaluateRaw: (expression: string) => Promise<unknown>;
  readonly #isCurrent: () => boolean;
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #wait: (delayMs: number) => Promise<void>;
  readonly #deadlineMs: (() => number | undefined) | undefined;
  readonly #onUnrepresentedOwner: ((diagnostic: SabaUnrepresentedOwnerDiagnostic) => void) | undefined;
  readonly #onPeriodUnstable: ((diagnostic: SabaPeriodUnstableDiagnostic) => void) | undefined;
  readonly #onRestoreRosterMismatch: ((diagnostic: SabaRestoreRosterMismatchDiagnostic) => void) | undefined;

  constructor(options: SabaHiddenMarketPageAdapterOptions) {
    this.#binding = { ...options.binding };
    this.#evaluateRaw = options.evaluate;
    this.#isCurrent = options.isCurrent;
    this.#now = options.now ?? Date.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#wait = options.wait ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.#deadlineMs = options.deadlineMs;
    this.#onUnrepresentedOwner = options.onUnrepresentedOwner;
    this.#onPeriodUnstable = options.onPeriodUnstable;
    this.#onRestoreRosterMismatch = options.onRestoreRosterMismatch;
  }

  #operationDeadline(): number {
    return Math.min(this.#now() + OPERATION_TIMEOUT_MS, this.#deadlineMs?.() ?? Number.POSITIVE_INFINITY);
  }

  #assertCurrent(deadline: number): void {
    if (!this.#isCurrent()) throw new Error("SABA_COLLECTOR_SOURCE_STALE");
    if (this.#now() >= deadline) throw new Error("SABA_COLLECTOR_OPERATION_DEADLINE");
  }

  async #evaluate<T>(expression: string, deadline: number): Promise<T> {
    this.#assertCurrent(deadline);
    const raw = await this.#evaluateRaw(expression);
    this.#assertCurrent(deadline);
    const value = parse<T>(raw);
    if (value === null) throw new Error("SABA_COLLECTOR_PAGE_READ_UNAVAILABLE");
    return value;
  }

  async #readPhase(deadline: number, ownerMatchId?: string,
    requireCatalog = true): Promise<PagePhase> {
    const loadingDeadline = Math.min(deadline, this.#now() + PERIOD_SETTLE_MS);
    while (true) {
      const raw = await this.#evaluate<{ probe?: ProbeState | null; metadata?: RosterMetadata;
        catalog: unknown; more: MoreState | MoreUnavailable | null;
        supplementalUnsafe?: boolean | string;
        unmatched: readonly SabaUnrepresentedOwnerOddsShape[];
        ownerGroups: readonly SabaUnrepresentedOwnerGroupShape[] }>(
        pagePhaseExpression(this.#binding.documentKey, ownerMatchId, requireCatalog), deadline);
      const metadata = raw.metadata;
      const probe = raw.probe;
      if (metadata?.documentToken !== this.#binding.documentKey ||
        probe !== null && probe !== undefined && probe.documentToken !== this.#binding.documentKey) {
        throw new Error("SABA_COLLECTOR_DOCUMENT_CHANGED");
      }
      if (probe === null || probe === undefined) {
        const remaining = loadingDeadline - this.#now();
        if (remaining <= 0) throw new Error("SABA_COLLECTOR_PAGE_NOT_READY");
        await this.#wait(Math.min(STABLE_MS, remaining));
        if (!this.#isCurrent()) throw new Error("SABA_COLLECTOR_SOURCE_STALE");
        if (this.#now() >= loadingDeadline) throw new Error("SABA_COLLECTOR_PAGE_NOT_READY");
        continue;
      }
      if (!Array.isArray(metadata.rows)) throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
      if (requireCatalog && raw.supplementalUnsafe !== false && raw.supplementalUnsafe !== undefined) {
        throw new Error(`SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_${
          supplementalUnsafeReason(raw.supplementalUnsafe)}`);
      }
      const catalog = parse<unknown[]>(raw.catalog);
      if (!Array.isArray(catalog) || (requireCatalog && !catalog.every(validCatalogRecord))) {
        throw new Error("SABA_COLLECTOR_CATALOG_INVALID");
      }
      return { probe, metadata, catalog: catalog.filter(validCatalogRecord), more: raw.more,
        unmatched: Array.isArray(raw.unmatched) ? raw.unmatched.slice(0, 12) : [],
        ownerGroups: Array.isArray(raw.ownerGroups) ? raw.ownerGroups.slice(0, 64) : [] };
    }
  }

  #moreFromPhase(phase: PagePhase, ownerMatchId: string): MoreState {
    const value = phase.more;
    if (isMoreUnavailable(value)) throw new Error(`SABA_COLLECTOR_MORE_${value.unavailable}`);
    if (value === null || value.ownerMatchId !== ownerMatchId || value.relatedRows.length === 0 ||
      value.relatedRows[0]?.matchId !== ownerMatchId) {
      throw new Error("SABA_COLLECTOR_MORE_OWNERSHIP_UNPROVEN");
    }
    return value;
  }

  #assertPeriodPhase(phase: PagePhase, period: SabaCollectorPeriod): void {
    if (phase.probe.activePeriod !== period) throw new Error("SABA_COLLECTOR_PERIOD_CHANGED");
  }

  async #settlePeriod(period: SabaCollectorPeriod, deadline: number,
    ownerMatchId?: string, requireCatalog = true): Promise<StablePhase> {
    const startedAt = this.#now();
    let readCount = 0;
    const finalPhases: SabaPeriodUnstablePhaseSummary[] = [];
    const recordPhase = (value: PagePhase): void => {
      readCount += 1;
      finalPhases.push(periodPhaseSummary(value));
      if (finalPhases.length > 3) finalPhases.shift();
    };
    let phase = await this.#readPhase(deadline, ownerMatchId, requireCatalog);
    recordPhase(phase);
    const pageDeadlineMs = this.#pageDeadline(phase.probe, deadline);
    if (phase.probe.activePeriod === "UNKNOWN") {
      throw new Error("SABA_COLLECTOR_PERIOD_SELECTION_UNCONFIRMED");
    }
    if (phase.metadata.rows.some((row) => row.control === "UNSAFE")) {
      throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
    }
    if (phase.probe.activePeriod !== period) {
      const selected = await this.#evaluate<boolean>(periodClickExpression(
        period === "TODAY" ? "today" : "early", this.#binding.documentKey, pageDeadlineMs), deadline);
      if (selected !== true) throw new Error("SABA_COLLECTOR_PERIOD_ACTION_UNCONFIRMED");
      phase = await this.#readPhase(deadline, ownerMatchId, requireCatalog);
      recordPhase(phase);
    }
    const ownerPreparation = (value: PagePhase): { readonly fingerprint: string } |
      { readonly reason: "OWNER_ABSENT" | "CONTROL_NOT_ELIGIBLE" |
        "FINGERPRINT_UNSTABLE" } => {
      const rows = value.metadata.rows.filter(({ matchId }) => matchId === ownerMatchId);
      if (rows.length > 1) throw new Error("SABA_COLLECTOR_MORE_PREP_OWNER_AMBIGUOUS");
      const row = rows[0];
      if (row === undefined) return { reason: "OWNER_ABSENT" };
      if (row.control === "UNSAFE" || row.control === "OPEN_MORE") {
        throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
      }
      if (row.control !== "ELIGIBLE_MORE") return { reason: "CONTROL_NOT_ELIGIBLE" };
      const more = value.more;
      if (more === null || isMoreUnavailable(more) || more.ownerMatchId !== ownerMatchId ||
        more.relatedRows.length === 0 || more.relatedRows[0]?.matchId !== ownerMatchId) {
        return { reason: "FINGERPRINT_UNSTABLE" };
      }
      if (more.panels.length >= 8 || !more.controlClasses.includes("c-is-close") ||
        more.controlClasses.includes("c-is-open")) {
        throw new Error("SABA_COLLECTOR_MORE_NOT_CLOSED");
      }
      return { fingerprint: ownerMoreFingerprint(more) };
    };
    const settleDeadline = Math.min(deadline, this.#now() + PERIOD_SETTLE_MS);
    let first = phase.probe.activePeriod === period ? phase : null;
    let firstOwner = first !== null && ownerMatchId !== undefined ? ownerPreparation(first) : null;
    let ownerPreparationReason: SabaPeriodUnstableDiagnostic["ownerPreparationReason"];
    if (firstOwner !== null && "reason" in firstOwner) ownerPreparationReason = firstOwner.reason;
    while (this.#now() < settleDeadline) {
      const remaining = settleDeadline - this.#now();
      if (remaining < STABLE_MS) break;
      await this.#wait(STABLE_MS);
      this.#assertCurrent(deadline);
      const second = await this.#readPhase(deadline, ownerMatchId, requireCatalog);
      recordPhase(second);
      if (second.metadata.rows.some((row) => row.control === "UNSAFE")) {
        throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
      }
      const secondOwner = second.probe.activePeriod === period && ownerMatchId !== undefined ?
        ownerPreparation(second) : null;
      if (secondOwner !== null && "reason" in secondOwner) {
        ownerPreparationReason = secondOwner.reason;
      } else if (secondOwner !== null) {
        ownerPreparationReason = "FINGERPRINT_UNSTABLE";
      }
      if (first !== null && second.probe.activePeriod === period &&
        first.probe.fingerprint === second.probe.fingerprint &&
        (ownerMatchId === undefined ||
          (firstOwner !== null && !("reason" in firstOwner) && secondOwner !== null &&
            !("reason" in secondOwner) &&
            JSON.stringify(first.metadata.rows) === JSON.stringify(second.metadata.rows) &&
            firstOwner.fingerprint === secondOwner.fingerprint))) {
        return { first, second };
      }
      first = second.probe.activePeriod === period ? second : null;
      firstOwner = first !== null && ownerMatchId !== undefined ? secondOwner : null;
    }
    const equalHashes = (key: "probeFingerprintHash" | "metadataRowsHash"): boolean =>
      finalPhases.every((value) => value[key] === finalPhases[0]?.[key]);
    const elapsed = this.#now() - startedAt;
    try {
      this.#onPeriodUnstable?.({ expectedPeriod: period, readCount,
        elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ?
          Math.min(elapsed, Number.MAX_SAFE_INTEGER) : 0,
        fingerprintSame: equalHashes("probeFingerprintHash"),
        metadataSame: equalHashes("metadataRowsHash"),
        ...(ownerMatchId !== undefined && ownerPreparationReason !== undefined ?
          { ownerPreparationReason } : {}),
        finalPhases: [...finalPhases] });
    } catch { /* diagnostic-only */ }
    if (ownerMatchId !== undefined && ownerPreparationReason !== undefined &&
      finalPhases.length > 0 && finalPhases.every(({ actualPeriod }) => actualPeriod === period)) {
      if (ownerPreparationReason === "CONTROL_NOT_ELIGIBLE") {
        throw new Error("SABA_COLLECTOR_MORE_PREP_CONTROL_NOT_ELIGIBLE");
      }
      throw new Error("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
    }
    throw new Error("SABA_COLLECTOR_PERIOD_NOT_STABLE");
  }

  #pageDeadline(state: ProbeState, deadline: number): number | undefined {
    return typeof state.pageNowMs === "number" ?
      state.pageNowMs + Math.max(0, deadline - this.#now()) : undefined;
  }

  #reportRestoreRosterMismatch(phase: "OPEN" | "RESTORE", reason: MetadataMismatchReason,
    period: SabaCollectorPeriod, ownerMatchId: string,
    baseline: PagePhase, first: PagePhase | null, final: PagePhase | null,
    controlOverride?: ReadonlyMap<string, RosterMetadataRow["control"]>): void {
    try {
      this.#onRestoreRosterMismatch?.({ binding: { ...this.#binding }, period, ownerMatchId, phase,
        reason, capturedAtMs: this.#now(),
        capturedMonotonicMs: this.#monotonicNow(),
        changedRows: changedRosterRows(baseline.metadata.rows, final?.metadata.rows ?? [], controlOverride),
        baseline: restoreRosterMembershipSummary(baseline, baseline.metadata.rows),
        restoredReads: {
          first: first === null ? null : restoreRosterMembershipSummary(first, baseline.metadata.rows),
          final: final === null ? null : restoreRosterMembershipSummary(final, baseline.metadata.rows)
        } });
    } catch { /* diagnostic-only */ }
  }

  async readRoster(period: SabaCollectorPeriod): Promise<SabaCollectorRosterResult> {
    const deadline = this.#operationDeadline();
    const stable = await this.#settlePeriod(period, deadline);
    this.#assertPeriodPhase(stable.second, period);
    const before = stable.first.metadata;
    const after = stable.second.metadata;
    if ([...before.rows, ...after.rows].some((row) =>
      row.control === "UNSAFE" || row.control === "OPEN_MORE")) {
      throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
    }
    const values = stable.second.catalog;
    const capturedAtMs = this.#now();
    const capturedMonotonicMs = this.#monotonicNow();
    if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
      throw new Error("SABA_COLLECTOR_ROSTER_CHANGED_DURING_READ");
    }
    const records = new Map<string, SabaCollectorRecord>();
    const rosterIds = new Set(before.rows.map(({ matchId }) => matchId));
    for (const value of values) {
      if (!validCatalogRecord(value) || !rosterIds.has(value.matchId)) continue;
      if (records.has(value.matchId)) throw new Error("SABA_COLLECTOR_DUPLICATE_RECORD");
      records.set(value.matchId, value);
    }
    if (records.size !== rosterIds.size || rosterIds.size !== before.rows.length) {
      throw new Error("SABA_COLLECTOR_ROSTER_RECORD_MISMATCH");
    }
    const owners: SabaCollectorRosterOwner[] = before.rows.map((row) => ({
      ownerMatchId: row.matchId, record: records.get(row.matchId)!,
      control: row.control as "ELIGIBLE_MORE" | "NO_ELIGIBLE_CONTROL",
      kickoffDate: row.kickoffDate, capturedAtMs, capturedMonotonicMs
    }));
    return { binding: { ...this.#binding }, period, selectedPrematch: true, owners };
  }

  async captureOwner(period: SabaCollectorPeriod,
    owner: SabaCollectorRosterOwner): Promise<SabaCollectorOwnerCaptureResult> {
    if (owner.control !== "ELIGIBLE_MORE" || owner.ownerMatchId !== owner.record.matchId) {
      throw new Error("SABA_COLLECTOR_OWNER_INPUT_UNSAFE");
    }
    const deadline = this.#operationDeadline();
    let baselineStable: StablePhase;
    try {
      baselineStable = await this.#settlePeriod(period, deadline, owner.ownerMatchId);
    } catch (error) {
      if (error instanceof Error && error.message === "SABA_COLLECTOR_OPERATION_DEADLINE" &&
        this.#isCurrent()) {
        throw new Error("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
      }
      throw error;
    }
    const baselinePhase = baselineStable.second;
    this.#assertPeriodPhase(baselinePhase, period);
    const baselineMetadata = baselinePhase.metadata;
    if (JSON.stringify(baselineStable.first.metadata.rows) !== JSON.stringify(baselineMetadata.rows) ||
      baselineMetadata.rows.some((row) => row.control === "UNSAFE" || row.control === "OPEN_MORE")) {
      throw new Error("SABA_COLLECTOR_ROSTER_UNSAFE");
    }
    if (baselineMetadata.rows.find(({ matchId }) => matchId === owner.ownerMatchId)?.control !==
      "ELIGIBLE_MORE") throw new Error("SABA_COLLECTOR_MORE_PREP_CONTROL_NOT_ELIGIBLE");
    const before = this.#moreFromPhase(baselinePhase, owner.ownerMatchId);
    const firstBefore = this.#moreFromPhase(baselineStable.first, owner.ownerMatchId);
    if (ownerMoreFingerprint(firstBefore) !== ownerMoreFingerprint(before)) {
      throw new Error("SABA_COLLECTOR_MORE_PREP_FINGERPRINT_UNSTABLE");
    }
    if (before.panels.length >= 8 || !before.controlClasses.includes("c-is-close") ||
      before.controlClasses.includes("c-is-open")) {
      throw new Error("SABA_COLLECTOR_MORE_NOT_CLOSED");
    }
    const baselineCatalog = baselinePhase.catalog;
    const baselineMatches = baselineCatalog.filter(({ matchId }) => matchId === owner.ownerMatchId);
    if (baselineMatches.length !== 1) throw new Error("SABA_COLLECTOR_OWNER_RECORD_UNCONFIRMED");
    const baselineRecord = baselineMatches[0]!;
    if (recordIdentity(baselineRecord) !== recordIdentity(owner.record)) {
      throw new Error("SABA_COLLECTOR_OWNER_IDENTITY_CHANGED");
    }
    const pageDeadlineMs = this.#pageDeadline(baselinePhase.probe, deadline);
    let actionAttempted = false;
    let pendingError: unknown;
    let result: SabaCollectorOwnerCaptureResult | null = null;
    let capturedPhase: PagePhase | null = null;
    let unrepresentedDiagnostic: SabaUnrepresentedOwnerDiagnostic | null = null;
    try {
      actionAttempted = true;
      const clicked = await this.#evaluate<boolean>(moreClickExpression(owner.ownerMatchId,
        this.#binding.documentKey, false, pageDeadlineMs), deadline);
      if (clicked !== true) throw new Error("SABA_COLLECTOR_MORE_OPEN_UNCONFIRMED");
      const settleDeadline = Math.min(deadline, this.#now() + PERIOD_SETTLE_MS);
      let firstOpen: PagePhase | null = null;
      let openedStable: StablePhase | null = null;
      let discoveryWaitMs = STABLE_MS;
      let closedReads = 0;
      while (this.#now() < settleDeadline) {
        const phase = await this.#readPhase(deadline, owner.ownerMatchId);
        this.#assertPeriodPhase(phase, period);
        const state = this.#moreFromPhase(phase, owner.ownerMatchId);
        const isOpen = state.controlClasses.includes("c-is-open") &&
          !state.controlClasses.includes("c-is-close");
        if (!isOpen) {
          firstOpen = null;
          closedReads += 1;
        } else if (state.panels.length >= 8 || JSON.stringify(state.panels) !== JSON.stringify(before.panels)) {
          throw new Error("SABA_COLLECTOR_PANEL_OWNERSHIP_UNPROVEN");
        } else if (firstOpen !== null && ownerMoreFingerprint(
          this.#moreFromPhase(firstOpen, owner.ownerMatchId)) === ownerMoreFingerprint(state) &&
          JSON.stringify(firstOpen.metadata.rows) === JSON.stringify(phase.metadata.rows)) {
          openedStable = { first: firstOpen, second: phase };
          break;
        } else {
          firstOpen = phase;
          discoveryWaitMs = STABLE_MS;
        }
        const remaining = settleDeadline - this.#now();
        const waitMs = firstOpen === null ? discoveryWaitMs : STABLE_MS;
        if (remaining < Math.min(waitMs, STABLE_MS)) break;
        await this.#wait(Math.min(waitMs, remaining));
        if (firstOpen === null && closedReads >= 2) {
          discoveryWaitMs = Math.min(discoveryWaitMs * 2, 8_000);
        }
        this.#assertCurrent(deadline);
      }
      if (openedStable === null) {
        throw new Error("SABA_COLLECTOR_MORE_OPEN_NOT_STABLE");
      }
      capturedPhase = openedStable.second;
      const opened = this.#moreFromPhase(openedStable.first, owner.ownerMatchId);
      const confirmedOpen = this.#moreFromPhase(capturedPhase, owner.ownerMatchId);
      const capturedCatalog = capturedPhase.catalog;
      const capturedAtMs = this.#now();
      const capturedMonotonicMs = this.#monotonicNow();
      const openedMetadata = capturedPhase.metadata;
      const baselineRosterIds = baselineMetadata.rows.map(({ matchId }) => matchId);
      const openControlOverride = new Map<string, RosterMetadataRow["control"]>([
        [owner.ownerMatchId, "OPEN_MORE"]
      ]);
      const openMetadataMismatch = metadataMismatch(baselineMetadata.rows,
        openedMetadata.rows, openControlOverride);
      if (openMetadataMismatch !== null) {
        const acceptedGrowth = openMetadataMismatch === "METADATA_MEMBERSHIP" &&
          isSafeAppendOnlyRosterGrowth(baselineMetadata.rows, openedMetadata.rows,
            capturedCatalog, openControlOverride,
            new Set(confirmedOpen.relatedRows.slice(1).map(({ matchId }) => matchId)));
        if (!acceptedGrowth) {
          this.#reportRestoreRosterMismatch("OPEN", openMetadataMismatch, period,
            owner.ownerMatchId, baselinePhase, openedStable.first, capturedPhase, openControlOverride);
          throw new Error(`SABA_COLLECTOR_ALTERNATE_ROW_OWNERSHIP_UNPROVEN_${openMetadataMismatch}`);
        }
      }
      const rosterIds = new Set(baselineRosterIds);
      const baselineIds = baselineCatalog.filter(({ matchId }) => rosterIds.has(matchId))
        .map(({ matchId }) => matchId).sort();
      const capturedIds = capturedCatalog.filter(({ matchId }) => rosterIds.has(matchId))
        .map(({ matchId }) => matchId).sort();
      if (JSON.stringify(capturedIds) !== JSON.stringify(baselineIds) ||
        baselineIds.length !== rosterIds.size) throw new Error("SABA_COLLECTOR_ROSTER_RECORD_MISMATCH");
      const capturedMatches = capturedCatalog.filter(({ matchId }) => matchId === owner.ownerMatchId);
      if (capturedMatches.length !== 1) throw new Error("SABA_COLLECTOR_OWNER_RECORD_UNCONFIRMED");
      const capturedRecord = capturedMatches[0]!;
      const firstCapturedMatches = openedStable.first.catalog
        .filter(({ matchId }) => matchId === owner.ownerMatchId);
      if (!confirmedOpen.controlClasses.includes("c-is-open") ||
        ownerMoreFingerprint(confirmedOpen) !== ownerMoreFingerprint(opened) ||
        firstCapturedMatches.length !== 1 ||
        recordStructure(firstCapturedMatches[0]!) !== recordStructure(capturedRecord) ||
        recordIdentity(capturedRecord) !== recordIdentity(baselineRecord)) {
        throw new Error("SABA_COLLECTOR_MORE_CAPTURE_UNSTABLE");
      }
      const moreStructureChanged = ownerRowFingerprint(opened) !== ownerRowFingerprint(before);
      const structuralChange = recordStructure(capturedRecord) !== recordStructure(baselineRecord);
      if (moreStructureChanged && !structuralChange) {
        const beforeOwner = before.relatedRows[0]!;
        const afterOwner = confirmedOpen.relatedRows[0]!;
        const beforeNativeIds = new Set(beforeOwner.marketIds);
        const addedNativeIds = [...new Set(afterOwner.marketIds)]
          .filter((nativeId) => !beforeNativeIds.has(nativeId)).slice(0, 32);
        const catalogNativeIds = new Set(capturedRecord.groups.flatMap((group) =>
          group.odds.map(({ marketOddsId }) => marketOddsId)));
        unrepresentedDiagnostic = { binding: { ...this.#binding }, period,
          ownerMatchId: owner.ownerMatchId, capturedAtMs, capturedMonotonicMs,
          reason: addedNativeIds.length > 0 ? "ADDED_NATIVE_IDS" :
            beforeOwner.groupCount !== afterOwner.groupCount ? "GROUP_COUNT_CHANGED" :
              JSON.stringify(beforeOwner.nativeTypes) !== JSON.stringify(afterOwner.nativeTypes) &&
              JSON.stringify([...new Set(beforeOwner.nativeTypes)].sort()) ===
                JSON.stringify([...new Set(afterOwner.nativeTypes)].sort()) ?
                "NATIVE_TYPE_ORDER_CHANGED" :
                JSON.stringify(beforeOwner.nativeTypes) !== JSON.stringify(afterOwner.nativeTypes) ?
                  "NATIVE_TYPES_CHANGED" : "OWNER_STRUCTURE_CHANGED",
          before: { groupCount: beforeOwner.groupCount,
            nativeTypes: beforeOwner.nativeTypes.slice(0, 32),
            nativeIdCount: new Set(beforeOwner.marketIds).size },
          after: { groupCount: afterOwner.groupCount,
            nativeTypes: afterOwner.nativeTypes.slice(0, 32),
            nativeIdCount: new Set(afterOwner.marketIds).size,
            addedNativeIds },
          catalog: { groupCount: capturedRecord.groups.length,
            nativeIdCount: catalogNativeIds.size }, unmatched: capturedPhase.unmatched.slice(0, 12),
          addedGroupShapes: addedGroupShapes(baselinePhase.ownerGroups, capturedPhase.ownerGroups) };
        throw new Error("SABA_COLLECTOR_OWNER_STRUCTURE_UNCAPTURED");
      }
      result = { binding: { ...this.#binding }, period, ownerMatchId: owner.ownerMatchId,
        controlOpened: true, terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: structuralChange ? "OWNER_GROUPS_EXPANDED" : "NO_STRUCTURAL_CHANGE",
        ...(structuralChange ? { capture: { record: capturedRecord, kickoffDate: owner.kickoffDate,
          capturedAtMs, capturedMonotonicMs } } : {}) };
    } catch (error) {
      pendingError = error;
    }

    if (actionAttempted) {
      try {
        const currentPhase = pendingError === undefined && capturedPhase !== null ? capturedPhase :
          await this.#readPhase(deadline, owner.ownerMatchId);
        this.#assertPeriodPhase(currentPhase, period);
        const current = this.#moreFromPhase(currentPhase, owner.ownerMatchId);
        let firstRestored: PagePhase | null = null;
        if (current.controlClasses.includes("c-is-open")) {
          const clicked = await this.#evaluate<boolean>(moreClickExpression(owner.ownerMatchId,
            this.#binding.documentKey, true, pageDeadlineMs), deadline);
          if (clicked !== true) throw new Error("SABA_COLLECTOR_MORE_RESTORE_ACTION_UNCONFIRMED");
        }
        const restoreDeadline = Math.min(deadline, this.#now() + PERIOD_SETTLE_MS);
        let restoredStable: StablePhase | null = null;
        while (this.#now() < restoreDeadline) {
          const restoredPhase = await this.#readPhase(deadline, owner.ownerMatchId);
          this.#assertPeriodPhase(restoredPhase, period);
          const restored = this.#moreFromPhase(restoredPhase, owner.ownerMatchId);
          if (ownerMoreFingerprint(restored) === ownerMoreFingerprint(before) &&
            restored.controlClasses.includes("c-is-close") && !restored.controlClasses.includes("c-is-open")) {
            const selfMismatch = metadataMismatch(restoredPhase.metadata.rows, restoredPhase.metadata.rows);
            if (selfMismatch === "METADATA_MEMBERSHIP") {
              this.#reportRestoreRosterMismatch("RESTORE", selfMismatch, period, owner.ownerMatchId,
                baselinePhase, firstRestored, restoredPhase);
              throw new Error(`SABA_COLLECTOR_MORE_RESTORE_${selfMismatch}`);
            }
            if (firstRestored !== null &&
              metadataMismatch(firstRestored.metadata.rows, restoredPhase.metadata.rows) === null) {
              restoredStable = { first: firstRestored, second: restoredPhase };
              break;
            }
            firstRestored = restoredPhase;
          } else {
            firstRestored = null;
          }
          const remaining = restoreDeadline - this.#now();
          if (remaining < STABLE_MS) break;
          await this.#wait(STABLE_MS);
          this.#assertCurrent(deadline);
        }
        if (restoredStable === null) {
          throw new Error("SABA_COLLECTOR_MORE_RESTORE_UNCONFIRMED");
        }
        const restoredMetadata = restoredStable.second.metadata;
        const restoredMetadataMismatch = metadataMismatch(baselineMetadata.rows, restoredMetadata.rows);
        if (restoredMetadataMismatch !== null) {
          const acceptedGrowth = restoredMetadataMismatch === "METADATA_MEMBERSHIP" &&
            isSafeAppendOnlyRosterGrowth(baselineMetadata.rows, restoredMetadata.rows,
              restoredStable.second.catalog);
          if (!acceptedGrowth) {
            this.#reportRestoreRosterMismatch("RESTORE", restoredMetadataMismatch, period,
              owner.ownerMatchId, baselinePhase, restoredStable.first, restoredStable.second);
            throw new Error(`SABA_COLLECTOR_MORE_RESTORE_${restoredMetadataMismatch}`);
          }
        }
        const restoredCatalog = restoredStable.second.catalog;
        const rosterIds = new Set(baselineMetadata.rows.map(({ matchId }) => matchId));
        if (JSON.stringify(restoredCatalog.filter(({ matchId }) => rosterIds.has(matchId))
          .map(({ matchId }) => matchId).sort()) !==
          JSON.stringify(baselineCatalog.filter(({ matchId }) => rosterIds.has(matchId))
            .map(({ matchId }) => matchId).sort())) {
          throw new Error("SABA_COLLECTOR_MORE_RESTORE_CATALOG_MEMBERSHIP");
        }
        const restoredMatches = restoredCatalog.filter(({ matchId }) => matchId === owner.ownerMatchId);
        if (restoredMatches.length !== 1 ||
          recordIdentity(restoredMatches[0]!) !== recordIdentity(baselineRecord) ||
          recordStructure(restoredMatches[0]!) !== recordStructure(baselineRecord)) {
          throw new Error("SABA_COLLECTOR_MORE_RESTORE_IDENTITY_MISMATCH");
        }
      } catch (restoreError) {
        throw restoreError;
      }
    }
    if (unrepresentedDiagnostic !== null) {
      try { this.#onUnrepresentedOwner?.(unrepresentedDiagnostic); } catch { /* diagnostic-only */ }
    }
    if (pendingError !== undefined) throw pendingError;
    if (result === null) throw new Error("SABA_COLLECTOR_MORE_CAPTURE_UNCONFIRMED");
    return result;
  }

  async restoreToday(): Promise<SabaCollectorTodayRestoreResult> {
    const deadline = this.#operationDeadline();
    const stable = await this.#settlePeriod("TODAY", deadline, undefined, false);
    const metadata = stable.second.metadata;
    if (stable.second.probe.activePeriod !== "TODAY" || !Array.isArray(metadata.rows) ||
      JSON.stringify(stable.first.metadata.rows) !== JSON.stringify(metadata.rows) ||
      metadata.rows.some(({ control }) => control === "OPEN_MORE" || control === "UNSAFE")) {
      throw new Error("SABA_COLLECTOR_TODAY_RESTORE_UNCONFIRMED");
    }
    const rosterMatchIds = metadata.rows.map(({ matchId }) => matchId);
    if (new Set(rosterMatchIds).size !== rosterMatchIds.length) {
      throw new Error("SABA_COLLECTOR_TODAY_ROSTER_AMBIGUOUS");
    }
    return { binding: { ...this.#binding }, selectedPrematch: true, rosterMatchIds };
  }
}

export function createSabaHiddenMarketPageAdapter(
  options: SabaHiddenMarketPageAdapterOptions
): SabaCollectorPageAdapter {
  return new SabaHiddenMarketPageAdapter(options);
}
