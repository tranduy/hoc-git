import { footballBinaryMarketSpec, footballCategoricalMarketSpec, isFootballCategoricalSelection,
  type MarketType, type ProviderQuote } from "@tool-chenh/contracts";
import type { ComparisonCell } from "./comparison.js";
const supported = new Set<MarketType>(["FT_EUROPEAN_HANDICAP","FH_EUROPEAN_HANDICAP","CORNER_FT_EUROPEAN_HANDICAP",
  "CORNER_FT_1X2","CORNER_FH_1X2","FT_FINAL_SCORE_AH","FT_RESULT_BTTS","FT_DOUBLE_CHANCE_BTTS","FT_RESULT_OR_BTTS"]);
const rangeTotals: Partial<Record<MarketType, MarketType>> = {
  FT_GOAL_RANGE:"FT_TOTAL", FH_GOAL_RANGE:"FH_TOTAL", SH_GOAL_RANGE:"SH_TOTAL",
  HOME_FT_GOAL_RANGE:"HOME_FT_TOTAL", AWAY_FT_GOAL_RANGE:"AWAY_FT_TOTAL",
  HOME_FH_GOAL_RANGE:"HOME_FH_TOTAL", AWAY_FH_GOAL_RANGE:"AWAY_FH_TOTAL",
  CORNER_FT_RANGE:"CORNER_FT_TOTAL", CORNER_FH_RANGE:"CORNER_FH_TOTAL",
  HOME_CORNER_FT_RANGE:"HOME_CORNER_FT_TOTAL", AWAY_CORNER_FT_RANGE:"AWAY_CORNER_FT_TOTAL"
};
const scorelessTotals: Partial<Record<MarketType, MarketType>> = {
  FT_CORRECT_SCORE:"FT_TOTAL", FH_CORRECT_SCORE:"FH_TOTAL", SH_CORRECT_SCORE:"SH_TOTAL",
  CORNER_FT_CORRECT_SCORE:"CORNER_FT_TOTAL", CORNER_FH_CORRECT_SCORE:"CORNER_FH_TOTAL"
};

/** Alternative comparison predicates; source identities and receipts remain native. */
export function footballComparisonEquivalents(cell:ComparisonCell,
  observedComparableLines:readonly string[]=[]):readonly ComparisonCell[] {
  const market=cell.market,type=market.marketType;
  const binarySpec=footballBinaryMarketSpec(type);
  const crossLineTotal=binarySpec?.family==="TOTAL"&&observedComparableLines.length>0;
  if((!supported.has(type)&&!rangeTotals[type]&&!scorelessTotals[type]&&!crossLineTotal)||market.category!=="FOOTBALL"||market.player!==undefined||market.status!=="OPEN")return [];
  const spec=binarySpec??footballCategoricalMarketSpec(type);
  if(spec===null||spec.scope!==market.scope||spec.settlementProfile!==market.settlementProfile||
    new Set(cell.quotes.map(q=>q.providerSelectionId)).size!==cell.quotes.length||
    new Set(cell.quotes.map(q=>q.selection)).size!==cell.quotes.length||
    new Set(cell.quotes.map(q=>q.sequence)).size!==1||cell.quotes.some(q=>q.provider!==cell.provider||q.category!==market.category||
      q.providerEventId!==market.providerEventId||q.providerMarketId!==market.providerMarketId||q.marketType!==type||
      q.scope!==market.scope||q.line!==market.line||q.player!==undefined||q.sequence==null||
      !(footballBinaryMarketSpec(type)?.outcomes.includes(q.selection as never)??isFootballCategoricalSelection(type,q.selection))))return [];
  const prematch=cell.sourceEvent?.isLive===false&&cell.quotes.every(q=>q.isLive===false);
  const groups=new Map<string,ComparisonCell>();
  const add=(target:MarketType,line:string|null,quote:ProviderQuote,selection=quote.selection)=>{
    if(quote.status!=="OPEN")return;
    const targetSpec=footballBinaryMarketSpec(target)!;
    const key=JSON.stringify([target,line]);
    const projected={...quote,marketType:target,line,selection};
    const existing=groups.get(key);
    groups.set(key,existing?{...existing,quotes:[...existing.quotes,projected]}:{...cell,
      market:{...market,marketType:target,line,settlementProfile:targetSpec.settlementProfile},quotes:[projected],
      sourceMarket:cell.sourceMarket??market,sourceQuotes:cell.sourceQuotes??cell.quotes});
  };
  const european:Partial<Record<MarketType,MarketType>>={FT_EUROPEAN_HANDICAP:"FT_AH",FH_EUROPEAN_HANDICAP:"FH_AH",CORNER_FT_EUROPEAN_HANDICAP:"CORNER_FT_AH"};
  const cornerResult:Partial<Record<MarketType,MarketType>>={CORNER_FT_1X2:"CORNER_FT_AH",CORNER_FH_1X2:"CORNER_FH_AH"};
  if(rangeTotals[type]&&prematch&&market.line===null){
    // Counts are nonnegative integers. Only a complete lower or upper tail
    // equals a no-push total; a bounded interior bucket does not.
    for(const q of cell.quotes){
      const range=/^RANGE_(\d+)_(\d+|PLUS)$/u.exec(q.selection);
      if(!range)continue;
      const lower=Number(range[1]);
      if(lower===0&&range[2]!=="PLUS")add(rangeTotals[type]!,String(Number(range[2])+0.5),q,"UNDER");
      else if(lower>0&&range[2]==="PLUS")add(rangeTotals[type]!,String(lower-0.5),q,"OVER");
    }
  }else if(scorelessTotals[type]&&prematch&&market.line===null){
    for(const q of cell.quotes)if(q.selection==="SCORE_0_0")add(scorelessTotals[type]!,"0.5",q,"UNDER");
  }else if(european[type]&&prematch&&market.line!==null&&/^-?(?:0|[1-9]\d*)$/u.test(market.line)&&Number.isSafeInteger(Number(market.line))){
    for(const q of cell.quotes)if(q.selection==="HOME"||q.selection==="AWAY")
      add(european[type]!,String(Number(market.line)+(q.selection==="HOME"?-0.5:0.5)),q);
  }else if(cornerResult[type]&&prematch&&market.line===null){
    // With integer corner counts, HOME wins is exactly HOME -0.5 and AWAY
    // wins is exactly AWAY -0.5 (the canonical HOME line is therefore +0.5).
    for(const q of cell.quotes)if(q.selection==="HOME"||q.selection==="AWAY")
      add(cornerResult[type]!,q.selection==="HOME"?"-0.5":"0.5",q);
  }else if(binarySpec?.family==="TOTAL"&&prematch&&market.line!==null){
    // An OVER at a lower threshold always pays at least as much as an OVER at
    // a higher threshold. Projecting only that leg is conservative at every
    // integer outcome and exposes safe middle/push coverage against UNDER at
    // a higher line without inventing a provider price.
    const sourceLine=Number(market.line);
    for(const targetLine of [...new Set(observedComparableLines)].sort((a,b)=>Number(a)-Number(b))){
      const target=Number(targetLine);
      if(!Number.isSafeInteger(target*4)||!Number.isFinite(sourceLine)||target<=sourceLine)continue;
      for(const q of cell.quotes)if(q.selection==="OVER")add(type,String(target),q);
    }
  }else if(type==="FT_FINAL_SCORE_AH"&&prematch&&market.line!==null&&/^-?(?:0|[1-9]\d*)\.5$/u.test(market.line)){
    for(const q of cell.quotes)add("FT_AH",market.line,q);
  }else if(type==="FT_RESULT_BTTS"&&market.line===null){
    for(const q of cell.quotes){
      if(q.selection==="HOME_NO")add("HOME_FT_WIN_TO_NIL",null,q,"YES");
      if(q.selection==="AWAY_NO")add("AWAY_FT_WIN_TO_NIL",null,q,"YES");
      if(q.selection==="DRAW_NO"&&prematch)add("FT_TOTAL","0.5",q,"UNDER");
    }
  }else if((type==="FT_DOUBLE_CHANCE_BTTS"||type==="FT_RESULT_OR_BTTS")&&market.line===null&&
    cell.sourceEvent!==undefined&&cell.quotes.every(q=>q.isLive===cell.sourceEvent!.isLive)){
    // AP group 98, code 25: (HOME or AWAY) AND NOT BTTS.
    // BTI QA5200: DRAW OR BTTS. De Morgan makes those opposite predicates,
    // including 0-0; the native QA5200 NO price is the same side as AP's offer.
    for(const q of cell.quotes){
      if(type==="FT_DOUBLE_CHANCE_BTTS"&&q.selection==="HOME_AWAY_NO")add("FT_DRAW_OR_BTTS",null,q,"NO");
      if(type==="FT_RESULT_OR_BTTS"&&q.selection==="DRAW_YES_YES")add("FT_DRAW_OR_BTTS",null,q,"YES");
      if(type==="FT_RESULT_OR_BTTS"&&q.selection==="DRAW_YES_NO")add("FT_DRAW_OR_BTTS",null,q,"NO");
    }
  }
  return [...groups.values()];
}
