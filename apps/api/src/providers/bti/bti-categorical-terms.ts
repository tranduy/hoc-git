import type { MarketType, ProviderPlayerIdentity } from "@tool-chenh/contracts";
import { btiSequenceCodes, decodeBtiSequenceTerms } from "./bti-sequence-terms.js";
import { btiPlayerCodes, decodeBtiPlayerTerms } from "./bti-player-terms.js";
import { btiStatCodes, decodeBtiStatTerms } from "./bti-stat-terms.js";
import { btiCombinationCodes, decodeBtiCombinationTerms } from "./bti-combination-terms.js";

export interface BtiNamedSelection {
  readonly id: string; readonly name: string; readonly side: number;
  readonly line: number; readonly lineWasMissing: boolean;
}
interface Terms { readonly marketType: MarketType; readonly selection: string; readonly lineText: string | null; readonly player?: ProviderPlayerIdentity }
export const btiCategoricalCodes = new Set([...btiSequenceCodes,...btiPlayerCodes,...btiStatCodes,...btiCombinationCodes,"QA60","QA144","QA3580","QA4030","QA119","QA120","QA4452",
  "QA154","QA155","QA4300","QA4302","QA62","QA89","QA4451","QA3583","QA696","QA697",
  "QA277","QA4274","QA276","QA278","ML159","ML160","QA291","QA93","QA4303","QA4031","QA5528","QA5165","QA5170"]);
const terms = (marketType: MarketType, selection: string, lineText: string | null = null): Terms => ({marketType,selection,lineText});
const nameKey = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/gu,"").replace(/[đð]/giu,"d")
  .toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu," ").trim();
export function btiNamedSubject(label: string, teams?: readonly [string,string]): "HOME" | "AWAY" | null {
  if (teams === undefined || !label.includes(":")) return null;
  const subject = nameKey(label.split(":")[0]!);
  const home = subject === nameKey(teams[0]), away = subject === nameKey(teams[1]);
  return home === away ? null : home ? "HOME" : "AWAY";
}
const opponent = (team: "HOME" | "AWAY") => team === "HOME" ? "AWAY" : "HOME";
const sideOf = (home: number, away: number): number => home > away ? 1 : home < away ? 3 : 2;
const integer = (value: string): boolean => /^(?:0|[1-9]\d?)$/u.test(value);
function range(categorical: MarketType, total: MarketType, lower: number, upper: number | null): Terms {
  return upper === null ? terms(total,"OVER",String(lower-0.5)) : lower === 0 ? terms(total,"UNDER",String(upper+0.5))
    : terms(categorical,`RANGE_${lower}_${upper}`);
}
function namedResult(label: string, teams: readonly [string,string]): "HOME" | "AWAY" | "DRAW" | null {
  const key=nameKey(label);
  if (/^(?:draw|tie|hoa)$/u.test(key)) return "DRAW";
  const home=key===nameKey(teams[0]),away=key===nameKey(teams[1]);
  return home===away?null:home?"HOME":"AWAY";
}

/** Each named selection is corroborated with BTI's own ID suffix. Numeric sides
 * are not binary positions: correct-score grids legitimately repeat them. */
export function decodeBtiCategoricalTerms(code: string, marketId: string, item: BtiNamedSelection,
  label: string, teams?: readonly [string,string]): Terms | null {
  if(btiSequenceCodes.has(code))return decodeBtiSequenceTerms(code,marketId,item,label,teams);
  if(btiPlayerCodes.has(code))return decodeBtiPlayerTerms(code,marketId,item,label,teams);
  if(btiStatCodes.has(code))return decodeBtiStatTerms(code,marketId,item,label,teams);
  if(btiCombinationCodes.has(code))return decodeBtiCombinationTerms(code,marketId,item,label,teams);
  if (!btiCategoricalCodes.has(code) || !item.id.startsWith(marketId) || (!item.lineWasMissing && item.line !== 0)) return null;
  const suffix=item.id.slice(marketId.length), name=nameKey(item.name);
  const scoreTypes: Readonly<Record<string, readonly [MarketType,MarketType]>> = {
    QA60:["FT_CORRECT_SCORE","FT_TOTAL"],QA144:["FH_CORRECT_SCORE","FH_TOTAL"],
    QA3580:["SH_CORRECT_SCORE","SH_TOTAL"],QA4030:["CORNER_FT_CORRECT_SCORE","CORNER_FT_TOTAL"],
    QA4031:["CORNER_FH_CORRECT_SCORE","CORNER_FH_TOTAL"],QA5170:["CARD_FT_CORRECT_SCORE","CARD_FT_TOTAL"]
  };
  const scoreType=scoreTypes[code];
  if (scoreType!==undefined) {
    const match=/^Q(\d+)Q(\d+)$/u.exec(suffix), score=/^(\d+)\s*[:\-]\s*(\d+)$/u.exec(item.name.trim());
    if (match===null||score===null||!integer(match[1]!)||!integer(match[2]!)||
      match[1]!==score[1]||match[2]!==score[2]||item.side!==sideOf(Number(match[1]),Number(match[2]))) return null;
    // BTI's 9:9 is a literal score. AP's AOS sentinel is not reused here.
    return match[1]==="0"&&match[2]==="0"?terms(scoreType[1],"UNDER","0.5")
      :terms(scoreType[0],`SCORE_${match[1]}_${match[2]}`);
  }
  if(code==="QA291"){
    const m=/^Q0Q(-?[1-4])$/u.exec(suffix);if(m===null)return null;
    const bucket=Number(m[1]),away=bucket<0;if(item.side!==(away?3:1))return null;
    const sets:Readonly<Record<number,readonly (readonly [number,number])[]>>={
      1:[[1,0],[2,0],[3,0]],2:[[4,0],[5,0],[6,0]],3:[[2,1],[3,1],[4,1]],4:[[3,2],[4,2],[4,3],[5,1]]};
    const sort=(pairs:readonly (readonly [number,number])[])=>[...pairs].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const expected=sort(sets[Math.abs(bucket)]!.map(([h,a])=>away?[a,h] as const:[h,a] as const));
    const actual: [number,number][]=[];
    for(const part of item.name.split(",")){
      const score=/^\s*(\d+)\s*[:-]\s*(\d+)\s*$/u.exec(part);
      if(score===null||!integer(score[1]!)||!integer(score[2]!))return null;
      actual.push([Number(score[1]),Number(score[2])]);
    }
    if(JSON.stringify(sort(actual))!==JSON.stringify(expected))return null;
    return terms("FT_SCORE_SET",`SCORES_${expected.map(([h,a])=>`${h}_${a}`).join("|")}`);
  }
  if(code==="QA93"||code==="QA4303"){
    const half=code==="QA4303";
    if(suffix==="Q0Q0")return item.side===1&&/^(?:hoa khong ban thang|goalless draw)$/u.test(name)
      ?terms(half?"FH_TOTAL":"FT_TOTAL","UNDER","0.5"):null;
    if(suffix==="Q0Q1")return item.side===3&&/^(?:hoa ban thang|score draw)$/u.test(name)
      ?terms(half?"FH_RESULT_BTTS":"FT_RESULT_BTTS","DRAW_YES"):null;
    const m=/^Q0Q([1-4])([12])$/u.exec(suffix);if(m===null||teams===undefined)return null;
    const home=m[2]==="1",count=Number(m[1]);if(item.side!==(home?1:3))return null;
    const team=nameKey(teams[home?0:1]),tail=count===4?"4 or more":`${count} goal`;
    if(name!==`${team} to win by ${tail}`&&!(count<4&&name===`${team} to win by ${tail}s`))return null;
    return terms(half?"FH_WIN_MARGIN":"FT_WIN_MARGIN",`${home?"HOME":"AWAY"}_${count}${count===4?"_PLUS":""}`);
  }
  if (code==="QA119"||code==="QA120"||code==="QA154"||code==="QA155") {
    const m=/^Q([012])Q(-?\d+)$/u.exec(suffix);if(m===null)return null;
    const teamGoals=code==="QA154"||code==="QA155", half=code==="QA120"||code==="QA155";
    const n=Number(m[2]),count=Math.abs(n);if(!Number.isInteger(count)||count>99)return null;
    let tail=name,subject:"HOME"|"AWAY"|null=null;
    if(teamGoals){if(teams===undefined||!['1','2'].includes(m[1]!))return null;
      subject=m[1]==="1"?"HOME":"AWAY";const team=nameKey(teams[subject==="HOME"?0:1]);
      if(!name.startsWith(`${team} `)||item.side!==(subject==="HOME"?1:3))return null;tail=name.slice(team.length+1);
    }else if(m[1]!=="0")return null;
    const expected=n<0?new RegExp(`^${count} (?:goals? and more|ban thang tro len)$`,"u")
      :new RegExp(`^${count} (?:goals?|ban thang)$`,"u");
    if(!(count===0&&/^(?:khong ban thang|no goals?)$/u.test(tail))&&!expected.test(tail))return null;
    const period=half?"FH":"FT";
    const categorical:MarketType=subject===null?(half?"FH_GOAL_RANGE":"FT_GOAL_RANGE"):`${subject}_${period}_GOAL_RANGE`;
    const total:MarketType=subject===null?(half?"FH_TOTAL":"FT_TOTAL"):`${subject}_${period}_TOTAL`;
    return range(categorical,total,count,n<0?null:count);
  }
  if(code==="QA4452"||code==="QA4300"||code==="QA4302"){
    const m=/^Q(\d+)Q(-?\d+)$/u.exec(suffix);if(m===null||!integer(m[1]!))return null;
    const lower=Number(m[1]),upper=m[2]==="-1"?null:Number(m[2]);
    if(upper!==null&&(!integer(m[2]!)||upper<lower)||upper===null&&lower===0)return null;
    const expected=code==="QA4452" ? (lower===0?`under ${upper!+1} goals`:upper===null?`over ${lower-1} goals`:`${lower} or ${upper} goals`)
      :upper===null?String(lower):`${lower} ${upper}`;
    if(name!==expected || (code!=="QA4452"&&upper===null&&!/\+\s*$/u.test(item.name)))return null;
    return range(code==="QA4452"?"FT_GOAL_RANGE":code==="QA4300"?"CORNER_FT_RANGE":"CORNER_FH_RANGE",
      code==="QA4452"?"FT_TOTAL":code==="QA4300"?"CORNER_FT_TOTAL":"CORNER_FH_TOTAL",lower,upper);
  }
  if(code==="QA62"||code==="QA5528"||code==="QA5165"){
    if(teams===undefined)return null;
    const outcomes:Readonly<Record<string,readonly [string,string,number]>>={Q9Q1:["HOME","HOME",1],Q10Q1:["HOME","AWAY",1],Q11Q1:["HOME","DRAW",1],
      Q12Q1:["AWAY","HOME",3],Q13Q1:["AWAY","AWAY",3],Q14Q1:["AWAY","DRAW",3],Q15Q1:["DRAW","HOME",2],Q16Q1:["DRAW","DRAW",2],Q17Q1:["DRAW","AWAY",2]};
    const pair=outcomes[suffix];
    if(pair===undefined||item.side!==pair[2])return null;
    // The participant itself can contain '/', e.g. Bodo/Glimt. Compose the
    // suffix-proven pair from native names and compare the complete label.
    const namesFor=(outcome:string):readonly string[]=>outcome==="DRAW"?["draw","tie","hoa"]:[teams[outcome==="HOME"?0:1]];
    const composedKey=(value:string):string=>value.replace(/[^/]+/gu,part=>nameKey(part));
    const actual=composedKey(item.name);
    if(!namesFor(pair[0]).some(first=>namesFor(pair[1]).some(second=>composedKey(`${first}/${second}`)===actual)))return null;
    return terms(code==="QA5528"?"CORNER_FT_HALF_FULL_RESULT":code==="QA5165"?"CARD_FT_HALF_FULL_RESULT":"FT_HALF_FULL_RESULT",`${pair[0]}_${pair[1]}`);
  }
  if(code==="QA89"||code==="QA4451"){
    const lookup:Readonly<Record<string,readonly [string,number]>>=code==="QA89"?{Q624Q0:["FIRST_HALF",0],Q625Q0:["SECOND_HALF",0],Q626Q0:["EQUAL",0]}
      :{Q0Q1:["FIRST_HALF",1],Q0Q11:["FIRST_HALF",1],Q0Q2:["SECOND_HALF",3],Q0Q12:["SECOND_HALF",3],Q0Q0:["EQUAL",2],Q0Q10:["EQUAL",2]};
    const found=lookup[suffix],subject=btiNamedSubject(label,teams);if(found===undefined||found[1]!==item.side)return null;
    const expected=found[0]==="FIRST_HALF"?/^(?:hiep 1|1st half|first half)$/u:found[0]==="SECOND_HALF"?/^(?:hiep 2|2nd half|second half)$/u:/^(?:hoa|draw|tie|equal|equals|cung khong|neither)$/u;
    if(!expected.test(name)||code==="QA4451"&&(subject===null||!(subject==="HOME"?/^Q0Q[012]$/u:/^Q0Q1[012]$/u).test(suffix)))return null;
    return terms(code==="QA89"?"FT_HIGHEST_SCORING_HALF":`${subject!}_FT_HIGHEST_SCORING_HALF`,found[0]);
  }
  if(code==="QA696"||code==="QA697"){
    if(teams===undefined)return null;
    const team=suffix==="Q0Q0"&&item.side===1?"HOME":suffix==="Q0Q1"&&item.side===3?"AWAY":null;
    if(team===null||namedResult(item.name,teams)!==team)return null;
    return terms(code==="QA696"?`${team}_FT_WIN_TO_NIL`:`${team}_FT_WIN_BOTH_HALVES`,"YES");
  }
  if(code==="QA277"||code==="QA4274"||code==="QA276"||code==="QA278"){
    const subject=btiNamedSubject(label,teams);if(subject===null)return null;
    const oddEven=code==="QA276"||code==="QA278";
    const yes=(oddEven?/^(?:odd|le)$/u:/^(?:yes|co)$/u).test(name),no=(oddEven?/^(?:even|chan)$/u:/^(?:no|khong)$/u).test(name);
    if(!yes&&!no||item.side!==(yes?1:3))return null;
    const expectedSuffix=code==="QA4274"?(subject==="HOME"?(yes?"Q0Q2":"Q0Q1"):(yes?"Q0Q20":"Q0Q10"))
      :subject==="HOME"?(yes?"Q0Q11":"Q0Q10"):(yes?"Q0Q21":"Q0Q20");
    if(suffix!==expectedSuffix)return null;
    if(code==="QA276"||code==="QA278")return terms(`${subject}_${code==="QA276"?"FH":"SH"}_ODD_EVEN`,yes?"ODD":"EVEN");
    return terms(`${code==="QA4274"?opponent(subject):subject}_SH_TOTAL`,(code==="QA4274"?!yes:yes)?"OVER":"UNDER","0.5");
  }
  if(code==="QA3583"){
    if(teams===undefined)return null;const m=/^Q0Q([1-6])$/u.exec(suffix);if(m===null)return null;
    const n=Number(m[1]),who=["HOME","DRAW","AWAY"][(n-1)%3]!;
    if(item.side!==(n-1)%3+1)return null;
    if(n===5)return /^(?:khong ban thang|no goals?)$/u.test(name)?terms("FH_TOTAL","UNDER","0.5"):null;
    if(who==="DRAW")return /^(?:hoa va ca hai doi deu ghi ban|draw and both to score)$/u.test(name)?terms("FH_RESULT_BTTS","DRAW_YES"):null;
    const team=nameKey(teams[who==="HOME"?0:1]);
    if(name!==`${team} ${n<=3?"and both to score":"win to nil"}`)return null;
    return terms("FH_RESULT_BTTS",`${who}_${n<=3?"YES":"NO"}`);
  }
  if(code==="ML159"||code==="ML160"){
    if(teams===undefined)return null;
    const who=suffix==="H"&&item.side===1?"HOME":suffix==="A"&&item.side===3?"AWAY":null;
    return who!==null&&namedResult(item.name,teams)===who?terms(code==="ML159"?"FH_DRAW_NO_BET":"SH_DRAW_NO_BET",who):null;
  }
  return null;
}
