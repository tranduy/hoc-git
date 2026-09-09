import { footballBinaryMarketSpec, footballCategoricalMarketSpec, isFootballCategoricalSelection,
  type MarketType, type ProviderQuote } from "@tool-chenh/contracts";
import type { ComparisonCell } from "./comparison.js";
const supported = new Set<MarketType>(["FT_EUROPEAN_HANDICAP","FH_EUROPEAN_HANDICAP","CORNER_FT_EUROPEAN_HANDICAP",
  "FT_FINAL_SCORE_AH","FT_RESULT_BTTS","FT_DOUBLE_CHANCE_BTTS","FT_RESULT_OR_BTTS"]);

/** Alternative comparison predicates; source identities and receipts remain native. */
export function footballComparisonEquivalents(cell:ComparisonCell):readonly ComparisonCell[] {
  const market=cell.market,type=market.marketType;
  if(!supported.has(type)||market.category!=="FOOTBALL"||market.player!==undefined||market.status!=="OPEN")return [];
  const spec=footballBinaryMarketSpec(type)??footballCategoricalMarketSpec(type);
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
  if(european[type]&&prematch&&market.line!==null&&/^-?(?:0|[1-9]\d*)$/u.test(market.line)&&Number.isSafeInteger(Number(market.line))){
    for(const q of cell.quotes)if(q.selection==="HOME"||q.selection==="AWAY")
      add(european[type]!,String(Number(market.line)+(q.selection==="HOME"?-0.5:0.5)),q);
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
