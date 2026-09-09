import { describe, expect, it } from "vitest";
import { decodeBtiStatTerms } from "./bti-stat-terms.js";

const marketId = "native";
const teams = ["Bodo/Glimt", "Sandefjord Fb"] as const;
const decode = (code: string, suffix: string, name: string, side: number, line: number | null, label: string) =>
  decodeBtiStatTerms(code, marketId, { id: marketId + suffix, name, side, line: line ?? 0, lineWasMissing: line === null }, label, teams);

describe("BTI named statistic and period terms", () => {
  it.each([
    ["ML5511", "H", "Bodo/Glimt", 1, null, "Kết quả hiệp 1 hoặc cả trận", "FT_HALF_OR_FULL_RESULT", "HOME", null],
    ["ML5511", "D", "Hoà", 2, null, "Kết quả hiệp 1 hoặc cả trận", "FT_HALF_OR_FULL_RESULT", "DRAW", null],
    ["ML15", "H", "Bodo/Glimt", 1, null, "Quả phạt góc đầu tiên", "CORNER_FT_FIRST_TEAM", "HOME", null],
    ["ML16", "A", "Sandefjord Fb", 3, null, "Quả phạt góc cuối cùng", "CORNER_FT_LAST_TEAM", "AWAY", null],
    ["ML12", "H", "Bodo/Glimt", 1, null, "Đội nhận thẻ phạt đầu tiên", "CARD_FT_FIRST_TEAM", "HOME", null],
    ["ML5171", "D", "cũng không", 2, null, "Thẻ cuối cùng 3 cửa", "CARD_FT_LAST_TEAM", "NONE", null],
    ["ML5171", "A", "Sandefjord Fb", 3, null, "Thẻ cuối cùng 3 cửa", "CARD_FT_LAST_TEAM", "AWAY", null],
    ["ML5168", "A", "Sandefjord Fb", 3, null, "Việt vị đầu tiên", "OFFSIDES_FT_FIRST_TEAM", "AWAY", null],
    ["ML5169", "H", "Bodo/Glimt", 1, null, "Cú sút trúng đích đầu tiên", "SHOTS_ON_TARGET_FT_FIRST_TEAM", "HOME", null],
    ["ML167", "A", "Sandefjord Fb", 3, null, "Qua vòng loại", "FT_QUALIFY", "AWAY", null],
    ["ML168", "H", "Bodo/Glimt", 1, null, "Giành cúp", "FT_WIN_CUP", "HOME", null],
    ["QA4405", "Q0Q1", "Lẻ", 1, null, "Cược Chẵn/Lẻ số thẻ", "CARD_FT_ODD_EVEN", "ODD", null],
    ["QA4405", "Q0Q2", "Chẵn", 3, null, "Cược Chẵn/Lẻ số thẻ", "CARD_FT_ODD_EVEN", "EVEN", null],
    ["OU5110", "OMM", "Tài", 1, 10.5, "Tổng cú sút hiệp 1 Tài/Xỉu", "SHOTS_FH_TOTAL", "OVER", "10.5"],
    ["OU5121", "UMM", "Xỉu", 3, 7.5, "Tổng phát bóng hiệp 1 Tài/Xỉu", "GOAL_KICKS_FH_TOTAL", "UNDER", "7.5"],
    ["OU5116", "OMM", "Tài", 1, 21.5, "Sandefjord Fb: Tổng ném biên đội Tài/Xỉu", "AWAY_THROW_INS_FT_TOTAL", "OVER", "21.5"],
    ["OU5120", "UMM", "Xỉu", 3, 7.5, "Bodo/Glimt: Tổng phát bóng đội Tài/Xỉu", "HOME_GOAL_KICKS_FT_TOTAL", "UNDER", "7.5"],
    ["OU5107", "OMM", "Tài", 1, 3.5, "Bodo/Glimt: Tổng phạt góc đội hiệp 2", "HOME_CORNER_SH_TOTAL", "OVER", "3.5"],
    ["OU5539", "UMM", "Xỉu", 3, 1.5, "Bodo/Glimt: Tổng thẻ đội hiệp 2 Tài/Xỉu", "HOME_CARD_SH_TOTAL", "UNDER", "1.5"],
    ["QA6113", "Q0Q0", "Không ghi bàn", 0, null, "Các khoảng tổng bàn thắng", "FT_TOTAL", "UNDER", "0.5"],
    ["QA6136", "Q0Q0", "Không ghi bàn", 0, null, "Bodo/Glimt: Khoảng tổng bàn thắng của đội", "HOME_FT_TOTAL", "UNDER", "0.5"],
    ["QA6137", "Q7Q-1", "7 or more", 0, null, "Sandefjord Fb: Khoảng tổng bàn thắng của đội", "AWAY_FT_TOTAL", "OVER", "6.5"],
    ["QA5517", "Q16Q-1", "16+", 0, null, "Khoảng số cú sút trúng đích", "SHOTS_ON_TARGET_FT_TOTAL", "OVER", "15.5"],
    ["QA6035", "Q3Q4", "3 - 4", 0, null, "Khoảng số thẻ", "CARD_FT_RANGE", "RANGE_3_4", null],
    ["HC157", "AMM", "Sandefjord Fb", 3, 0, "Hoà được hoàn tiền", "FT_DRAW_NO_BET", "AWAY", null],
    ["HC270", "TMM", "Hoà, Bodo/Glimt", 2, -1, "Cược chấp 3 chiều", "FT_EUROPEAN_HANDICAP", "DRAW", "-1"],
    ["HC271", "AMM", "Sandefjord Fb", 3, 1, "Cược chấp 3 chiều hiệp 1", "FH_EUROPEAN_HANDICAP", "AWAY", "-1"],
    ["HC359", "HMM", "Bodo/Glimt", 1, -2, "Cược chấp số quả phạt góc 3 chiều", "CORNER_FT_EUROPEAN_HANDICAP", "HOME", "-2"],
    ["HC2219", "AP100", "Sandefjord Fb", 3, 1.5, "Kèo cược chấp châu Âu thay thế (Được thanh toán dựa trên tỷ số cuối cùng)", "FT_FINAL_SCORE_AH", "AWAY", "-1.5"],
    ["OU6309", "OMM", "Tài", 1, 3, "Tài/Xỉu cả trận 3 cửa", "FT_TOTAL", "OVER", "3.5"],
    ["OU621", "UMM", "Xỉu", 3, 9, "Cược Tài/Xỉu số quả phạt góc 3 chiều", "CORNER_FT_TOTAL", "UNDER", "8.5"],
    ["OU6419", "EMM", "Chính xác", 2, 5, "1st Half - 3way Corners O/U", "CORNER_FH_RANGE", "RANGE_5_5", null],
    ["ML619", "H", "Bodo/Glimt", 1, null, "Cược 1X2 số quả phạt góc toàn trận", "CORNER_FT_1X2", "HOME", null],
    ["ML5153", "D", "Hoà", 2, null, "Hiệp có nhiều phạt góc nhất", "CORNER_FT_HIGHEST_SCORING_HALF", "EQUAL", null],
    ["ML117", "D", "Hoà", 2, null, "Cược 1X2 đến phút thứ 70", "FT_RESULT_AT_SECONDS", "DRAW", "4200"],
    ["ML6064", "A", "Sandefjord Fb", 3, null, "Kết quả theo phút (00:00 - 59:59)", "FT_RESULT_AT_SECONDS", "AWAY", "3599"],
    ["HC4319", "AMM", "Sandefjord Fb", 3, 0.5, "Cược chấp châu Á 15:01 - 30:00", "FT_WINDOW_901_1800_AH", "AWAY", "-0.5"],
    ["OU4318", "OMM", "Tài", 1, 0.5, "Cược Tài/Xỉu 00:00 - 15:00", "FT_WINDOW_0_900_TOTAL", "OVER", "0.5"],
    ["ML4323", "D", "Hoà", 2, null, "Kèo 1X2 phút 75:01 - 90:00", "FT_WINDOW_4501_5400_RESULT", "DRAW", null]
  ] as const)("decodes native %s %s", (code, suffix, name, side, line, label, marketType, selection, lineText) => {
    expect(decode(code, suffix, name, side, line, label)).toEqual({ marketType, selection, lineText });
  });
  it.each([
    ["ML5511", "D", "Hoà", 2, null, "Kết quả hiệp 1 và cả trận"],
    ["ML15", "H", "Sandefjord Fb", 1, null, "Quả phạt góc đầu tiên"],
    ["ML15", "D", "Hoà", 2, null, "Quả phạt góc đầu tiên"],
    ["ML16", "A", "Sandefjord Fb", 3, 1, "Quả phạt góc cuối cùng"],
    ["ML12", "H", "Bodo/Glimt", 1, null, "Quả phạt góc đầu tiên"],
    ["ML5171", "D", "Hoà", 2, null, "Thẻ cuối cùng 3 cửa"],
    ["ML167", "H", "Bodo/Glimt", 1, null, "Giành cúp"],
    ["ML168", "H", "Bodo/Glimt", 1, null, "Qua vòng loại"],
    ["QA4405", "Q0Q0", "Chẵn", 3, null, "Cược Chẵn/Lẻ số thẻ"],
    ["QA4405", "Q0Q1", "Lẻ", 1, null, "Cược Chẵn/Lẻ số phạt góc"],
    ["OU121", "OMM", "Tài", 1, 9.5, "Cược Tài/Xỉu số phạt góc"],
    ["OU121", "OMM", "Tài", 1, 9.5, "Cược Tài/Xỉu số cú sút trúng mục tiêu hiệp 1"],
    ["OU5110", "OMM", "Tài", 1, 10.5, "Tổng cú sút hiệp 2 Tài/Xỉu"],
    ["OU5121", "UMM", "Xỉu", 3, 7.5, "Tổng phát bóng Tài/Xỉu"],
    ["OU5116", "OMM", "Tài", 1, 21.5, "Unknown: Tổng ném biên đội Tài/Xỉu"],
    ["OU5116", "OMM", "Tài", 3, 21.5, "Sandefjord Fb: Tổng ném biên đội Tài/Xỉu"],
    ["OU1967", "OMM", "Tài", 1, 1.5, "Sandefjord Fb: Cược Tài/Xỉu tổng số thẻ của đội"],
    ["QA6113", "Q0Q1", "Không ghi bàn", 0, null, "Các khoảng tổng bàn thắng"],
    ["QA6113", "Q7Q-1", "7", 0, null, "Các khoảng tổng bàn thắng"],
    ["QA6035", "Q0Q0", "Không ghi bàn", 0, null, "Khoảng số thẻ"],
    ["QA5517", "Q1Q3", "1-4", 0, null, "Khoảng số cú sút trúng đích"],
    ["HC270", "TMM", "Hoà, Sandefjord Fb", 2, -1, "Cược chấp 3 chiều"],
    ["HC271", "HMM", "Bodo/Glimt", 1, -1, "Cược chấp 3 chiều"],
    ["HC359", "HMM", "Bodo/Glimt", 1, -2, "Cược chấp 3 chiều"],
    ["HC2219", "HMM", "Bodo/Glimt", 1, 0.5, "Kèo cược chấp châu Âu thay thế"],
    ["HC4319", "HMM", "Bodo/Glimt", 1, 0.3, "Cược chấp châu Á 15:01 - 30:00"],
    ["HC4319", "HMM", "Bodo/Glimt", 1, 0.5, "Cược chấp châu Á 15:00 - 30:00"],
    ["ML4323", "D", "Hoà", 2, 2, "Kèo 1X2 phút 75:01 - 90:00"],
    ["ML5153", "H", "1st Half", 1, 2, "Hiệp có nhiều phạt góc nhất"],
    ["ML117", "H", "Bodo/Glimt", 1, null, "Cược 1X2 đến phút thứ 30"],
    ["OU6309", "EMM", "Chính xác", 2, 3, "Cược Tài/Xỉu số quả phạt góc 3 chiều"],
    ["OU4330", "OMM", "Tài", 1, 0.5, "Bàn thắng trong 10 phút đầu (00:00 - 09:59)"]
  ] as const)("rejects conflicting native %s %s", (code, suffix, name, side, line, label) => {
    expect(decode(code, suffix, name, side, line, label)).toBeNull();
  });
  it("requires an actual advertised market identity", () => {
    expect(decodeBtiStatTerms("ML619", "", { id: "H", name: teams[0], side: 1, line: 0, lineWasMissing: true }, "Cược 1X2 số quả phạt góc toàn trận", teams)).toBeNull();
  });
});
