import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec, footballCategoricalMarketSpec, type MarketType, type ProviderEvent } from "@tool-chenh/contracts";
import { footballComparisonEquivalents } from "./football-comparison-equivalents.js";
import type { ComparisonCell } from "./comparison.js";
import { buildComparisonEvents } from "./comparison.js";
import { resultCatalog } from "./result-opposition.fixture.js";
import type { LiveCatalogResponse } from "../api/catalog.js";
function cell(type:MarketType,line:string|null,selections:string[],live=false):ComparisonCell {
  const spec=footballBinaryMarketSpec(type)??footballCategoricalMarketSpec(type)!;
  const market={provider:"BTI" as const,category:"FOOTBALL" as const,providerEventId:"event",providerMarketId:"native",marketType:type,
    scope:spec.scope,line,settlementProfile:spec.settlementProfile,status:"OPEN" as const};
  const quotes=selections.map(selection=>({...market,selection,providerSelectionId:`native:${selection}`,rawOdds:"2.1",rawFormat:"DECIMAL" as const,
    isLive:live,sourceTimestampMs:12,receivedMonotonicMs:13,sequence:14}));
  return {provider:"BTI",market,quotes,sourceMarket:market,sourceQuotes:quotes,sourceEvent:{isLive:live} as ProviderEvent};
}
describe("proven native football equivalences",()=>{
  it.each([
    ["FT_EUROPEAN_HANDICAP","-1","FT_AH","-1.5","-0.5"],
    ["FH_EUROPEAN_HANDICAP","2","FH_AH","1.5","2.5"],
    ["CORNER_FT_EUROPEAN_HANDICAP","0","CORNER_FT_AH","-0.5","0.5"]
  ] as const)("projects %s each team win at its own strict threshold",(type,line,target,h,a)=>{
    const source=cell(type,line,["HOME","DRAW","AWAY"]),result=footballComparisonEquivalents(source);
    expect(result.map(c=>[c.market.marketType,c.market.line,c.quotes.map(q=>q.selection)])).toEqual([[target,h,["HOME"]],[target,a,["AWAY"]]]);
    for(const c of result){expect(c.sourceMarket).toBe(source.market);expect(c.sourceQuotes).toBe(source.quotes);
      expect(c.quotes[0]!.rawOdds).toBe("2.1");expect(c.quotes[0]!.receivedMonotonicMs).toBe(13);expect(c.quotes[0]!.sequence).toBe(14);}
  });
  it.each(["FT_DRAW_NO_BET","FH_DRAW_NO_BET","SH_DRAW_NO_BET"] as const)("retains %s without inferring the Asian settlement rule",type=>{
    const out=footballComparisonEquivalents(cell(type,null,["HOME","AWAY"]));
    expect(out).toEqual([]);
  });
  it("projects the explicit final-score handicap only before kickoff",()=>{
    expect(footballComparisonEquivalents(cell("FT_FINAL_SCORE_AH","0.5",["HOME","AWAY"]))[0]!.market.marketType).toBe("FT_AH");
    expect(footballComparisonEquivalents(cell("FT_FINAL_SCORE_AH","0.5",["HOME","AWAY"],true))).toEqual([]);
  });
  it("does not confuse live European/full-score terms with remaining-score Asian lines",()=>{
    expect(footballComparisonEquivalents(cell("FT_EUROPEAN_HANDICAP","1",["HOME","AWAY"],true))).toEqual([]);
    expect(footballComparisonEquivalents(cell("FT_DRAW_NO_BET",null,["HOME","AWAY"],true))).toEqual([]);
  });
  it("projects win without both scoring and scoreless draw exactly",()=>{
    expect(footballComparisonEquivalents(cell("FT_RESULT_BTTS",null,["HOME_NO","AWAY_NO","DRAW_NO","HOME_YES"]))
      .map(c=>[c.market.marketType,c.market.line,c.quotes[0]!.selection])).toEqual([
        ["HOME_FT_WIN_TO_NIL",null,"YES"],["AWAY_FT_WIN_TO_NIL",null,"YES"],["FT_TOTAL","0.5","UNDER"]]);
  });
  it("rejects foreign settlement rules and mixed or duplicate native evidence",()=>{
    const source=cell("FT_EUROPEAN_HANDICAP","0",["HOME","AWAY"]);
    expect(footballComparisonEquivalents({...source,market:{...source.market,settlementProfile:"foreign-refund-rule"}})).toEqual([]);
    expect(footballComparisonEquivalents({...source,quotes:[source.quotes[0]!,source.quotes[0]!]})).toEqual([]);
    expect(footballComparisonEquivalents({...source,quotes:[source.quotes[0]!,{...source.quotes[1]!,sequence:15}]})).toEqual([]);
    expect(footballComparisonEquivalents({...source,quotes:[{...source.quotes[0]!,line:"1"}]})).toEqual([]);
    expect(footballComparisonEquivalents({...source,sourceEvent:undefined} as unknown as ComparisonCell)).toEqual([]);
  });
});
function catalog(provider:"BTI"|"CMD",type:MarketType,line:string|null,selections:string[],reversed=false):LiveCatalogResponse {
  const base=resultCatalog(provider,false),native=cell(type,line,selections);
  const market={...native.market,provider,providerEventId:base.events[0]!.providerEventId};
  return {...base,markets:[market],quotes:native.quotes.map(q=>({...q,provider,providerEventId:market.providerEventId})),
    events:base.events.map(e=>reversed?{...e,participantA:e.participantB,participantB:e.participantA}:e)};
}
describe("equivalences in the real matcher",()=>{
  it.each([false,true])("matches a European away offer against native Asian home after orientation %s",reversed=>{
    const bti=catalog("BTI","FT_EUROPEAN_HANDICAP",reversed?"1":"-1",[reversed?"HOME":"AWAY"],reversed);
    const cmd=catalog("CMD","FT_AH","-0.5",["HOME"]);
    const row=buildComparisonEvents([cmd,bti]).flatMap(e=>e.rows).find(r=>r.marketType==="FT_AH")!;
    expect(row).toBeDefined();expect(row.line).toBe("-0.5");
    const leg=row.cells.find(c=>c.provider==="BTI")!;
    expect(leg.quotes[0]!.selection).toBe("AWAY");expect(leg.sourceMarket).toBe(bti.markets[0]);
    expect(leg.sourceQuotes).toEqual(bti.quotes);
  });
  it("does not claim a DNB versus AH0 pair without the exact common rule",()=>{
    const row=buildComparisonEvents([catalog("CMD","FT_AH","0",["HOME"]),catalog("BTI","FT_DRAW_NO_BET",null,["AWAY"])])
      .flatMap(e=>e.rows).find(r=>r.marketType==="FT_AH")!;
    expect(row).toBeUndefined();
  });
  it("swaps the team predicate in result+BTTS before matching win to nil",()=>{
    const rows=buildComparisonEvents([catalog("CMD","HOME_FT_WIN_TO_NIL",null,["NO"]),
      catalog("BTI","FT_RESULT_BTTS",null,["AWAY_NO"],true)]).flatMap(e=>e.rows);
    const row=rows.find(r=>r.marketType==="HOME_FT_WIN_TO_NIL")!;
    expect(row).toBeDefined();expect(row.cells.find(c=>c.provider==="BTI")!.sourceQuotes![0]!.selection).toBe("AWAY_NO");
  });
});
