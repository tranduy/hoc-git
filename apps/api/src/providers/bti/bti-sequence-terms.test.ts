import { describe, expect, it } from "vitest";
import { decodeBtiSequenceTerms } from "./bti-sequence-terms.js";

const marketId = "0QA884777943912706070";
const teams = ["Bodo/Glimt", "Sandefjord Fb"] as const;
const item = (suffix: string, name: string, side: number, line: number | null = null) => ({
  id: marketId + suffix, name, side, line: line ?? 0, lineWasMissing: line === null
});
const decode = (code: string, suffix: string, name: string, side: number, label: string, line: number | null = null) =>
  decodeBtiSequenceTerms(code, marketId, item(suffix, name, side, line), label, teams);

describe("BTI sequence, timing and named-team native terms", () => {
  it.each([
    ["QA5089", "Q0Q1", "Bodo/Glimt", 1, "Chạm mốc 11 phạt góc trước", "CORNER_FT_RACE", "HOME", "11"],
    ["QA5089", "Q0Q2", "Sandefjord Fb", 3, "Chạm mốc 11 phạt góc trước", "CORNER_FT_RACE", "AWAY", "11"],
    ["QA5089", "Q0Q0", "cũng không", 2, "Chạm mốc 11 phạt góc trước", "CORNER_FT_RACE", "NEITHER", "11"],
    ["QA5108", "Q0Q480", "00:00 - 08:00", 0, "Thời điểm phạt góc đầu tiên", "CORNER_FT_FIRST_SECONDS_RANGE", "SECONDS_0_480", null],
    ["QA5108", "Q481Q5400", "08:01 - 90:00", 0, "Thời điểm phạt góc đầu tiên", "CORNER_FT_FIRST_SECONDS_RANGE", "SECONDS_481_5400", null],
    ["QA5516", "Q0Q1", "Có", 1, "Thẻ đầu tiên xuất hiện trước phút 27:00", "CARD_FT_FIRST_BEFORE", "YES", "1620"],
    ["QA5516", "Q0Q0", "Không", 3, "Thẻ đầu tiên xuất hiện trước phút 27:00", "CARD_FT_FIRST_BEFORE", "NO", "1620"],
    ["QA6037", "Q0Q159", "Ném biên trong (00:00 - 00:59)", 1, "Cả hai đội sẽ: (theo phút)", "FT_BOTH_TEAMS_WINDOW_ACTION", "THROW_IN_SECONDS_0_59", null],
    ["QA6037", "Q60Q1119", "Ném biên trong (01:00 - 01:59)", 1, "Cả hai đội sẽ: (theo phút)", "FT_BOTH_TEAMS_WINDOW_ACTION", "THROW_IN_SECONDS_60_119", null],
    ["QA6037", "Q120Q3179", "Đá phạt (02:00 - 02:59)", 3, "Cả hai đội sẽ: (theo phút)", "FT_BOTH_TEAMS_WINDOW_ACTION", "FREE_KICK_SECONDS_120_179", null]
  ] as const)("decodes remaining time predicate %s %s", (code, suffix, name, side, label, marketType, selection, lineText) => {
    expect(decode(code, suffix, name, side, label)).toEqual({ marketType, selection, lineText });
  });
  it.each([
    ["QA5089", "Q0Q1", "Bodo/Glimt", 1, "Chạm mốc 9 phạt góc trước"],
    ["QA5108", "Q481Q5400", "08:00 - 90:00", 0, "Thời điểm phạt góc đầu tiên"],
    ["QA5108", "Q0Q480", "00:00 - 08:00", 1, "Thời điểm phạt góc đầu tiên"],
    ["QA5108", "Q0Q0", "Không", 0, "Thời điểm phạt góc đầu tiên"],
    ["QA5516", "Q0Q1", "Có", 1, "Thẻ đầu tiên xuất hiện trước phút 28:00"],
    ["QA6037", "Q0Q159", "Đá phạt (00:00 - 00:59)", 1, "Cả hai đội sẽ: (theo phút)"],
    ["QA6037", "Q60Q1119", "Ném biên trong (01:00 - 01:58)", 1, "Cả hai đội sẽ: (theo phút)"],
    ["QA6037", "Q60Q1119", "Ném biên trong (01:00 - 01:59)", 3, "Cả hai đội sẽ: (theo phút)"],
    ["QA6037", "Q60Q1119", "Ném biên trong (01:00 - 01:59)", 1, "Có đội sẽ: (theo phút)"]
  ] as const)("rejects contradicting time predicate %s %s", (code, suffix, name, side, label) => {
    expect(decode(code, suffix, name, side, label)).toBeNull();
  });
  it.each([
    ["QA4448", "Q0Q1", "Hiệp 1", 1, "Hiệp ghi bàn thắng đầu", "FH_TOTAL", "OVER", "0.5"],
    ["QA4448", "Q0Q0", "Không", 2, "Hiệp ghi bàn thắng đầu", "FT_TOTAL", "UNDER", "0.5"],
    ["QA4448", "Q0Q2", "Hiệp 2", 3, "Hiệp ghi bàn thắng đầu", "FT_FIRST_SCORING_HALF", "SECOND_HALF", null],
    ["QA4450", "Q0Q1", "Hiệp 1", 1, "Bodo/Glimt: Hiệp ghi bàn đầu tiên của đội", "HOME_FH_TOTAL", "OVER", "0.5"],
    ["QA4450", "Q0Q10", "Không", 2, "Sandefjord Fb: Hiệp ghi bàn đầu tiên của đội", "AWAY_FT_TOTAL", "UNDER", "0.5"],
    ["QA4450", "Q0Q12", "Hiệp 2", 3, "Sandefjord Fb: Hiệp ghi bàn đầu tiên của đội", "AWAY_FT_FIRST_SCORING_HALF", "SECOND_HALF", null],
    ["QA4460", "Q0Q0", "cũng không", 2, "Đua tới 2 bàn thắng", "FT_GOAL_RACE", "NEITHER", "2"],
    ["QA4461", "Q0Q1", "Bodo/Glimt", 1, "Đua tới 3 bàn thắng", "FT_GOAL_RACE", "HOME", "3"],
    ["QA4464", "Q0Q2", "Sandefjord Fb", 3, "Đua tới 6 bàn thắng", "FT_GOAL_RACE", "AWAY", "6"],
    ["QA1474", "Q0Q1", "Bodo/Glimt", 1, "Đua tới 5 lần phạt góc sớm nhất", "CORNER_FT_RACE", "HOME", "5"],
    ["QA1476", "Q0Q0", "cũng không", 2, "Đua tới 9 lần phạt góc sớm nhất", "CORNER_FT_RACE", "NEITHER", "9"],
    ["QA5090", "Q0Q2", "Sandefjord Fb", 3, "Hiệp 1 chạm mốc 3 phạt góc trước", "CORNER_FH_RACE", "AWAY", "3"],
    ["ML235", "H", "Bodo/Glimt", 1, "Cược 1X2 đội đầu tiên ghi bàn", "FT_FIRST_GOAL_TEAM", "HOME", null],
    ["ML235", "D", "cũng không", 2, "Cược 1X2 đội đầu tiên ghi bàn", "FT_TOTAL", "UNDER", "0.5"],
    ["ML20", "A", "Sandefjord Fb", 3, "Ghi bàn cuối Cược 1X2", "FT_LAST_GOAL_TEAM", "AWAY", null],
    ["ML5188", "D", "cũng không", 2, "Ghi bàn trước hiệp 1", "FH_TOTAL", "UNDER", "0.5"],
    ["ML6073", "D", "Hoà", 2, "Ghi bàn trước hiệp 2", "SH_TOTAL", "UNDER", "0.5"],
    ["QA701", "Q0Q0", "Bodo/Glimt", 1, "Thắng lội ngược dòng", "HOME_FT_COMEBACK_WIN", "YES", null],
    ["QA701", "Q0Q1", "Sandefjord Fb", 3, "Thắng lội ngược dòng", "AWAY_FT_COMEBACK_WIN", "YES", null],
    ["QA698", "Q0Q0", "Không", 3, "Bàn thắng phản lưới nhà", "FT_OWN_GOAL", "NO", null],
    ["QA4977", "Q0Q1", "Có", 1, "Có phạt đền được trao hay không", "FT_PENALTY_AWARDED", "YES", null],
    ["QA6012", "Q0Q0", "Không", 3, "Có phạt đền Hiệp 1", "FH_PENALTY_AWARDED", "NO", null],
    ["QA5012", "Q0Q1", "Có", 1, "Cả hai đội được hưởng phạt đền", "FT_BOTH_TEAMS_PENALTY_AWARDED", "YES", null],
    ["QA6015", "Q0Q1", "Sandefjord Fb", 3, "Đội ghi bàn từ phạt đền", "AWAY_FT_SCORE_PENALTY", "YES", null],
    ["QA6016", "Q0Q0", "Bodo/Glimt", 1, "Đội đá hỏng phạt đền", "HOME_FT_MISS_PENALTY", "YES", null],
    ["QA65", "Q0Q1120", "11-20 phút", 1, "Thời gian ghi bàn thắng đầu tiên", "FT_FIRST_GOAL_MINUTE_RANGE", "MINUTES_11_20", null],
    ["QA6017", "Q0Q599", "00:00 - 09:59", 0, "Phút ghi bàn đầu tiên", "FT_FIRST_GOAL_BEFORE", "YES", "600"],
    ["QA6017", "Q600Q1199", "10:00 - 19:59", 0, "Phút ghi bàn đầu tiên", "FT_FIRST_GOAL_SECONDS_RANGE", "SECONDS_600_1199", null],
    ["QA6018", "Q600Q1199", "10:00 - 19:59", 0, "Bodo/Glimt: Phút ghi bàn thứ nhất của đội", "HOME_FT_FIRST_GOAL_SECONDS_RANGE", "SECONDS_600_1199", null],
    ["QA6053", "Q0Q599", "00:00 - 09:59", 0, "Sandefjord Fb: Phút ghi bàn thứ nhất của đội", "AWAY_FT_FIRST_GOAL_BEFORE", "YES", "600"],
    ["QA5088", "Q0Q900", "00:00 - 15:00", 0, "Phút ghi bàn cuối cùng", "FT_LAST_GOAL_SECONDS_RANGE", "SECONDS_0_900", null],
    ["QA5088", "Q901Q1800", "15:01 - 30:00", 0, "Phút ghi bàn cuối cùng", "FT_LAST_GOAL_SECONDS_RANGE", "SECONDS_901_1800", null],
    ["QA5088", "Q0Q0", "Không ghi bàn", 0, "Phút ghi bàn cuối cùng", "FT_TOTAL", "UNDER", "0.5"],
    ["QA6036", "Q600Q0", "10:00 - Không", 3, "Bàn thắng đầu tiên trước phút", "FT_FIRST_GOAL_BEFORE", "NO", "600"],
    ["QA5614", "Q1200Q1", "20:00 - Có", 1, "Bodo/Glimt: Đội ghi bàn thứ nhất trước", "HOME_FT_FIRST_GOAL_BEFORE", "YES", "1200"],
    ["QA5617", "Q1200Q0", "20:00 - Không", 3, "Sandefjord Fb: Đội ghi bàn thứ nhất trước", "AWAY_FT_FIRST_GOAL_BEFORE", "NO", "1200"],
    ["QA5521", "Q0Q1", "Có", 1, "Bàn thắng đầu tiên trước phút 33:00", "FT_FIRST_GOAL_BEFORE", "YES", "1980"],
    ["QA5522", "Q0Q0", "Không", 3, "Có bàn thắng sau phút 68:00", "FT_GOAL_AFTER", "NO", "4080"],
    ["QA1447", "Q0Q2", "Đánh đầu", 1, "Cách ghi bàn thắng đầu", "FT_FIRST_GOAL_METHOD", "HEADER", null],
    ["QA6011", "Q0Q3", "Phạt đền", 2, "Cách ghi bàn đầu tiên", "FT_FIRST_GOAL_METHOD", "PENALTY", null],
    ["QA6011", "Q0Q6", "No goal", 1, "Cách ghi bàn đầu tiên", "FT_TOTAL", "UNDER", "0.5"]
  ] as const)("decodes corroborated %s %s", (code,suffix,name,side,label,marketType,selection,lineText) => {
    expect(decode(code,suffix,name,side,label)).toEqual({marketType,selection,lineText});
  });

  it("recognizes the exact first ten-minute native O/U offer without treating it as full-time total", () => {
    const label="Bàn thắng trong 10 phút đầu (00:00 - 09:59)";
    expect(decode("OU4620","OMM","Tài",1,label,0.5)).toEqual({marketType:"FT_FIRST_GOAL_BEFORE",selection:"YES",lineText:"600"});
    expect(decode("OU4620","UMM","Xỉu",3,label,0.5)).toEqual({marketType:"FT_FIRST_GOAL_BEFORE",selection:"NO",lineText:"600"});
    expect(decode("OU4620","OMM","Tài",1,label,1.5)).toBeNull();
  });

  it.each([
    ["QA4450","Q0Q11","Hiệp 1",1,"Bodo/Glimt: Hiệp ghi bàn đầu tiên của đội"],
    ["QA4460","Q0Q1","Sandefjord Fb",1,"Đua tới 2 bàn thắng"],
    ["QA4460","Q0Q0","Bodo/Glimt",2,"Đua tới 2 bàn thắng"],
    ["QA4460","Q0Q1","Bodo/Glimt",1,"Đua tới 3 bàn thắng"],
    ["QA1474","Q0Q1","Bodo/Glimt",1,"Đua tới 5 bàn thắng"],
    ["QA5090","Q0Q1","Bodo/Glimt",1,"Đua tới 3 lần phạt góc sớm nhất"],
    ["ML235","H","Sandefjord Fb",1,"Cược 1X2 đội đầu tiên ghi bàn"],
    ["QA701","Q0Q0","Không",1,"Thắng lội ngược dòng"],
    ["QA698","Q0Q1","Lẻ",1,"Bàn thắng phản lưới nhà"],
    ["QA6018","Q600Q1199","10:00 - 19:59",0,"Sandefjord Fb: Phút ghi bàn thứ nhất của đội"],
    ["QA6017","Q600Q1199","10:00 - 20:00",0,"Phút ghi bàn đầu tiên"],
    ["QA5088","Q900Q1800","15:01 - 30:00",0,"Phút ghi bàn cuối cùng"],
    ["QA6036","Q600Q1","20:00 - Có",1,"Bàn thắng đầu tiên trước phút"],
    ["QA5521","Q0Q1","Có",1,"Bàn thắng đầu tiên trước phút 34:00"],
    ["QA65","Q0Q1120","11-21 phút",1,"Thời gian ghi bàn thắng đầu tiên"],
    ["QA1447","Q0Q2","Own goal",1,"Cách ghi bàn thắng đầu"]
  ] as const)("rejects contradictory sequence terms %s %s",(code,suffix,name,side,label)=>{
    expect(decode(code,suffix,name,side,label)).toBeNull();
  });

  it("rejects missing/wrong identity, unknown types and unproven two-penalty semantics",()=>{
    expect(decodeBtiSequenceTerms("QA4460",marketId,item("Q0Q1","Bodo/Glimt",1),"Đua tới 2 bàn thắng")).toBeNull();
    expect(decodeBtiSequenceTerms("QA4460",marketId,{...item("Q0Q1","Bodo/Glimt",1),id:"different"},"Đua tới 2 bàn thắng",teams)).toBeNull();
    expect(decode("QA4460","Q0Q1","Bodo/Glimt",1,"Đua tới 2 bàn thắng",3)).toBeNull();
    expect(decode("QA99999","Q0Q1","Có",1,"Bàn thắng phản lưới nhà")).toBeNull();
    expect(decode("QA6020","Q0Q1","Có",1,"Có hai quả phạt đền")).toBeNull();
  });
});
