import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec, footballCategoricalMarketSpec, type MarketType, type ProviderEvent } from "@tool-chenh/contracts";
import { footballComparisonEquivalents } from "./football-comparison-equivalents.js";
import type { ComparisonCell } from "./comparison.js";
import { binaryOpposingCellPairs, buildComparisonEvents } from "./comparison.js";
import { resultCatalog } from "./result-opposition.fixture.js";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { extractImFootballCatalog } from "../../../api/src/providers/im/im-football-catalog-source.js";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
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
    ["FT_GOAL_RANGE","FT_TOTAL"], ["FH_GOAL_RANGE","FH_TOTAL"], ["SH_GOAL_RANGE","SH_TOTAL"],
    ["HOME_FT_GOAL_RANGE","HOME_FT_TOTAL"], ["AWAY_FT_GOAL_RANGE","AWAY_FT_TOTAL"],
    ["HOME_FH_GOAL_RANGE","HOME_FH_TOTAL"], ["AWAY_FH_GOAL_RANGE","AWAY_FH_TOTAL"],
    ["CORNER_FT_RANGE","CORNER_FT_TOTAL"], ["CORNER_FH_RANGE","CORNER_FH_TOTAL"],
    ["HOME_CORNER_FT_RANGE","HOME_CORNER_FT_TOTAL"], ["AWAY_CORNER_FT_RANGE","AWAY_CORNER_FT_TOTAL"]
  ] as const)("matches the complete tails of %s with the same period and subject total",(type,target)=>{
    const source=cell(type,null,["RANGE_0_1","RANGE_2_PLUS","RANGE_2_3"]);
    const projected=footballComparisonEquivalents(source);
    expect(projected).toHaveLength(1);
    expect(projected[0]!.market).toMatchObject({marketType:target,line:"1.5",scope:source.market.scope});
    expect(projected[0]!.quotes.map(q=>q.selection)).toEqual(["UNDER","OVER"]);
    expect(projected[0]!.sourceMarket).toBe(source.market);expect(projected[0]!.sourceQuotes).toBe(source.quotes);
    for(const q of projected[0]!.quotes)expect(q).toMatchObject({rawOdds:"2.1",receivedMonotonicMs:13,sequence:14});
  });
  it("checks range-tail equivalence over every nonnegative count around each threshold",()=>{
    for(let boundary=0;boundary<=15;boundary++){
      const out=footballComparisonEquivalents(cell("FT_GOAL_RANGE",null,[`RANGE_0_${boundary}`,`RANGE_${boundary+1}_PLUS`]))[0]!;
      expect(out).toBeDefined();const line=Number(out.market.line);
      for(let goals=0;goals<=40;goals++){
        expect(goals<=boundary).toBe(goals<line);expect(goals>=boundary+1).toBe(goals>line);
        expect(Number(goals<line)+Number(goals>line)).toBe(1);
      }
    }
  });
  it.each([["FT_CORRECT_SCORE","FT_TOTAL"],["FH_CORRECT_SCORE","FH_TOTAL"],["SH_CORRECT_SCORE","SH_TOTAL"],
    ["CORNER_FT_CORRECT_SCORE","CORNER_FT_TOTAL"],["CORNER_FH_CORRECT_SCORE","CORNER_FH_TOTAL"]] as const)(
    "projects only the scoreless state of %s to under half a unit",(type,target)=>{
      const out=footballComparisonEquivalents(cell(type,null,["SCORE_0_0","SCORE_1_0","SCORE_0_1"]));
      expect(out).toHaveLength(1);expect(out[0]!.market).toMatchObject({marketType:target,line:"0.5"});
      expect(out[0]!.quotes.map(q=>q.selection)).toEqual(["UNDER"]);
    });
  it("does not project bounded interior ranges, all-counts ranges, invalid bounds or live final counts",()=>{
    expect(footballComparisonEquivalents(cell("FT_GOAL_RANGE",null,["RANGE_1_3","RANGE_0_PLUS","RANGE_3_2"]))).toEqual([]);
    expect(footballComparisonEquivalents(cell("FT_GOAL_RANGE",null,["RANGE_0_1"],true))).toEqual([]);
    expect(footballComparisonEquivalents(cell("FT_CORRECT_SCORE",null,["SCORE_0_0"],true))).toEqual([]);
  });
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
  it.each([
    ["CORNER_FT_1X2", "CORNER_FT_AH"],
    ["CORNER_FH_1X2", "CORNER_FH_AH"]
  ] as const)("projects %s team wins to the exact half-corner handicap predicates", (type, target) => {
    const source = cell(type, null, ["HOME", "DRAW", "AWAY"]);
    const result = footballComparisonEquivalents(source);
    expect(result.map(c => [c.market.marketType, c.market.line, c.quotes.map(q => q.selection)]))
      .toEqual([[target, "-0.5", ["HOME"]], [target, "0.5", ["AWAY"]]]);
    for (const projected of result) {
      expect(projected.sourceMarket).toBe(source.market);
      expect(projected.sourceQuotes).toBe(source.quotes);
    }
  });
  it("projects only the easier prematch over leg onto observed higher total lines", () => {
    const source = cell("CORNER_FT_TOTAL", "8", ["OVER", "UNDER"]);
    const result = footballComparisonEquivalents(source, ["7.5", "8", "8.25", "8.5", "9"]);
    expect(result.map(c => [c.market.line, c.quotes.map(q => q.selection)]))
      .toEqual([["8.25", ["OVER"]], ["8.5", ["OVER"]], ["9", ["OVER"]]]);
    expect(footballComparisonEquivalents(cell("CORNER_FT_TOTAL", "8", ["OVER"], true), ["8.5"]))
      .toEqual([]);
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
function catalog(provider:"BTI"|"CMD"|"APSPORT",type:MarketType,line:string|null,selections:string[],reversed=false):LiveCatalogResponse {
  const base=resultCatalog(provider,false),native=cell(type,line,selections);
  const market={...native.market,provider,providerEventId:base.events[0]!.providerEventId};
  return {...base,markets:[market],quotes:native.quotes.map(q=>({...q,provider,providerEventId:market.providerEventId})),
    events:base.events.map(e=>reversed?{...e,participantA:e.participantB,participantB:e.participantA}:e)};
}
describe("equivalences in the real matcher",()=>{
  it("matches a corner winner against the opposing half-corner handicap", () => {
    const result = buildComparisonEvents([
      catalog("BTI", "CORNER_FT_1X2", null, ["HOME"]),
      catalog("APSPORT", "CORNER_FT_AH", "-0.5", ["AWAY"])
    ]);
    const row = result.flatMap(event => event.rows).find(candidate =>
      candidate.marketType === "CORNER_FT_AH" && candidate.line === "-0.5");
    expect(row).toBeDefined();
    expect(binaryOpposingCellPairs(row!.cells)).toHaveLength(1);
    expect(row!.margin).toBeGreaterThan(0);
  });
  it("matches a lower corner over against a higher corner under conservatively", () => {
    const result = buildComparisonEvents([
      catalog("BTI", "CORNER_FT_TOTAL", "8", ["OVER"]),
      catalog("APSPORT", "CORNER_FT_TOTAL", "8.5", ["UNDER"])
    ]);
    const row = result.flatMap(event => event.rows).find(candidate =>
      candidate.marketType === "CORNER_FT_TOTAL" && candidate.line === "8.5");
    expect(row).toBeDefined();
    expect(binaryOpposingCellPairs(row!.cells)).toHaveLength(1);
    expect(row!.margin).toBeGreaterThan(0);
    expect(row!.cells.find(candidate => candidate.provider === "BTI")?.sourceMarket?.line).toBe("8");
  });
  it("does not pair Slavia IM exactly-zero half goals with CMD over 1.5", () => {
    const cmd = catalog("CMD", "FH_TOTAL", "1.5", ["OVER"]);
    const fixture = cmd.events[0]!;
    const records = extractImFootballCatalog({ StatusCode: 100, sel: [{ eid: 113151564,
      htn: fixture.participantA, atn: fixture.participantB, cn: fixture.competition,
      edt: new Date(fixture.startAtUtcMs!).toISOString(), isrbt: false, iscyb: false,
      mls: [{ mi: 2514625189, bti: 7, gp: 2, il: false,
        ws: [{ wsi: 32506465725, si: 39, o: 3.14, ot: 3 }] }] }] });
    const normalized = normalizeSbobetCatalog(records, { provider: "IM", observedAtMs: 100,
      receivedMonotonicMs: 13, sequence: 14 });
    expect(normalized.quotes).toHaveLength(1);
    const im: LiveCatalogResponse = { ...cmd, ...normalized, provider: "IM", accountId: "im",
      events: normalized.events.map(e => ({ ...e, startAtUtcMs: fixture.startAtUtcMs })) };
    const rows = buildComparisonEvents([im, cmd]).flatMap(e => e.rows);
    expect(rows.flatMap(row => binaryOpposingCellPairs(row.cells))).toEqual([]);
    const overHalf = { ...cmd, markets: cmd.markets.map(m => ({ ...m, line: "0.5" })),
      quotes: cmd.quotes.map(q => ({ ...q, line: "0.5" })) };
    expect(buildComparisonEvents([im, overHalf]).flatMap(e => e.rows)
      .flatMap(row => binaryOpposingCellPairs(row.cells))).toHaveLength(1);
  });
  it.each([false,true])("matches a team zero-goal bucket with the opposing total after orientation %s",reversed=>{
    const bucket=catalog("CMD",reversed?"AWAY_FT_GOAL_RANGE":"HOME_FT_GOAL_RANGE",null,["RANGE_0_0"],reversed);
    const over=catalog("BTI","HOME_FT_TOTAL","0.5",["OVER"]);
    // CMD anchors this event's canonical orientation; the BTI home team becomes
    // the canonical away team when CMD's native participants are reversed.
    const row=buildComparisonEvents([bucket,over]).flatMap(e=>e.rows).find(r=>r.marketType===(reversed?"AWAY_FT_TOTAL":"HOME_FT_TOTAL"));
    expect(row).toBeDefined();expect(binaryOpposingCellPairs(row!.cells)).toHaveLength(1);
    const leg=row!.cells.find(c=>c.provider==="CMD")!;
    expect(leg.quotes[0]!.selection).toBe("UNDER");expect(leg.sourceMarket).toBe(bucket.markets[0]);
    expect(leg.sourceQuotes).toEqual(bucket.quotes);
  });
  it("does not treat an interior goal bucket as the complement of a total",()=>{
    const rows=buildComparisonEvents([catalog("CMD","FT_GOAL_RANGE",null,["RANGE_2_3"]),
      catalog("BTI","FT_TOTAL","1.5",["OVER"])]).flatMap(e=>e.rows);
    expect(rows.flatMap(r=>binaryOpposingCellPairs(r.cells))).toEqual([]);
  });
  it.each([false,true])("matches AP non-draw without BTTS against BTI draw-or-BTTS after orientation %s",reversed=>{
    const ap=catalog("APSPORT","FT_DOUBLE_CHANCE_BTTS",null,["HOME_AWAY_NO"]);
    const bti=catalog("BTI","FT_RESULT_OR_BTTS",null,["DRAW_YES_YES"],reversed);
    const row=buildComparisonEvents([ap,bti]).flatMap(e=>e.rows).find(r=>r.marketType==="FT_DRAW_OR_BTTS");
    expect(row).toBeDefined();
    expect(binaryOpposingCellPairs(row!.cells)).toHaveLength(1);
    expect(row!.cells.map(c=>[c.provider,c.quotes[0]!.selection]).sort()).toEqual([["APSPORT","NO"],["BTI","YES"]]);
    for(const source of [ap,bti]){
      const leg=row!.cells.find(c=>c.provider===source.provider)!;
      expect(leg.sourceMarket).toBe(source.markets[0]);expect(leg.sourceQuotes).toEqual(source.quotes);
      expect(leg.quotes[0]).toMatchObject({providerSelectionId:source.quotes[0]!.providerSelectionId,
        rawOdds:source.quotes[0]!.rawOdds,rawFormat:source.quotes[0]!.rawFormat,
        receivedMonotonicMs:source.quotes[0]!.receivedMonotonicMs,sequence:source.quotes[0]!.sequence});
    }
  });
  it("rejects BTI's NO leg against the equivalent AP predicate",()=>{
    const rows=buildComparisonEvents([catalog("APSPORT","FT_DOUBLE_CHANCE_BTTS",null,["HOME_AWAY_NO"]),
      catalog("BTI","FT_RESULT_OR_BTTS",null,["DRAW_YES_NO"])]).flatMap(e=>e.rows);
    expect(rows.some(r=>r.marketType==="FT_DRAW_OR_BTTS")).toBe(false);
  });
  it("exhaustively covers each regulation score with exactly one of the projected predicates",()=>{
    const ap=footballComparisonEquivalents(cell("FT_DOUBLE_CHANCE_BTTS",null,["HOME_AWAY_NO"]))[0];
    const bti=footballComparisonEquivalents(cell("FT_RESULT_OR_BTTS",null,["DRAW_YES_YES"]))[0];
    expect(ap?.quotes[0]?.selection).toBe("NO");expect(bti?.quotes[0]?.selection).toBe("YES");
    for(let home=0;home<=20;home++)for(let away=0;away<=20;away++){
      const draw=home===away,bothScore=home>0&&away>0;
      expect(Number(!draw&&!bothScore)+Number(draw||bothScore)).toBe(1);
      expect((home===0)!==(away===0)).toBe(!draw&&!bothScore);
    }
  });
  it.each([false,true])("retains full-period boolean predicates for live=%s without creating unrelated complements",live=>{
    const bti=footballComparisonEquivalents(cell("FT_RESULT_OR_BTTS",null,["DRAW_YES_YES","DRAW_YES_NO","HOME_YES_YES"],live));
    expect(bti).toHaveLength(1);expect(bti[0]!.market.marketType).toBe("FT_DRAW_OR_BTTS");
    expect(bti[0]!.quotes.map(q=>q.selection)).toEqual(["YES","NO"]);
    const ap=footballComparisonEquivalents(cell("FT_DOUBLE_CHANCE_BTTS",null,["HOME_AWAY_NO","HOME_AWAY_YES","HOME_DRAW_NO"],live));
    expect(ap).toHaveLength(1);expect(ap[0]!.quotes.map(q=>q.selection)).toEqual(["NO"]);
  });
  it("rejects malformed or suspended evidence for the new boolean partition",()=>{
    const base=cell("FT_DOUBLE_CHANCE_BTTS",null,["HOME_AWAY_NO"]);
    const rejected:ComparisonCell[]=[
      {...base,market:{...base.market,settlementProfile:"foreign-rules"}},
      {...base,market:{...base.market,scope:"FIRST_HALF"}},
      {...base,market:{...base.market,line:"2.5"},quotes:base.quotes.map(q=>({...q,line:"2.5"}))},
      {...base,quotes:base.quotes.map(q=>({...q,isLive:true}))},
      {...base,quotes:base.quotes.map(q=>({...q,status:"SUSPENDED" as const}))},
      {...base,quotes:[...base.quotes,...base.quotes]},
      {...base,sourceEvent:undefined} as unknown as ComparisonCell
    ];
    for(const bad of rejected)expect(footballComparisonEquivalents(bad)).toEqual([]);
  });
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
