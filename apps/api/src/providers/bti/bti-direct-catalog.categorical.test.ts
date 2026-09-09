import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { extractBtiCatalogRecords, extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";

const marketId = "0QA881975737568210964";
function selection(suffix: string, name: string, side: number, price = "-0.091", closed = false): unknown[] {
  const s: unknown[] = []; s[0] = marketId + suffix; s[2] = { VI: name }; s[5] = false;
  s[8] = [null,null,null,null,null,price]; s[9] = side; s[13] = closed; s[16] = null; return s;
}
function payload(code: string, label: string, selections: unknown[][]) {
  const m: unknown[] = []; m[0] = marketId; m[1] = label; m[5] = [code,label]; m[13] = selections; m[15] = false; m[23] = false;
  const e: unknown[] = []; e[0] = "881975734955175936"; e[2] = "League";
  e[8] = [["home",{ VI: "Norwich" }],["away",{ VI: "Birmingham" }]];
  e[11] = "2026-09-11T18:00:00Z"; e[13] = false; e[20] = [m]; e[32] = false; return { data: [e] };
}
const normalize = (raw: ReturnType<typeof payload>) => normalizeSbobetCatalog(extractBtiCatalogRecords(raw),
  { provider: "BTI", observedAtMs: 100, receivedMonotonicMs: 50, sequence: 7 });

describe("BTI native categorical contracts and opposing equivalents", () => {
  it.each([["QA60","FT_CORRECT_SCORE"],["QA144","FH_CORRECT_SCORE"],["QA3580","SH_CORRECT_SCORE"],
    ["QA4030","CORNER_FT_CORRECT_SCORE"],["QA4031","CORNER_FH_CORRECT_SCORE"]])("retains %s score identities and excludes closed zero-price grid cells", (code,type) => {
    const raw = payload(code,"Correct score",[selection("Q2Q1","2:1",1),selection("Q9Q9","9:9",2,"-0.001"),
      selection("Q10Q10","10:10",2,"0.00",true)]);
    const result=normalize(raw);
    expect(result.markets).toEqual([expect.objectContaining({marketType:type,line:null})]);
    expect(result.quotes.map(q=>[q.providerSelectionId,q.selection,q.rawOdds,q.sequence])).toEqual([
      [marketId+"Q2Q1","SCORE_2_1","-0.091",7],[marketId+"Q9Q9","SCORE_9_9","-0.001",7]]);
    const observations=extractBtiNativeMarketObservations(raw,100);
    expect(observations.flatMap(o=>o.nativeSelections??[])).toHaveLength(3);
    expect(observations.find(o=>o.disposition==="EXCLUDED")?.nativeSelections).toEqual([
      expect.objectContaining({selectionId:marketId+"Q10Q10",status:"CLOSED"})]);
  });
  it.each([
    ["QA119","Goals","Q0Q0","Không bàn thắng",1,"FT_TOTAL","UNDER","0.5"],
    ["QA119","Goals","Q0Q-6","6 Goals and more",1,"FT_TOTAL","OVER","5.5"],
    ["QA120","First half goals","Q0Q-3","3 bàn thắng trở lên",3,"FH_TOTAL","OVER","2.5"],
    ["QA4452","Total goals","Q0Q1","Under 2 goals",0,"FT_TOTAL","UNDER","1.5"],
    ["QA4452","Total goals","Q2Q3","2 or 3 goals",0,"FT_GOAL_RANGE","RANGE_2_3",null],
    ["QA154","Team goals","Q2Q0","Birmingham 0 Goals",3,"AWAY_FT_TOTAL","UNDER","0.5"],
    ["QA155","Team first half goals","Q1Q-4","Norwich 4 bàn thắng trở lên",1,"HOME_FH_TOTAL","OVER","3.5"],
    ["QA4300","Corner range","Q0Q5","0-5",0,"CORNER_FT_TOTAL","UNDER","5.5"],
    ["QA4302","First half corner range","Q7Q-1","7+",0,"CORNER_FH_TOTAL","OVER","6.5"],
    ["QA62","Half/full","Q11Q1","Norwich/Hoà",1,"FT_HALF_FULL_RESULT","HOME_DRAW",null],
    ["QA62","Half/full","Q17Q1","Hoà/Birmingham",2,"FT_HALF_FULL_RESULT","DRAW_AWAY",null],
    ["QA89","Highest scoring half","Q625Q0","Hiệp 2",0,"FT_HIGHEST_SCORING_HALF","SECOND_HALF",null],
    ["QA3583","First half result and BTTS","Q0Q2","Hoà và cả hai đội đều ghi bàn",2,"FH_RESULT_BTTS","DRAW_YES",null],
    ["QA277","Norwich: Đội ghi bàn trong hiệp 2","Q0Q11","Có",1,"HOME_SH_TOTAL","OVER","0.5"],
    ["QA4274","Birmingham: Giữ sạch lưới trong hiệp 2","Q0Q20","Có",1,"HOME_SH_TOTAL","UNDER","0.5"],
    ["QA276","Norwich: Team odd/even first half","Q0Q11","Lẻ",1,"HOME_FH_ODD_EVEN","ODD",null],
    ["QA277","Birmingham: Đội ghi bàn trong hiệp 2","Q0Q21","Có",1,"AWAY_SH_TOTAL","OVER","0.5"],
    ["QA278","Birmingham: Team odd/even second half","Q0Q20","Chẵn",3,"AWAY_SH_ODD_EVEN","EVEN",null]
  ] as const)("decodes %s %s %s without losing the native quote",(code,label,suffix,name,side,type,outcome,line)=>{
    const result=normalize(payload(code,label,[selection(suffix,name,side)]));
    expect(result.markets).toEqual([expect.objectContaining({marketType:type,line})]);
    expect(result.quotes).toEqual([expect.objectContaining({selection:outcome,providerSelectionId:marketId+suffix,rawOdds:"-0.091"})]);
  });
  it.each([
    ["QA291","Q0Q1","1-0, 2-0, 3-0",1,"FT_SCORE_SET","SCORES_1_0|2_0|3_0",null],
    ["QA291","Q0Q-4","2-3, 2-4, 3-4, 1-5",3,"FT_SCORE_SET","SCORES_1_5|2_3|2_4|3_4",null],
    ["QA93","Q0Q11","Norwich to win by 1 Goal",1,"FT_WIN_MARGIN","HOME_1",null],
    ["QA4303","Q0Q42","Birmingham to win by 4 or more",3,"FH_WIN_MARGIN","AWAY_4_PLUS",null],
    ["QA93","Q0Q0","Hoà không bàn thắng",1,"FT_TOTAL","UNDER","0.5"],
    ["QA4303","Q0Q1","Hoà bàn thắng",3,"FH_RESULT_BTTS","DRAW_YES",null]
  ] as const)("maps corroborated %s %s terms",(code,suffix,name,side,type,outcome,line)=>{
    const result=normalize(payload(code,"Native market",[selection(suffix,name,side)]));
    expect(result.markets).toEqual([expect.objectContaining({marketType:type,line})]);
    expect(result.quotes).toEqual([expect.objectContaining({selection:outcome,providerSelectionId:marketId+suffix})]);
  });
  it.each([
    ["QA291","Q0Q1","1-0, 2-0, 4-0",1],
    ["QA291","Q0Q1","1-0, 1-0, 2-0, 3-0",1],
    ["QA93","Q0Q11","Birmingham to win by 1 Goal",1],
    ["QA4303","Q0Q42","Birmingham to win by 4 Goal",3]
  ] as const)("rejects contradictory %s %s outcome names",(code,suffix,name,side)=>{
    expect(normalize(payload(code,"Native market",[selection(suffix,name,side)])).markets).toEqual([]);
  });
  it("splits the two positive win-to-nil offers into different team contracts without inventing NO",()=>{
    const raw=payload("QA696","Thắng và giữ sạch lưới",[selection("Q0Q0","Norwich",1),selection("Q0Q1","Birmingham",3)]);
    const result=normalize(raw);
    expect(result.markets.map(m=>m.marketType)).toEqual(["HOME_FT_WIN_TO_NIL","AWAY_FT_WIN_TO_NIL"]);
    expect(result.quotes.map(q=>q.selection)).toEqual(["YES","YES"]);
    expect(new Set(result.markets.map(m=>m.providerMarketId)).size).toBe(2);
    expect(extractBtiNativeMarketObservations(raw,100).flatMap(o=>o.nativeSelections??[])).toHaveLength(2);
  });
  it.each([
    ["ML619","Cược 1X2 số quả phạt góc toàn trận","H","Norwich",1,null,"CORNER_FT_1X2","HOME",null],
    ["HC157","Hoà được hoàn tiền","HMM","Norwich",1,0,"FT_DRAW_NO_BET","HOME",null],
    ["HC270","Cược chấp 3 chiều","HMM","Norwich",1,-1,"FT_EUROPEAN_HANDICAP","HOME","-1"],
    ["HC270","Cược chấp 3 chiều","AMM","Birmingham",3,1,"FT_EUROPEAN_HANDICAP","AWAY","-1"],
    ["HC2219","Kèo cược chấp châu Âu thay thế (Được thanh toán dựa trên tỷ số cuối cùng)","HMM","Norwich",1,-0.5,"FT_FINAL_SCORE_AH","HOME","-0.5"],
    ["OU6309","Tài/Xỉu cả trận 3 cửa","OMM","Tài",1,3,"FT_TOTAL","OVER","3.5"],
    ["OU6309","Tài/Xỉu cả trận 3 cửa","UMM","Xỉu",3,3,"FT_TOTAL","UNDER","2.5"],
    ["OU6309","Tài/Xỉu cả trận 3 cửa","EMM","Chính xác",2,3,"FT_GOAL_RANGE","RANGE_3_3",null],
    ["QA6113","Các khoảng tổng bàn thắng","Q0Q2","0-2",0,null,"FT_TOTAL","UNDER","2.5"],
    ["OU1968","Birmingham: Tổng số thẻ của đội","OMM","Tài",1,2.5,"AWAY_CARD_FT_TOTAL","OVER","2.5"],
    ["QA6036","Bàn thắng đầu tiên trước phút","Q600Q1","10:00 - Có",1,null,"FT_FIRST_GOAL_BEFORE","YES","600"],
    ["QA5401","Not translated","Q150Q123456","Jon Player Tài 1.5",1,null,"PLAYER_FT_SHOTS_TOTAL","OVER","1.5"]
  ] as const)("normalizes remaining %s %s %s with native identities",(code,label,suffix,name,side,nativeLine,type,outcome,line)=>{
    const s=selection(suffix,name,side);s[16]=nativeLine;
    const result=normalize(payload(code,label,[s]));
    expect(result.markets).toEqual([expect.objectContaining({marketType:type,line})]);
    expect(result.quotes).toEqual([expect.objectContaining({selection:outcome,providerSelectionId:marketId+suffix})]);
  });
  it("retains all halftime/fulltime outcomes when a native participant contains a slash",()=>{
    // Captured QA62 market 0QA884777943912706070: Bodo/Glimt versus Sandefjord Fb.
    const names=["Bodo/Glimt/Bodo/Glimt","Bodo/Glimt/Sandefjord Fb","Bodo/Glimt/Hoà",
      "Sandefjord Fb/Bodo/Glimt","Sandefjord Fb/Sandefjord Fb","Sandefjord Fb/Hoà",
      "Hoà/Bodo/Glimt","\u001dHoà/hoà","Hoà/Sandefjord Fb"];
    const raw=payload("QA62","Half/full",names.map((name,index)=>selection(`Q${index+9}Q1`,name,[1,1,1,3,3,3,2,2,2][index]!)));
    raw.data[0]![8]=[["home",{VI:"Bodo/Glimt"}],["away",{VI:"Sandefjord Fb"}]];
    const result=normalize(raw);
    expect(result.quotes.map(quote=>quote.selection)).toEqual([
      "HOME_HOME","HOME_AWAY","HOME_DRAW","AWAY_HOME","AWAY_AWAY","AWAY_DRAW","DRAW_HOME","DRAW_DRAW","DRAW_AWAY"]);
    expect(extractBtiNativeMarketObservations(raw,100).filter(item=>item.disposition==="NORMALIZED")
      .flatMap(item=>item.nativeSelections??[])).toHaveLength(9);
  });
  it.each(["Bodo/Glimt/Bodo/Glimt","Bodo/Glimt/Other Sandefjord Fb","Bodo/Glimt Sandefjord Fb"])(
    "rejects an HTFT named pair that contradicts the native HOME_AWAY identity: %s",name=>{
      const raw=payload("QA62","Half/full",[selection("Q10Q1",name,1)]);
      raw.data[0]![8]=[["home",{VI:"Bodo/Glimt"}],["away",{VI:"Sandefjord Fb"}]];
      expect(normalize(raw).markets).toEqual([]);
    });
  it.each(["suffix","name","side"])("does not use a score when its %s contradicts the other native fields",failure=>{
    const s=selection(failure==="suffix"?"Q1Q2":"Q2Q1",failure==="name"?"9:1":"2:1",failure==="side"?3:1);
    expect(normalize(payload("QA60","Score",[s])).markets).toEqual([]);
  });
  it("keeps suspended offers suspended, rejects duplicate IDs, and leaves absent team identity unresolved",()=>{
    const s=selection("Q0Q0","Norwich",1);s[5]=true;
    expect(normalize(payload("QA696","Win to nil",[s])).quotes[0]?.status).toBe("SUSPENDED");
    expect(normalize(payload("QA696","Win to nil",[s,s])).markets).toEqual([]);
    expect(normalize(payload("QA277","Unrelated: second half scores",[selection("Q0Q11","Có",1)])).markets).toEqual([]);
  });
  it("requires the named team and the team-specific native ID to agree",()=>{
    expect(normalize(payload("QA277","Norwich: second half scores",[selection("Q0Q21","Có",1)])).markets).toEqual([]);
    expect(normalize(payload("QA4451","Norwich: highest scoring half",[selection("Q0Q11","Hiệp 1",1)])).markets).toEqual([]);
    expect(normalize(payload("QA4451","Birmingham: highest scoring half",[selection("Q0Q11","Hiệp 1",1)])).quotes[0]?.selection).toBe("FIRST_HALF");
  });
  it("keeps an unresolved OPEN player offer visibly unmapped when another player in the container maps",()=>{
    const raw=payload("QA1337","Cầu thủ ghi bàn",[
      selection("Q3Q123456","Jon Player",1),selection("Q3Q123457","Home or draw",1)]);
    const unresolved=extractBtiNativeMarketObservations(raw,100).find(o=>o.nativeSelections?.some(s=>s.selectionId===marketId+"Q3Q123457"));
    expect(unresolved?.disposition).toBe("UNMAPPED");
    expect(unresolved?.nativeSelections?.[0]?.price).toBe("-0.091");
  });
  it.each([["QA277","Lẻ"],["QA276","Có"]])("does not interpret the wrong outcome vocabulary for %s",(code,name)=>{
    expect(normalize(payload(code,"Norwich: named team",[selection("Q0Q11",name,1)])).markets).toEqual([]);
  });
});
