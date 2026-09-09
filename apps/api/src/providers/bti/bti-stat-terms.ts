import type { MarketType } from "@tool-chenh/contracts";
import type { BtiNamedSelection } from "./bti-categorical-terms.js";
interface Terms {marketType:MarketType;selection:string;lineText:string|null}
const key=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/gu,"").replace(/đ/giu,"d").toLowerCase().replace(/[^a-z0-9]+/gu," ").trim();
const terms=(marketType:MarketType,selection:string,lineText:string|null=null):Terms=>({marketType,selection,lineText});
const subject=(name:string,teams?:readonly [string,string]):"HOME"|"AWAY"|null=>{
  if(!teams||key(name)==="")return null;const home=key(name)===key(teams[0]),away=key(name)===key(teams[1]);return home===away?null:home?"HOME":"AWAY";
};
const totals:Readonly<Record<string,MarketType>>={
  OU121:"SHOTS_ON_TARGET_FT_TOTAL",OU2083:"SHOTS_FT_TOTAL",OU22:"FOULS_FT_TOTAL",OU2086:"OFFSIDES_FT_TOTAL",
  OU5115:"THROW_INS_FT_TOTAL",OU5117:"THROW_INS_FH_TOTAL",OU5119:"GOAL_KICKS_FT_TOTAL",OU5518:"TACKLES_FT_TOTAL",
  OU4997:"WOODWORK_FT_TOTAL",OU5542:"SHOTS_ON_TARGET_FH_TOTAL",OU5110:"SHOTS_FH_TOTAL",OU5121:"GOAL_KICKS_FH_TOTAL",OU4330:"CORNER_WINDOW_0_599_TOTAL",
  OU1967:"HOME_CARD_FT_TOTAL",OU1968:"AWAY_CARD_FT_TOTAL",OU5539:"AWAY_CARD_SH_TOTAL",
  OU6031:"HOME_CARD_FH_TOTAL",OU6032:"AWAY_CARD_FH_TOTAL",OU6033:"HOME_CARD_SH_TOTAL",OU6034:"AWAY_CARD_SH_TOTAL",
  OU1969:"HOME_SHOTS_ON_TARGET_FT_TOTAL",OU1970:"AWAY_SHOTS_ON_TARGET_FT_TOTAL",
  OU2078:"HOME_SHOTS_FT_TOTAL",OU2079:"AWAY_SHOTS_FT_TOTAL",OU1971:"HOME_FOULS_FT_TOTAL",OU1972:"AWAY_FOULS_FT_TOTAL",
  OU1973:"HOME_OFFSIDES_FT_TOTAL",OU1974:"AWAY_OFFSIDES_FT_TOTAL",OU5116:"HOME_THROW_INS_FT_TOTAL",
  OU5120:"AWAY_GOAL_KICKS_FT_TOTAL",OU5519:"HOME_TACKLES_FT_TOTAL",OU5520:"AWAY_TACKLES_FT_TOTAL",
  OU5107:"AWAY_CORNER_SH_TOTAL"
};
const results:Readonly<Record<string,MarketType>>={ML619:"CORNER_FT_1X2",ML14:"CORNER_FH_1X2",ML1370:"CARD_FT_1X2",ML1372:"CARD_FH_1X2",ML5098:"SHOTS_FT_1X2",ML5511:"FT_HALF_OR_FULL_RESULT"};
const firstLast:Readonly<Record<string,readonly [MarketType,RegExp]>>={
  ML15:["CORNER_FT_FIRST_TEAM",/\b(?:qua phat goc dau tien|first corner)\b/u],
  ML16:["CORNER_FT_LAST_TEAM",/\b(?:qua phat goc cuoi cung|last corner)\b/u],
  ML12:["CARD_FT_FIRST_TEAM",/\b(?:doi nhan the phat dau tien|first team to receive a card)\b/u],
  ML5171:["CARD_FT_LAST_TEAM",/\b(?:the cuoi cung 3 cua|last card 3 way)\b/u],
  ML5168:["OFFSIDES_FT_FIRST_TEAM",/\b(?:viet vi dau tien|first offside)\b/u],
  ML5169:["SHOTS_ON_TARGET_FT_FIRST_TEAM",/\b(?:cu sut trung dich dau tien|first shot on target)\b/u],
  ML167:["FT_QUALIFY",/\b(?:qua vong loai|to qualify)\b/u],
  ML168:["FT_WIN_CUP",/\b(?:gianh cup|to win the cup)\b/u]
};
const captions:Readonly<Record<string,RegExp>>={
  OU121:/\bso cu sut trung muc tieu\b/u,OU2083:/\btong so lan sut trong tran dau\b/u,OU22:/\btong so loi tran dau\b/u,
  OU2086:/\bso lan viet vi toan tran\b/u,OU5115:/\btong nem bien tai xiu\b/u,OU5117:/\btong nem bien hiep 1 tai xiu\b/u,
  OU5119:/\btong phat bong tai xiu\b/u,OU5121:/\btong phat bong hiep 1 tai xiu\b/u,OU5518:/\btong tac bong\b/u,
  OU4997:/\bcot doc xa ngang tai xiu\b/u,OU5542:/\bsut trung dich hiep 1 tai xiu\b/u,OU5110:/\btong cu sut hiep 1 tai xiu\b/u,
  OU4330:/\bphat goc trong 10 phut dau\b/u,OU1967:/\btong so the cua doi\b/u,OU1968:/\btong so the cua doi\b/u,
  OU5539:/\btong the doi hiep 2 tai xiu\b/u,OU6031:/\btong the phat hiep 1 cua doi\b/u,OU6032:/\btong the phat hiep 1 cua doi\b/u,
  OU6033:/\btong the phat hiep 2 cua doi\b/u,OU6034:/\btong the phat hiep 2 cua doi\b/u,
  OU1969:/\btong so cu sut trung muc tieu cua doi\b/u,OU1970:/\btong so cu sut trung muc tieu cua doi\b/u,
  OU2078:/\btong so cu sut cua doi\b/u,OU2079:/\btong so cu sut cua doi\b/u,OU1971:/\btong so loi trong tran cua doi\b/u,
  OU1972:/\btong so loi trong tran cua doi\b/u,OU1973:/\btong so lan viet vi cua doi\b/u,OU1974:/\btong so lan viet vi cua doi\b/u,
  OU5116:/\btong nem bien doi tai xiu\b/u,OU5120:/\btong phat bong doi tai xiu\b/u,OU5519:/\btong tac bong doi\b/u,
  OU5520:/\btong tac bong doi\b/u,OU5107:/\btong phat goc doi hiep 2\b/u,
  ML619:/\bcuoc 1x2 so qua phat goc toan tran\b/u,ML14:/\bcuoc 1x2 so qua phat goc hiep 1\b/u,
  ML1370:/\bcuoc 1x2 so the toan tran\b/u,ML1372:/\bcuoc 1x2 so the hiep 1\b/u,ML5098:/\btong cu sut ca tran 1x2\b/u,
  ML5511:/\bket qua hiep 1 hoac ca tran\b/u,
  QA6113:/\bcac khoang tong ban thang\b/u,QA6136:/\bkhoang tong ban thang cua doi\b/u,QA6137:/\bkhoang tong ban thang cua doi\b/u,
  QA6035:/\bkhoang so the\b/u,QA5517:/\bkhoang so cu sut trung dich\b/u,
  QA6029:/\bkhoang tong the phat cua doi trong hiep 1\b/u,QA6030:/\bkhoang tong the phat cua doi trong hiep 1\b/u
};
function periodAgrees(type:MarketType,evidence:string):boolean{
  const first=/\b(?:hiep 1|first half|1st half)\b/u.test(evidence),second=/\b(?:hiep 2|second half|2nd half)\b/u.test(evidence);
  return /_FH_/u.test(type)?first&&!second:/_SH_/u.test(type)?second&&!first:!first&&!second;
}
const ranges:Readonly<Record<string,readonly [MarketType,MarketType]>>={
  QA6113:["FT_GOAL_RANGE","FT_TOTAL"],QA6136:["HOME_FT_GOAL_RANGE","HOME_FT_TOTAL"],QA6137:["AWAY_FT_GOAL_RANGE","AWAY_FT_TOTAL"],
  QA6035:["CARD_FT_RANGE","CARD_FT_TOTAL"],QA5517:["SHOTS_ON_TARGET_FT_RANGE","SHOTS_ON_TARGET_FT_TOTAL"],
  QA6029:["HOME_CARD_FH_RANGE","HOME_CARD_FH_TOTAL"],QA6030:["AWAY_CARD_FH_RANGE","AWAY_CARD_FH_TOTAL"]
};
const windows:Readonly<Record<string,readonly [number,number]>>={4318:[0,900],4319:[901,1800],4320:[1801,2700],4321:[2701,3600],4322:[3601,4500],4323:[4501,5400]};
export const btiStatCodes=new Set([...Object.keys(totals),...Object.keys(results),...Object.keys(ranges),...Object.keys(firstLast),
  ...Object.keys(windows).flatMap(n=>["OU"+n,"HC"+n,"ML"+n]),"HC157","HC270","HC271","HC359","HC2219","OU6309","OU621","OU6419","ML117","ML141","ML6064","ML5511","ML5153","ML15","ML16","ML12","ML5171","ML5168","ML5169","ML167","QA4405"]);
function ranged(type:MarketType,total:MarketType,lo:number,hi:number|null):Terms{
  return hi===null?terms(total,"OVER",String(lo-0.5)):lo===0?terms(total,"UNDER",String(hi+0.5)):terms(type,`RANGE_${lo}_${hi}`);
}
export function decodeBtiStatTerms(code:string,marketId:string,item:BtiNamedSelection,label:string,teams?:readonly [string,string]):Terms|null{
  if(!btiStatCodes.has(code)||marketId===""||!item.id.startsWith(marketId)||!Number.isFinite(item.line))return null;
  const suffix=item.id.slice(marketId.length),name=key(item.name),evidence=key(label),team=subject(item.name,teams);
  const labelSubject=label.includes(":")?subject(label.slice(0,label.indexOf(":")),teams):null;
  if(captions[code]&&!captions[code].test(evidence))return null;
  const result=results[code];
  if(result){const outcome=suffix==="H"&&item.side===1&&team==="HOME"?"HOME":suffix==="A"&&item.side===3&&team==="AWAY"?"AWAY":suffix==="D"&&item.side===2&&/^(?:hoa|draw)$/u.test(name)?"DRAW":null;
    return outcome&&(code==="ML5511"||periodAgrees(result,evidence))&&(item.lineWasMissing||item.line===0)?terms(result,outcome):null;}
  const named=firstLast[code];
  if(named){
    if(!named[1].test(evidence)||!periodAgrees(named[0],evidence)||!item.lineWasMissing&&item.line!==0)return null;
    if(suffix==="H"&&item.side===1&&team==="HOME")return terms(named[0],"HOME");
    if(suffix==="A"&&item.side===3&&team==="AWAY")return terms(named[0],"AWAY");
    // Only ML5171 explicitly offers no card in this capture. Do not infer the
    // refund rule of the two-selection first/last markets or invent NONE quotes.
    return code==="ML5171"&&suffix==="D"&&item.side===2&&/^(?:cung khong|neither|none)$/u.test(name)?terms(named[0],"NONE"):null;
  }
  let total=totals[code];
  // These native groups can be returned with either team subject; the label is authoritative.
  const dynamicSubject:Readonly<Record<string,string>>={OU5107:"CORNER_SH_TOTAL",OU5539:"CARD_SH_TOTAL",OU5116:"THROW_INS_FT_TOTAL",OU5120:"GOAL_KICKS_FT_TOTAL"};
  if(total&&dynamicSubject[code])total=labelSubject===null?undefined:`${labelSubject}_${dynamicSubject[code]}` as MarketType;
  const window=/^(OU|HC|ML)(43\d\d)$/u.exec(code),bounds=window?windows[window[2]!]:undefined;
  if(bounds){
    // Corroborate every time boundary; 15:00 and 15:01 are different contracts.
    const clocks=[...label.matchAll(/(\d{1,2}):([0-5]\d)/gu)].map(m=>Number(m[1])*60+Number(m[2]));
    const windowCaption=window![1]==="HC"?/\bcuoc chap chau a\b/u:window![1]==="ML"?/\bkeo 1x2 phut\b/u:/\bcuoc tai xiu\b/u;
    if(!windowCaption.test(evidence)||clocks.length<2||clocks[0]!==bounds[0]||clocks[1]!==bounds[1])return null;
    const type=`FT_WINDOW_${bounds[0]}_${bounds[1]}_${window![1]==="HC"?"AH":window![1]==="ML"?"RESULT":"TOTAL"}` as MarketType;
    if(window![1]==="OU")total=type;
    else if(window![1]==="ML")return !item.lineWasMissing&&item.line!==0?null:suffix==="H"&&team==="HOME"&&item.side===1?terms(type,"HOME"):suffix==="A"&&team==="AWAY"&&item.side===3?terms(type,"AWAY"):suffix==="D"&&item.side===2&&name==="hoa"?terms(type,"DRAW"):null;
    else return !item.lineWasMissing&&Number.isInteger(item.line*4)&&/^[HA](?:MM|[MP]\d+)$/u.test(suffix)&&team===(item.side===1?"HOME":item.side===3?"AWAY":null)&&suffix[0]===(team==="HOME"?"H":"A")
      ?terms(type,team!,String(team==="HOME"?item.line:-item.line)):null;
  }
  if(total){
    if(!periodAgrees(total,evidence))return null;
    if(total.startsWith("HOME_")&&labelSubject!=="HOME"||total.startsWith("AWAY_")&&labelSubject!=="AWAY")return null;
    if(code==="OU4330"&&!/00:00\s*-\s*09:59/u.test(label))return null;
    if(item.lineWasMissing||item.line<0||!Number.isInteger(item.line*4))return null;
    return /^O(?:MM|[MP]\d+)$/u.test(suffix)&&item.side===1&&/^(?:tai|over)$/u.test(name)?terms(total,"OVER",String(item.line))
      :/^U(?:MM|[MP]\d+)$/u.test(suffix)&&item.side===3&&/^(?:xiu|under)$/u.test(name)?terms(total,"UNDER",String(item.line)):null;
  }
  if(code==="HC157")return item.line===0&&!item.lineWasMissing&&/hoa duoc hoan tien|draw no bet/u.test(evidence)
    ?suffix==="HMM"&&team==="HOME"&&item.side===1?terms("FT_DRAW_NO_BET","HOME"):suffix==="AMM"&&team==="AWAY"&&item.side===3?terms("FT_DRAW_NO_BET","AWAY"):null:null;
  if(code==="HC2219")return !item.lineWasMissing&&Number.isInteger(item.line*2)&&!Number.isInteger(item.line)&&
    /duoc thanh toan dua tren ty so cuoi cung|settled on final score/u.test(evidence)&&/^[HA](?:MM|[MP]\d+)$/u.test(suffix)&&
    (item.side===1&&team==="HOME"&&suffix[0]==="H"||item.side===3&&team==="AWAY"&&suffix[0]==="A")
    ?terms("FT_FINAL_SCORE_AH",team!,String(team==="HOME"?item.line:-item.line)):null;
  if(code==="HC270"||code==="HC271"||code==="HC359"){
    if(item.lineWasMissing||!Number.isInteger(item.line)||!teams||!/^[HTA](?:MM|[MP]\d+)$/u.test(suffix))return null;
    const type=code==="HC270"?"FT_EUROPEAN_HANDICAP":code==="HC271"?"FH_EUROPEAN_HANDICAP":"CORNER_FT_EUROPEAN_HANDICAP";
    const caption=code==="HC270"?/\bcuoc chap 3 chieu\b/u:code==="HC271"?/\bcuoc chap 3 chieu hiep 1\b/u:/\bcuoc chap so qua phat goc 3 chieu\b/u;
    if(!caption.test(evidence)||(code==="HC271"?/\b(?:hiep 2|second half)\b/u.test(evidence):/\b(?:hiep [12]|first half|second half)\b/u.test(evidence)))return null;
    if(item.side===1&&suffix[0]==="H"&&team==="HOME")return terms(type,"HOME",String(item.line));
    if(item.side===3&&suffix[0]==="A"&&team==="AWAY")return terms(type,"AWAY",String(-item.line));
    return item.side===2&&suffix[0]==="T"&&name===`hoa ${key(teams[0])}`?terms(type,"DRAW",String(item.line)):null;
  }
  if(code==="OU6309"||code==="OU621"||code==="OU6419"){
    if(item.lineWasMissing||item.line<0||!Number.isInteger(item.line)||!/^[OEU](?:MM|[MP]\d+)$/u.test(suffix))return null;
    const caption=code==="OU6309"?/\btai xiu ca tran 3 cua\b/u:code==="OU621"?/\bcuoc tai xiu so qua phat goc 3 chieu\b/u:/\b1st half 3way corners o u\b/u;
    if(!caption.test(evidence)||code!=="OU6419"&&/\b(?:hiep [12]|first half|second half|1st half|2nd half)\b/u.test(evidence))return null;
    const totalType=code==="OU6309"?"FT_TOTAL":code==="OU621"?"CORNER_FT_TOTAL":"CORNER_FH_TOTAL";
    if(item.side===1&&suffix[0]==="O"&&/^(?:tai|over)$/u.test(name))return terms(totalType,"OVER",String(item.line+0.5));
    if(item.side===3&&suffix[0]==="U"&&/^(?:xiu|under)$/u.test(name)&&item.line>0)return terms(totalType,"UNDER",String(item.line-0.5));
    return item.side===2&&suffix[0]==="E"&&/^(?:chinh xac|exact)$/u.test(name)?ranged(code==="OU6309"?"FT_GOAL_RANGE":code==="OU621"?"CORNER_FT_RANGE":"CORNER_FH_RANGE",totalType,item.line,item.line):null;
  }
  const range=ranges[code];
  if(range){
    if(!periodAgrees(range[0],evidence)||item.side!==0||!item.lineWasMissing&&item.line!==0||range[0].startsWith("HOME_")&&labelSubject!=="HOME"||range[0].startsWith("AWAY_")&&labelSubject!=="AWAY")return null;
    const m=/^Q(\d+)Q(-?\d+)$/u.exec(suffix);if(!m)return null;const lo=Number(m[1]),hi=m[2]==="-1"?null:Number(m[2]);
    if(lo>99||hi!==null&&(hi<lo||hi>99)||hi===null&&lo===0)return null;
    const noGoal=lo===0&&hi===0&&["QA6113","QA6136","QA6137"].includes(code)&&/^(?:khong ghi ban|no goals?)$/u.test(name);
    const expected=hi===null?new RegExp(`^${lo}(?: or more| goals and more)$`):new RegExp(lo===hi?`^${lo}$`:`^${lo} ${hi}$`);
    const explicitPlus=hi===null&&new RegExp(`^\\s*${lo}\\s*\\+\\s*$`,"u").test(item.name);
    if(!noGoal&&!explicitPlus&&!expected.test(name))return null;
    return ranged(range[0],range[1],lo,hi);
  }
  if(code==="ML117"||code==="ML141"||code==="ML6064"){
    const end=code==="ML117"?4200:code==="ML141"?1800:3599;
    const caption=code==="ML117"?/\bcuoc 1x2 den phut thu 70\b/u:code==="ML141"?/\bcuoc 1x2 den phut thu 30\b/u:/\bket qua theo phut 00 00 59 59\b/u;
    if(!caption.test(evidence))return null;
    const outcome=suffix==="H"&&team==="HOME"&&item.side===1?"HOME":suffix==="A"&&team==="AWAY"&&item.side===3?"AWAY":suffix==="D"&&item.side===2&&name==="hoa"?"DRAW":null;
    return outcome&&(item.lineWasMissing||item.line===0)?terms("FT_RESULT_AT_SECONDS",outcome,String(end)):null;
  }
  if(code==="ML5153")return !/\bhiep co nhieu phat goc nhat\b/u.test(evidence)||!item.lineWasMissing&&item.line!==0?null:suffix==="H"&&item.side===1&&/^(?:hiep 1|1st half)$/u.test(name)?terms("CORNER_FT_HIGHEST_SCORING_HALF","FIRST_HALF")
    :suffix==="A"&&item.side===3&&/^(?:hiep 2|2nd half)$/u.test(name)?terms("CORNER_FT_HIGHEST_SCORING_HALF","SECOND_HALF")
    :suffix==="D"&&item.side===2&&name==="hoa"?terms("CORNER_FT_HIGHEST_SCORING_HALF","EQUAL"):null;
  if(code==="QA4405"){
    if(!/\b(?:cuoc chan le so the|cards odd even)\b/u.test(evidence)||!periodAgrees("CARD_FT_ODD_EVEN",evidence)||!item.lineWasMissing&&item.line!==0)return null;
    return suffix==="Q0Q1"&&item.side===1&&/^(?:le|odd)$/u.test(name)?terms("CARD_FT_ODD_EVEN","ODD")
      :suffix==="Q0Q2"&&item.side===3&&/^(?:chan|even)$/u.test(name)?terms("CARD_FT_ODD_EVEN","EVEN"):null;
  }
  return null;
}
