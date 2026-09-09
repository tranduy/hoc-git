import { describe, expect, it } from "vitest";
import { decodeBtiCombinationTerms } from "./bti-combination-terms.js";

const marketId="native";
const teams=["Bodo/Glimt","Sandefjord Fb"] as const;
const native=(suffix:string,name:string,side:number)=>({id:marketId+suffix,name,side,line:0,lineWasMissing:true});
const decode=(code:string,suffix:string,name:string,side:number,label:string)=>
  decodeBtiCombinationTerms(code,marketId,native(suffix,name,side),label,teams);

describe("BTI combined outcome predicates",()=>{
  it.each([
    ["QA5505","Q0Q1","Có",1,"Cả hai đội ghi bàn HOẶC Tài 2.5","FT_BTTS_OR_OVER_TOTAL","YES","2.5"],
    ["QA5505","Q0Q0","Không",3,"Cả hai đội ghi bàn HOẶC Tài 2.5","FT_BTTS_OR_OVER_TOTAL","NO","2.5"],
    ["QA5081","Q0Q1","Có",1,"Cả hai đội ghi từ 2 bàn trở lên","FT_BOTH_TEAMS_SCORE_MINIMUM","YES","2"],
    ["QA5103","Q0Q0","Không",0,"Đội nào sẽ ghi bàn","FT_TOTAL","UNDER","0.5"],
    ["QA5103","Q1Q1","Both Team",0,"Đội nào sẽ ghi bàn","FT_BTTS","YES",null],
    ["QA5103","Q1Q0","Only Bodo/Glimt",0,"Đội nào sẽ ghi bàn","HOME_FT_WIN_TO_NIL","YES",null],
    ["QA5103","Q0Q1","Only Sandefjord Fb",0,"Đội nào sẽ ghi bàn","AWAY_FT_WIN_TO_NIL","YES",null],
    ["QA5194","Q0Q1","Có",1,"Hòa hoặc Tài 2.5","FT_RESULT_OR_TOTAL","DRAW_OVER_YES","2.5"],
    ["QA5197","Q0Q0","Không",3,"Hòa hoặc Xỉu 2.5","FT_RESULT_OR_TOTAL","DRAW_UNDER_NO","2.5"],
    ["QA5200","Q0Q0","Không",3,"Hòa hoặc Cả hai đội ghi bàn","FT_RESULT_OR_BTTS","DRAW_YES_NO",null],
    ["QA6021","Q10Q350","Bodo/Glimt/Sandefjord Fb and Over 3.5",1,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng","FT_HALF_FULL_RESULT_TOTAL","HOME_AWAY_OVER","3.5"],
    ["QA6021","Q16Q-150","\u001dHoà/hoà and Under 1.5",2,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng","FT_HALF_FULL_RESULT_TOTAL","DRAW_DRAW_UNDER","1.5"],
    ["QA6021","Q12Q-350","Sandefjord Fb/Bodo/Glimt and Under 3.5",3,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng","FT_HALF_FULL_RESULT_TOTAL","AWAY_HOME_UNDER","3.5"],
    ["QA6096","Q1Q250","Home or Away & Over 2.5",3,"Cơ hội kép và tổng bàn 2.5","FT_DOUBLE_CHANCE_TOTAL","HOME_AWAY_OVER","2.5"],
    ["QA6097","Q2Q-350","Home or Tie & Under 3.5",1,"Cơ hội kép và tổng bàn 3.5","FT_DOUBLE_CHANCE_TOTAL","HOME_DRAW_UNDER","3.5"],
    ["QA6098","Q3Q450","Tie or Away & Over 4.5",2,"Cơ hội kép và tổng bàn 4.5","FT_DOUBLE_CHANCE_TOTAL","DRAW_AWAY_OVER","4.5"],
    ["QA6099","Q3Q-550","Tie or Away & Under 5.5",2,"Cơ hội kép và tổng bàn 5.5","FT_DOUBLE_CHANCE_TOTAL","DRAW_AWAY_UNDER","5.5"],
    ["QA5534","Q2Q1","2:1",1,"Tỷ số chính xác tại bất kỳ thời điểm nào","FT_SCORE_ANYTIME","SCORE_2_1",null],
    ["QA5534","Q0Q0","0:0",2,"Tỷ số chính xác tại bất kỳ thời điểm nào","FT_SCORE_ANYTIME","SCORE_0_0",null],
    ["QA5104","Q0Q0","Hoà",1,"Bodo/Glimt: Không cược","FT_HOME_NO_BET","DRAW",null],
    ["QA5104","Q1Q1","Sandefjord Fb",3,"Bodo/Glimt: Không cược","FT_HOME_NO_BET","AWAY",null],
    ["QA5105","Q0Q0","Hoà",3,"Sandefjord Fb: Không cược","FT_AWAY_NO_BET","DRAW",null],
    ["QA5105","Q1Q1","Bodo/Glimt",1,"Sandefjord Fb: Không cược","FT_AWAY_NO_BET","HOME",null],
    ["QA4200","Q0Q1","Có",1,"Cả 2 đội đều nhận thẻ phạt","FT_BOTH_TEAMS_CARD_MINIMUM","YES","1"],
    ["QA5100","Q2Q0","2 or more no",3,"Cả hai đội nhận 1/2/3 thẻ trở lên","FT_BOTH_TEAMS_CARD_MINIMUM","NO","2"],
    ["QA5152","Q0Q1","Có",1,"Có thẻ đỏ hoặc phạt đền","FT_RED_CARD_OR_PENALTY","YES",null],
    ["QA6038","Q0Q0","Không",3,"Có thẻ ở cả hai hiệp","FT_CARDS_BOTH_HALVES","NO",null],
    ["QA5151","Q0Q1","Có",1,"Cả hai đội nhận thẻ ở mỗi hiệp","FT_BOTH_TEAMS_CARDS_BOTH_HALVES","YES",null],
    ["QA5536","Q0Q1","Có",1,"Thẻ đỏ trực tiếp","FT_DIRECT_RED_CARD","YES",null],
    ["QA5537","Q0Q2","Không",3,"Bodo/Glimt: Có thẻ đỏ","HOME_FT_RED_CARD","NO",null],
    ["QA5540","Q0Q1","Có",1,"Có thẻ đỏ - Hiệp 1","FH_RED_CARD","YES",null],
    ["QA6025","Q0Q1","Có",1,"Có bàn trong bù giờ Hiệp 1","FH_STOPPAGE_GOAL","YES",null]
  ] as const)("decodes proven %s %s",(code,suffix,name,side,label,marketType,selection,lineText)=>{
    expect(decode(code,suffix,name,side,label)).toEqual({marketType,selection,lineText});
  });
  it.each([
    ["QA5505","Q0Q1","Có",1,"Cả hai đội ghi bàn VÀ Tài 2.5"],
    ["QA5081","Q0Q1","Có",1,"Cả hai đội ghi từ 3 bàn trở lên"],
    ["QA5103","Q1Q0","Only Sandefjord Fb",0,"Đội nào sẽ ghi bàn"],
    ["QA5194","Q0Q1","Có",1,"Hòa hoặc Xỉu 2.5"],
    ["QA6021","Q10Q350","Bodo/Glimt/Bodo/Glimt and Over 3.5",1,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng"],
    ["QA6021","Q10Q-350","Bodo/Glimt/Sandefjord Fb and Over 3.5",1,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng"],
    ["QA6021","Q10Q350","Bodo/Glimt/Sandefjord Fb and Over 2.5",1,"Hiệp 1/Cả trận và Tài/Xỉu bàn thắng"],
    ["QA6096","Q1Q350","Home or Away & Over 3.5",3,"Cơ hội kép và tổng bàn 2.5"],
    ["QA6097","Q2Q-350","Tie or Away & Under 3.5",1,"Cơ hội kép và tổng bàn 3.5"],
    ["QA5534","Q2Q1","1:2",1,"Tỷ số chính xác tại bất kỳ thời điểm nào"],
    ["QA5104","Q0Q0","Hoà",1,"Sandefjord Fb: Không cược"],
    ["QA5104","Q1Q1","Bodo/Glimt",3,"Bodo/Glimt: Không cược"],
    ["QA5105","Q0Q0","Hoà",1,"Sandefjord Fb: Không cược"],
    ["QA5100","Q2Q1","3 or more yes",1,"Cả hai đội nhận 1/2/3 thẻ trở lên"],
    ["QA5536","Q0Q1","Có",1,"Có thẻ đỏ"],
    ["QA5537","Q0Q2","Không",3,"Sandefjord Fb: Có thẻ đỏ"],
    ["QA5540","Q0Q1","Có",1,"Có thẻ đỏ - Hiệp 2"],
    ["QA6025","Q0Q1","Có",1,"Có bàn trong Hiệp 1"]
  ] as const)("rejects contradicting %s %s",(code,suffix,name,side,label)=>{
    expect(decode(code,suffix,name,side,label)).toBeNull();
  });
  it("keeps unsupported or conflicting native identities unresolved",()=>{
    const value=native("Q1Q0","Only Bodo/Glimt",0);
    expect(decodeBtiCombinationTerms("QA5103",marketId,value,"Đội nào sẽ ghi bàn")).toBeNull();
    expect(decodeBtiCombinationTerms("QA5103",marketId,{...value,id:"different"},"Đội nào sẽ ghi bàn",teams)).toBeNull();
    expect(decodeBtiCombinationTerms("QA5103",marketId,{...value,line:2,lineWasMissing:false},"Đội nào sẽ ghi bàn",teams)).toBeNull();
    expect(decode("QA99999","Q0Q1","Có",1,"Hòa hoặc Tài 2.5")).toBeNull();
  });
  it.each([
    ["QA6337","Q0Q1","Có",1,"Trận đấu được định đoạt trong hiệp phụ","FT_DECIDED_EXTRA_TIME","YES"],
    ["QA6337","Q0Q0","Không",3,"Trận đấu được định đoạt trong hiệp phụ","FT_DECIDED_EXTRA_TIME","NO"],
    ["QA5302","Q0Q1","Có",1,"Có loạt sút luân lưu hay không","FT_PENALTY_SHOOTOUT","YES"],
    ["QA4280","Q0Q0","Bodo/Glimt 90 Minutes",1,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","HOME_REGULATION"],
    ["QA4280","Q0Q1","Bodo/Glimt Hiệp phụ",1,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","HOME_EXTRA_TIME"],
    ["QA4280","Q0Q2","Bodo/Glimt Phạt đền",1,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","HOME_PENALTIES"],
    ["QA4280","Q1Q0","Sandefjord Fb 90 Minutes",3,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","AWAY_REGULATION"],
    ["QA4280","Q1Q1","Sandefjord Fb Hiệp phụ",3,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","AWAY_EXTRA_TIME"],
    ["QA4280","Q1Q2","Sandefjord Fb Phạt đền",3,"Cách thức giành quyền đi tiếp / chiến thắng","FT_QUALIFICATION_METHOD","AWAY_PENALTIES"]
  ] as const)("retains distinct qualification terms %s %s",(code,suffix,name,side,label,marketType,selection)=>{
    expect(decode(code,suffix,name,side,label)).toEqual({marketType,selection,lineText:null});
  });
  it.each([
    ["QA6337","Q0Q1","Có",1,"Có hiệp phụ"],
    ["QA5302","Q0Q1","Có",1,"Có phạt đền được trao hay không"],
    ["QA4280","Q0Q1","Bodo/Glimt 90 Minutes",1,"Cách thức giành quyền đi tiếp / chiến thắng"],
    ["QA4280","Q0Q0","Sandefjord Fb 90 Minutes",1,"Cách thức giành quyền đi tiếp / chiến thắng"],
    ["QA4280","Q1Q2","Sandefjord Fb Phạt đền",1,"Cách thức giành quyền đi tiếp / chiến thắng"],
    ["QA4280","Q2Q0","Không ghi bàn",2,"Cách thức giành quyền đi tiếp / chiến thắng"]
  ] as const)("rejects conflicting qualification predicate %s %s",(code,suffix,name,side,label)=>{
    expect(decode(code,suffix,name,side,label)).toBeNull();
  });
});
