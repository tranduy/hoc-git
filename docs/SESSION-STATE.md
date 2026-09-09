# Trạng thái làm việc — 2026-09-10

## BTI remaining normalization — 2026-09-10 03:45 local

User requested immediate continuation of remaining BTI normalization. Implemented
player/statistic/sequence/window/combined contracts, strict native identities,
partial UNMAPPED visibility, player lifecycle/schema/receipt/stake guards and
proven prematch comparison equivalents. DNB remains separate. Native aliases
Or Blorian/Cengiz Under/Ünder/Over Mandanda preserved; ambiguous composite labels
remain source evidence, not guessed individual players.

NEW immutable baseline .run/bti-remaining-2026-09-10/ (do not mix with prior
bti-normalization capture): 1,600 events/140,100 native observations; before
97,657 canonical/320,229 quotes/17,305 UNMAPPED/25,138 EXCLUDED. Final after-r3:
291,411 canonical (+193,754);16,804 UNMAPPED rows and11,174 EXCLUDED handled.
501 whole rows remain (QA5193/5195/5202=136each,QA6020=93), plus61 partially
handled rows with92 available residual selections. These remain visible.
Native selection entries323,454 conserved exactly, diagnostics0; old canonical
markets/quotes unchanged. Additions144,182 player+49,572 nonplayer; only2,449
new source markets actually pair, no player pairs in fixed peers.

BTI native pairs32,133→37,487 (+5,354,lost0); all-book58,339→64,500 (+6,161,lost0).
BTI by peer AP15,038→17,929/SBO11,267→12,936/CMD5,582→6,330/SABA246→292.
AP normalization held fixed; APsnapshotSTALE andIMabsent. Reconstructed quotes
receipt/sequence0; this is structural matching, not fresh profit/execution.
Final bundle44467b5117b3667af186aded828fca37b3e51875ac4b1c3b04ed7f9611c4ac39.
See final-evidence-summary.json/.md, after-r3-ap-latest-result.json and partial
available report. Authenticated BTI rule descriptions for4ambiguouscodes and
HC157/ML159/ML160/HC270/HC2219 returned404; no guessed rules or reload.

Worker retains original catalogs/counts but skips construction of PLAYER rows
if fewer than2providers have that type; projection omits unmatched PLAYER
detail from repeated UI messages. Default direct detail unchanged. Matched
pair parity verified inr2; don't report duplicated JSON size as actual clone
transfer size. r3 only adds5surname offers and leaves pairs unchanged.

Single deployment03:44:35: instance04747496-3e44-480a-a578-33b979a8aec3,
APIsha256:f0b5d8d4d9afee6c941b7e39f7707909e85212a88e837c0a9e178f490c8455d4,
webindex-C4wz23d4.js/workercomparison.worker-9lUTM009.js. Lease released.
Local/public200 newasset. Runtime03:45:40 BTIFRESH1,537events/136,221markets/
281,501quotes/260unmapped. This is a changing live snapshot, not auditinput.
Report docs/bti-remaining-normalization-2026-09-10.md. No six-feed uptime claim.
In-app Browser setup errored sandbox-state-meta missing sandboxPolicy; bounded
standalone headless Chrome local verification used instead. Initial UIcheck
was duringloading; use settled verification for actual comparison evidence.
Normalization committed/pushed as3305379. Finalbackend833tests/web501tests.
UIsettled03:47:232,147BTImarkets/430unmapped,390MiBmainJSheap,noerror/crash,
176SABA/CMDpairs;BTIage31secondsandIM/AP/SBOunavailable/recovering. Not all-feed
success. This exposed duplicate display/fresh worker calculation when invalid
player subjects changed display catalog identity. Follow-up preserves those
currentunpairablePLAYERrecords without cachedfallback; existingmatcher still
rejectsbadidentities.79focusedtests/typecheckpassed. Web-onlypublication03:53:21
servesindex-CmMLGhBF.js locally/publicly; APIbuildunchanged, noAPIrestart, lease
released. See worker-publication.json and worker-performance evidence when present.

## BTI categorical normalization — 2026-09-10 02:50 local

Latest user asked to continue BTI normalization. Implemented strict BTI
code/ID/name/participant-based score, range, half/full, margin, score-set,
team-scoring/clean-sheet/odd-even, corner and period DNB contracts. Binary
equivalences only where predicates coincide. QA696/697 positive home/away
offers split into separate YES contracts; no invented NO. QA62 handles slash
names such as Bodo/Glimt. Derived family closure/removal/replacement fixed.

Same BTI115,578 native observations/1,632 events: canonical51,895 ->99,385;
original UNMAPPED38,421 ->17,901 (20,520 handled, plus2,433 oldEXCLUDED).
Added47,490 canonical =27,072 binary +20,418 categorical. All22,953 handled
source rows map every available selection.822,763 candidate native entries
preserved exactly, old111,046 quotes/51,895 markets unchanged. New replay
quotes have receipt/sequence0; evidence is not fresh eligible odds/profit.

Fixed peers with latest AP normalization held constant on both sides:
BTI30,844 ->33,358 opposing native pairs (+2,514), lost0; pairedBTIevents651
unchanged. Gains AP1,215/SBO1,228/CMD54/SABA17. IM unavailable. AP snapshot
STALE. Primary older-AP variant26,590 ->29,104, samegain. Only1,283 newBTI
source contracts find opponents. Categorical storage coverage is not pairing;
general categorical complements/orientation remain disabled in matcher.

Remaining17,901 original UNMAPPED rows across152types ALL contain OPENpriced
selections. Largest groups: first-scoring-half, first10minutes, comebackwin,
goal/corner races, playergoals/scorers. Do not dismiss these as closed noise.
Native source rows are reconstructed from retained fields, not full network
tuples. Final immutable audit after-r3, source SHA606e1011a6989b2b0b0a654d153a
378479a8bf3b8cae85b75fbf05754ac855d9. Local evidence/report paths below.

703 tests passed:351 API/contracts +352 web comparison. Contracts/API builds
and web typecheck/build passed. Root Vitest requires exclusions for .run and
.worktrees; web worker tests need web workspace jsdom config (ErrorEvent).

Final handoff02:50:01: instance6a8f62bf-e7fc-4dfe-8be7-51e72ea81a4e,
APIsha256:50cf4743eac50c88f04c97410c759264aae529f8f66d3174ceaf66f8dc4a1b41.
Webindex-a25HopCZ.js/workercomparison.worker-YlhPqpj8.js. Lease released;
local/public200 newasset. Two handoffs because late QA62 slashfix required
final API rebuild; no provider reload. FirstcheckBTIFRESH79,277canonical/
12,550unmapped; immediatefinalcheckrestoredSTALE97,661canonical/17,318unmapped.
Do not compare those changing runtime snapshots as fixed-input measurements.
Follow-up02:52:08 returned BTIFRESH1,596events/96,659canonical/316,891quotes/
17,095unmapped; local/public200 and final API identity match. Evidence is
deployment-verification-settled.json. No further provider reload/checkloop.

Report docs/bti-categorical-normalization-2026-09-10.md. Evidence
.run/bti-normalization-2026-09-10/{BTI-full.json,after-r3-result.json,
after-r3-ap-latest-result.json,final-evidence-summary.json,after-r3-source.json,
deployment-final.json,deployment-verification-final.json}. This task does not
fix the prior AP/IM producer outages or establish all-feed stability.

## AP categorical normalization — 2026-09-10 01:36 local

User requested commit/push then continued AP normalization, and asked why BTI
still had >30k unmapped. Existing work was committed/pushed as d5c7ab3 on
feat/realtime-hardening. BTI's prior capture: 52,493 canonical, 38,713 unmapped,
25,788 excluded; it was only partially normalized, not nearly 100% unmapped.

Implemented AP score/range/combined-result/highest-half/statistic-result/DNB
decoders and shared categorical contracts. Proven boundary ranges/nil-nil
scores/prematch DNB become actual binary equivalents with native IDs/odds.
AP HT/FT digits differ from result+BTTS digits; native renderer tables verified.
Live DNB stays separate from AH0. AOS9:9 remains unmapped with an explicit
OTHER_SCORE_DOMAIN_REQUIRED reason, never treated as literal nine-nine.

Same AP62,161 native input: 18,802 -> 60,953 canonical, 43,359 -> 1,208
unmapped. Added42,151 canonical =5,793 binary equivalents +36,358 categorical.
Actual production matcher: AP30,864 ->35,729 native cross-book pairs (+4,865),
paired APsource markets17,220 ->21,457, paired APevents539 ->542. Zero old
pairs lost. Snapshot STALE; additions use expired clock0/sequence0 because
inventory lacks receipt evidence. These are cached structural results, not
live prices/profit. IM absent. Source clocks/status/IDs of originals unchanged.

400 tests passed across9 relevant suites, contracts/adapters/API build and
web typecheck/build passed. ROOT Vitest needs --exclude '**/.worktrees/**'
or file patterns also run old worktrees. Single-worker tests avoid memory OOM.

Deployed once at01:36:01: instance edc6aeee-4f17-46b6-a690-f8893b52f9af,
API sha256:91175b12a02f0716e00749ca41dac37beb0d3bc3c55f16febc92348fde8bb23b.
Web index-BRllPTcL.js / comparison.worker-DcUfWoeL.js, CSS unchanged.
Deployment lease released. This normalization change does not fix the earlier
APSPORT_REQUEST_TEMPLATE_MISSING producer outage or assert feed stability.
New normalization requires native input; old persisted canonical catalogs
are not relabeled or granted fresh quotes by deployment.
Post-deployment GET: API health200 and local/public web200 with index-BRllPTcL.
AP catalog read returned503 CATALOG_TIMEOUT, so no runtime AP market count or
feed recovery is claimed from this deployment. No repeated reload was issued.

Evidence .run/ap-normalization-2026-09-10/: original53MB APfull inventory,
frozen before/after engines and source hashes, replay.mjs, before/after-result
and -pairs JSON, deployment.json, deployment-verification.json.
Report: docs/apsport-categorical-normalization-2026-09-10.md.

## Latest read-only matching audit — 2026-09-10 00:49–00:52 local

User asks matching progress and why AP shows many markets but no matches.
No source edits, deployment, provider reload or long observer in this turn.
Current API capture: AP STALE23.24min,653events/18802canonical markets,
43359unmapped native observations. BTI/CMD/SBO/SABA FRESH; IM503CATALOG_TIMEOUT.
One current-source offline replay proves retained AP matches539distinct native
events and17220APmarkets,30864cross-book native marketpairs. By partner:
BTI464events/10134pairs; CMD446/3988; SBO518/16435; SABA43/307.
109APevents have no admitted partner;5admitted events have no exact opposing
market. These counts are structural cached relationships, NOT fresh prices.
Current eligible APpairs/plans=0 because snapshotSTALE; representative actual
ranker perpartner confirms AP freshness rejection. Do not call109 namebugs.

Pipeline00:51:32: first failure HOP3_ENVELOPE. Tab attached but current epoch
has59TAB_STATE and0HTTP/WS/DOM payloads, catalogShape
APSPORT_REQUEST_TEMPLATE_MISSING; HARD_RECOVERY last failure
BROWSER_REFRESH_DISABLED. Newer quote receipt fixes did not prevent this later
producer outage. Actual request-template bootstrap failure origin not yet fixed.
Evidence .run/ap-matching-status-2026-09-10/{manifest.json,ap-pipeline.json,
matching-status.json,matching-status.md,replay.mjs}; five captured schema-valid
catalogs, IMfile absent. Reproducible current-source replay2.44s/611MiB RSS.

## Latest deployed checkpoint — AP receipts and selected-book matching, 23:54 local

Deployed 2026-09-09 23:54:00 local: managed instance
cf2387e4-6f46-487b-8d08-0a14d903a6dd; API build
sha256:3ebb7fb86e090bce686725bedc351adeda1e9bd626788b0c136594f9c43342c9.
Web index-Byg0S9nH.js, comparison.worker-BXwM_Bea.js, index-p5BiG1xv.css.
Local4311, existing public hostname live.babiesbo.uk. Extension unchanged.
Deployment lease RELEASED. No root test browser/observer remains running.

User's active complaint: deselecting SABA/SBO makes matching disappear;
APSPORT has no usable tickets; ROI renders scientific notation. Implemented
web selection projection/waiting tickets/ROI formatting below, plus actual AP
price evidence fixes: identical valid SWEEP/socket records renew only their
own quotes, at most one receipt-only catalog publication per second; guarded
intermediate worker output binds actual current identical native offer clocks;
AP expiry accounts for other events and uses the explicit paired catalog
observedAtMs/observedMonotonicMs anchor. Membership-only publications cannot
renew old surviving quotes. Parser, durable store, revision/cache and transport
preserve anchor. Legacy bodies fall back to global max quote receipt.

Validation: source-specific RED→GREEN regression sets, API/web typecheck,
emitted API build and Vite8.2.1 build, independent production-path reviews.
Final explicit-anchor web suite105 passed; AP receipt suite106 passed plus
5focused explicit-anchor/route tests; worker binding44 passed earlier. Suites
overlap, so do not present the sum as a unique test count. Reviewer parallel
rerun once failed before Vitest startup due system memory, owner single-worker
runs passed. Unused no-revision-store route fallback ETag omits anchor-only
changes at equal wall time; production revision-store path is tested correct.

Actual browser 23:54:22–23:54:31 loaded new bundle, zero page errors. After
SABA/SBO deselection with CMD/AP/BTI:6560 contract groups/5220 native market
pairs/10385 source markets. Then AP/BTI only:5980 groups/4735 pairs/9431 source
markets. Visible top20:18 priced tickets +2 waiting. Example Elche/Real Madrid
FH_AH0.75 odds1.82/2.06383 ROI-3.29%. No positive ROI in this captured AP sample.
IM and SBO were unavailable during immediate post-handoff browser capture;
this is NOT proof all6feeds/normalization are solved or long-run stability.

One API read at23:55:04 returned in981ms, explicit anchor present, AP FRESH
age3248ms;715events/16851markets/36024quotes. Corrected expiry calculation:
607eligible live quotes and35321eligible prematch quotes,96expired quotes.
Counts describe one observation, not sustained coverage/profitable tickets.

Evidence .run/cmd-sbo-live-fix-2026-09-09/:
ap-receipt-deployment.json, web-ap-receipt-deployment.json,
web-ap-receipt-browser.json/.png, ap-receipt-after.json,
worker-native-receipt-binding-proof.json, ap-cross-event-receipt-expiry-proof.json,
ap-reobservation-fix.md. Original #9deployment-result.json preserved.
Public /football-live GET verified HTTP200 and index-Byg0S9nH.js after deployment.

## Previous web checkpoint — 2026-09-09 23:19 local

Web-only publish: index-AAyQi0Uz.js and comparison.worker-BXwM_Bea.js,
local 4311/public live.babiesbo.uk. API PID23940/build f99f53affb7b stayed
unchanged; deployment lease released. Evidence:
.run/cmd-sbo-live-fix-2026-09-09/web-selection-deployment.json.

Deployed: selected providers projected before comparison counts/ranking;
proven opposing tickets survive expired prices as “ĐÃ GHÉP · CHỜ GIÁ”;
detail uses the same price freshness eligibility; small ROI/profit use compact
signed bounds such as >-0.01%, never scientific notation. No expiry extension.
Focused validation: 104 passed/4 skipped page/count cases; 84 rank/detail cases;
59 ROI-related cases, typecheck/build and independent review passed (overlap
between suites; do not add them into a unique total).

Real browser verification 23:23:35–23:24:01: new bundle loaded, no page errors,
ROI >-0.01% rendered. After deselecting SABA/SBO, CMD became unavailable during
the read, leaving AP/BTI: 994 contract groups, 879 unique native market pairs,
1708 source markets, 20 waiting cards and no fabricated ROI. Thus it proves
the empty-list display fix, NOT three-provider runtime stability or profit.
Artifact web-selection-browser.json/.png. Multiple complementary partitions
can share one native market pair; contract count may exceed native pair count.

AP price usability still under investigation. One direct API read at23:32:34
completed in1950ms: AP FRESH/catalog age6333ms, 35753 prematch quotes eligible
under current UI rule,2728 expired; all468 live quotes expired. Evidence
ap-receipt-before.json. Browser waiting state cannot be attributed solely to
provider outages. Agent matching_audit is testing exact repeat receipt loss
in tsport-ws-adapter (unchanged SWEEP/socket suppressed). Agent
final_status_review investigates old intermediate worker receipt clocks.
No API deployment for those follow-up changes yet. IM remains unresolved.

## Previous API checkpoint — feed recovery arbitration #9

Active user task: repeated IM/SBO/BTI/CMD feed outages while provider pages work.
Do not report all-six stability from initial FRESH or old normalization counts.
Latest managed deployment 2026-09-09 22:16:52 local: instance
a3483287-a710-4c94-b8ef-b9709cf2c2e2; API PID23940; build
sha256:f99f53affb7baad20b60984e51871810d4ad15e7048193376172efd9274d53e7.
Extension sha256:bf39c76fba4d0b51ad3c815b84e7d289367287f5578db6aa638524d2d448cde2,
new worker3fd0de69 (full epoch in captures). Web index-BOS06VZq.js; worker
comparison.worker-S9JXkttS.js. Local4311/publiclive.babiesbo.uk. Lease RELEASED.

Deployed fixes and focused independent reviews are documented in
docs/superpowers/reports/2026-09-09-feed-recovery-arbitration.md:
valid-delta controller recovery; AUTO web read errors no longer manual restore;
backend fresh-read mutation guards; exact-source faulted assembler resync;
first/final multipart document proof instead of one renderer trip perfragment;
CMD native collector lifetime follows physicaldocument rather thantransportepoch;
truthful bounded IM diagnostics; local IM timeout30s retry versus actualprovider
refusal separatebreaker. Receipt clocks, freshness, authblocks andRetry-After kept.

#7 healthy6min then failed late-body path. #8 10min120samples: SBO/BTI/AP/SABA120,
CMD119, IM97 healthy. Later IM29min stale with NETWORKtimeouts and15min gate,
assembler0blocked. Thus neither is all-six runtime success. #9 fixes that gate;
legacy persisteddeadline preserved because lastfailure cannot disprove prior429.
First #9IM read15:19:35UTC: noHTTP/baseline, gate until15:32:29.683UTC (22:32:29local).
Root feeds-local-timeout.jsonl1000s observer has finished; no root observer/browser
remains active. Latest postdeadline read proves #9 runtime acceptance FAIL forIM:
two new NETWORKtimeouts, failureCount8, retryabout30s, noHTTPbaseline. Fiveothers
LIVE/evidence1–4s. Localretry policy fixed but actualIMGetSEtimeout NOTresolved.
User repeatedly objects to wastedtokens/loops; no more speculative deployments.
Read-onlycomparison im-request-regression-readonly-review.json proves token,
signature, requestscope, headers/body unchanged versuscommittedca6a5e5. Missing
one failednativeGetSE resource/header timing +browsererror; APIcurrentlydrops
loadingFailedmetadata, in-appbrowserbootstrapunavailable(missing sandboxPolicy).
NoIMautonavigation/authgatebypass. Exact latestartifact deployment-result.

Evidence root .run/cmd-sbo-live-fix-2026-09-09/. #7 backupdeployment-seventh-result;
#8 backupdeployment-eighth-result. #9handoffnormal; #7firsthandoffreadinessfailed
andmanagedstartfallbackrecovered. No pendingdeploymentlease. Guarded dashboard
reload refused DASHBOARD_NOT_SELECTED; do not reload another selectedtab. Public
HTML/API/newJS verified200 but intermittentECONNRESETobserved; tunnelPID1716 has4
connections and pointsdirectlyto4311, no4312gateway. Publictunnelnotmutated.

Earlier normalization/ROI history below remains historical, not activefeedproof.


## Latest deployed checkpoint — 2026-09-09 19:13, 71% remains unverified

Latest user steering asks whether screenshot Nagano/Mito71.38% is okay. Answer:
NOT verified. CMD25426567 has(ET), SABA134101803 has(Hiệp Phụ), both wrongly
REGULATION. BOTH are ET: do not claim cross-period mismatch caused71%. Original
SABAdecimal6.88235/native-.17 at screenshottime unavailable; laterpricesmoved.
Currentnormalizationdefectproven, exacthistoricalprofitnotproven. No bets made.

Latest managed deployment19:09: instanceb14d767a-c6c5-4650-a156-1af9eda9c7c7,
API27008/buildf357129d385fecfd1f75a92b9938924c99d778a907506866aa1832f3d850c6ac.
Extensionc81f74729a2c8122efa554a86311f2f2ce7a1bd82468086fcb1b0dcaed013fa6;
observednewworker2838f499-1af0-4be8-8030-25c2a6627b3a. Webindex-DlhYFTHc.js,
comparison.worker-S9JXkttS.js,CSSindex-p5BiG1xv.css. Local4311/publiclive.babiesbo.uk.
Lease released; previousdeployment-result backedupdeployment-fifth-result.json.
GuardedChrome reload againrefusedDASHBOARD_NOT_SELECTED; do not touchotherselectedtab.

Deployed sincepreviouscheckpoint: CMDindependentfullreceiptbookkeeping(78tests,
12independentpeer), workerintermediateadmissionbounded1snapshot+strictnativeeconomics/
roster/phase/reset/staleguards, originalclocks, clear/skipprefightintermediate, stop
terminalworker(39focused,92pagesuite+4skip,typecheck+peer). Periodfix sharedCMD/SABA
DOM andCMDHTTP/More retains ET/PEN/UNKNOWN events+everyrawobservation, withholds
unsupportedregulationoffers with EVENT_PERIOD_SETTLEMENT_UNSUPPORTED(116tests).
Matcher blocksEnglish/localizedparentheticalmarkersconflictingwithscope(215tests).
Allbuilds/reviewscomplete. SeparateSABAWSmapperalreadyexcludesEnglishET/PEN but
localizednormalizationnotextendedthere; matcherdefensecoversmarkedbadREGULATION.

Actual19:10:45APIproofnagano-period-deployed.json: SABAET134101803(11excludednative)
PEN134101808(4), CMDET25426567(18) PEN25426568(63), allcorrectscopeand0regulation
market/quotes; recordsnotdropped. ET/PENcanonicalsettlementstillunsupported: don't
claimallmarketsnormalized. Samehistorical17:39sixinput66138pairs/148291routesunchanged
byperiodguard; noET/PENeventsatallinthatoldsnapshot, differentNaganoordinaryIDs.
Evidenceperiod-guard-same-input-replay/summary.md. No newfullnativeauditneeded.

Runtimeacceptance STILL FAILS forallsix. feeds-corrected180s12:09:45–12:12:40UTC:
CMD25/36healthy,lastminute8/12,endSOFT_RECOVERYwithrecentevidence;
IM0/36,HARD_RECOVERY. SBOrestorescurrentworkerfullandactualquotesattheendafter
slowworkerbootstrap. AP36/36;BTI18/36,last12/12;SABA35/36,changedDOM→WS→DOM.
Assemblerblocked0. Savedfeeds-corrected-summary.json. Do notloopmorepollingto
overwritethisFAILorclaimCMD/SBO/allfeedsfixedbecauseonemovingbaselinewasobserved.

Browsercorrected120s19:10:35–19:12:36:0errors/crash,40catalog200,correctbundle,
noNagano cardsinfive samples,1156MiBpeakprivate/330MiBheap/182MiBpostGC.15/16
positivecardsintwoearlysamples(mostlyregularKLeagueSABA/CMD)then0; theseare
observational/unverified, notconfirmedbets. Partialactivefeedsnotfullsixloadtest.
Browser+monitorfinishedandclosed; no rootbackgroundtestremaining.

Rootupdatedreport:docs/superpowers/reports/2026-09-09-cmd-sbo-and-matching-repair.md.
Proofsall.run/cmd-sbo-live-fix-2026-09-09/. TwofallbackBTIHC157rulesinvestigations
endedunresolved;publicprimaryBTIrulelink403,bti-dnb-public-rule-followup.json.
Do notclaimHC157mapped; don'trestartsameboundedassetsearch. No commit/reset/clean.

## Current checkpoint — CMD receipt bookkeeping + worker starvation, 2026-09-09 after 18:36

User asks efficient actual fixes, no passive counting or repeated full audits. Work remains active;
do not claim full normalization or six-feed stability. Latest managed deploy at18:31:01:
instance8c5b7116-a097-4948-b969-a5429f44ed13/API28992,
builda2f06a80f814bf766f69ba173e7724ec763742fef366faf5848e4719997c40b6,
extension0.2.115/build70cb2d8d056a4698302d72a4bfa72232d931e72c096bea2913e367dd986d6051,
worker09297721-52c4-48fc-915f-a40113f1ef37. Lease released. Web index-DEwlfqIO.js,
CSS index-p5BiG1xv.css; comparison.worker-C8UU7QjR.js. Local4311/publiclive.babiesbo.uk.

CMD API FULL-after-delta cursor fix deployed: FULL100→delta101→newboundFULL101 used
to reject cursor-same-not-renewed. One predicate corrected, no replay/identity/coverage
relaxation. Four RED→GREEN,54focused, typecheck/build+independentreview passed. More
quotes retain exact clocks. Evidence cmd-full-cursor-renewal-{proof,after-proof}.json.

Runtime still FAILED18:31–18:33: CMD became stale again, IM stale, BTI stale atlast
browser sample. SBO kept moving actualquotes and baselines. CMD automatically replaced
source and recovered18:35; recovery does not erase earlierFAIL. CMD_NATIVE heartbeat
shape is cached diagnostic, not direct request-count measurement; active1 repeated is
not proof of a stuck request. normalizers_audit now owns concrete extensionfollowup:
cmdFullBaselineAtMs only set for exact active10s recoverytoken. Genuine currentloader
FULL outside attempt window or completing after deadline forwards to API but fails
hasCompleteCmdBaselineSince; keepalive reloads unnecessarily. ActualObserver+Keepalive
reproducer proves both paths (cmd-baseline-health-correlation-proof.json). Separate
successful full receipt bookkeeping under currentowner/fullbody/forwarding gates is
being implemented; final_status_review handles its scoped peerreview. No blind reload.

matching_audit owns worker-client starvation fix+tests: completed result discarded if
any catalog update increments latestgeneration while it runs. Need exactinflight input
snapshot, bounded invalidation barriers despite coalescing, pending quote/event/market
semantics validation, no attaching oldquotes to newclocks. Root reviews this delta.
Live trace18:35–18:36 has1.5–3s runs, droppedintermediates and acceptedbatches; it does
NOT prove permanentstarvation in that capture. New deterministicRED undercontinuous
updates is being made. Do not deploy equality-removalwithoutthese safeguards.

Conditional ROI note is ALREADY deployed and verified in browser: commonfullrefund
gets explicit ROIwhen notrefunded + refundprofit0, worstcaseROI0 neutral unchanged;
truebreak-even has no note. Historical17:39audit actually3strictpositive+2conditional
positive(1.236188%,0.282180%)+1truebreak-even+15071negative, among15077rows. Base500k
is firstlegstake, not totalbankroll. Sameinput still64459→66138pairs(+1679,0lost),
144533→148291routes(+3758,0lost).266188native/101141canonical/99183UNMAPPED; reason
breakdown saved current-audit-20260909-1746/unmapped-breakdown.md. No fullrerun needed.

Root browser post-fix18:31:25–18:33:26: correctnewbundle,42GETcatalog200,0error/crash,
peakprivate2227MiB,peakJS829MiB,postGC173MiB.2positivecards initially,0later; exact
source gates fluctuate. Conditionalnotes0.26%,0.53%,0.28% seen. Shorttestnotlongterm
memoryguarantee. GuardeduserChrome reload refusedDASHBOARD_NOT_SELECTED; don't reload
another selectedsite. Dedicatedbrowsers/120sobserver/60strace allclosed/completed.

Next: finish2boundedfixes/tests/peerreview; stageweb+buildextension underdeployment
lease then one managedhandoff(APIreads extensionidentity atstartup). Preserve#5
deployment-result.json asdeployment-fifth-result.json before overwriting. Don't rerun
restore-sbo-once; existing request500timeout then independentlyobservedSBOrecovery.
Root report docs/superpowers/reports/2026-09-09-cmd-sbo-and-matching-repair.md already
updatedwith#5 andexplicitruntimeFAIL, awaitingfinalnewchanges. No commit/reset/clean.

## CMD/SBO và phép đo cùng input — 2026-09-09 17:52, CHƯA đạt runtime acceptance

User yêu cầu tập trung sửa hiệu quả, không chờ/lấy mẫu lặp lại. Tiếp tục công
việc độc lập trong khi có đúng một observer nền; không báo sáu feed ổn định.

Bản thứ hai đã tái phát sau hơn sáu phút: CMD stale từ10:34:15Z, SBO có khoảng
33–52giây. Bản thứ ba triển khai khoảng17:46, instance737b8246-f590-442c-a617-4537c775e073,
API35764/build e7c8ce40900e356a64c09b9bc85e4f91e62b66ee6587089089221c45cfff9261,
extension44fd72b1361f1ad71be39a4baa67bf3bccffdbbeb81e57410ee298a5623e3acc,
worker60bd35ff-9d3b-4a5c-81e8-bbbeecc4c873. Lease đã release, web bundle không đổi.
Lần này sửa document check không timeout giữ đầu hàng đợi multipart CMD/IM;
timeout theo budget2,5s có sẵn, dừng suffix nếu mất fragment, resync đúng nguồn
nếu đã gửi prefix. Ba regression RED→GREEN,18test/typecheck/peer review qua.
SBO giữ đường native đang thành công sau30s, tránh thử lại replay lỗi trước.

Observer nền feeds-repaired.jsonl, session17855, thời lượng480s từ10:46:15Z.
Ban đầu worker cũ FRESH; worker mới có nhiều nguồn stale nên chưa đạt. CMD tự
đổi tab2742→2746/epoch11 và có baseline mới10:50, BTI cũng trở lại. Không có
assembler blockedSourceEpochs. Nguồn lỗi Page.getFrameTree đầu tiên chưa rõ;
không khẳng định false argument của callWebService là HTTP đồng bộ: mã gốc
chứng minh chỉ là Content-Type, async mặc định true. Cache897nhóm~1,4Mchars,
không phải GB. Network.getResponseBody bị giữ cũng không khóa queue toànnguồn;
reproducer cho response tiếp theo và heartbeat vẫn đi qua. Không sửa bằng cách
xóa mù slot physical hoặc tăng freshness.

SBO đang có follow-up thực chất: NATIVE_COMPLETION tự tái dùng lỗi400 cũ để
tăng shared backoff dù native không có phản hồi400 mới. final_status_review
đang sửa + rà toàn bộ fail callsites; còn late HTTP failure của request đã
retire nhưng được xét trước ownership fence. Chờ regression/freeze rồi chỉ
deploy một lần gộp. normalizers_audit đang peer review SBO. matching_audit
điều tra một family CORNER_SH_TOTAL chưa có schema chung, chưa chỉnh contracts.

Saved six-provider audit17:39 có266.188native observations,101.141canonical
markets,219.806quotes. Dispositions101.833NORMALIZED/65.172EXCLUDED/99.183UNMAPPED;
IM692duplicate normalized observations giải thích chênh canonical. Trên cùng
input:64.459→66.138nativepairs(+1.679,0lost),144.533→148.291routes(+3.758,0lost).
Fresh metadata excludesCMD; durable AP20,819s già hơn quote gate15s nên real
ranker loại hếtAP tại thời điểm tính. Sau các gate:21.526pairs/48.032routes/
15.077rows. Vốn500k:3positive/3zero/15.071negative;5.588unavailable plans là
đơn vị phương án không cộng vào rows.0verified. Không gọi đây là live sixfresh.

Browser17:40–17:43:0error/crash,1873MiB peakprivate,736MiBpeakheap,350MiBpostGC.
Đã thấy3positivecards ở một số thời điểm; hụt cặp khi IM/BTI/SBO stale. Selector
không mất vĩnh viễn lựa chọn: tự checked lại khi ACTIVE, đã chứng minh qua DOM.
SABA chỉ~880marketDOM, fullroster chưa hoàn tất. Diagnostic terminalError mới
ở observer bị APIprefixregexlọc thànhnull; không khẳng định biết lỗi SABA.

Report: docs/superpowers/reports/2026-09-09-cmd-sbo-and-matching-repair.md.
Bằng chứng mới đều trong .run/cmd-sbo-live-fix-2026-09-09/, audit snapshot trong
current-audit-20260909-1746/ (tên directory là tag; thời gian thật trong manifest).

## CMD/SBO recovery and pair loss — 2026-09-09 17:28, runtime acceptance ongoing

Latest user reports dead CMD/SBO and misleading gold ROI 0.00%. First correction
deployed 17:06 (0.2.114) failed sustained acceptance: 180 samples/15min, mature
last5min CMD36/60 LIVE+FRESH, SBO50/60. Keep this failure evidence; do not claim
that HTTP200, initial baseline, or a two-minute pass proves feed stability.

Second correction deployed17:27:21: managed07f25b2e-7017-4ec3-b22d-1c850bdc737f,
API33532, build16c44d23a8aa8c5f385cab8880c71484735809e74fe01dc690137e44b4fdd508.
Extension0.2.115/build9a0460d29bcd3641a30abee544e1472841ef345f6fdb89ca1b3819bac7ba7c73,
new worker0b54517f-6d0d-4e11-948f-865b969655ce. Webindex-CyPUAsby.js,
comparison.worker-C8UU7QjR.js. Local exactdashboard reloaded; lease released.
Preview/APIheap2048 preserved. Root15min monitor: .run/cmd-sbo-live-fix-2026-09-09/feeds-final.jsonl.

Fixes: idle source retirement no longer revokes account on still-open shared
bridge; old identities and explicitly closed sockets still rejected. Candidate
HTTP-body assembly transfers exact pending fragments, reservation/expiry/fences
through promotion instead of disposing prefixes. Offline CMD fc1/fc6 interleaving
proved prior permanent blockedSourceEpochs lock; live interleaving itself was not
captured. HOP4 now exposes bounded assemblerstats for runtime confirmation.
SBO local generated-fetch/detail/More/Early failures use local retry while actual
HTTPrefusals retain shared backoff. Native main acquisition continues at8s; no
freshness thresholds changed. CMD last-terminal-phase telemetry retained;
SABA heartbeat now includes its collector terminal error when page error is null.

Zero worst-profit is neutral; small signed ROI/money values retain precision.
Bell explicitlyhistory, positive-profit gate plus existingROI>5% threshold.
Detail footer no longer colors negative/zero money green. Stake math unchanged.
Matcher quotes now indexed by event+market nativeIDs; supplementary directly
proved prematch relations recover third-provider grouping loss without assuming
transitive names. Reciprocal uniqueness, kickoff/discriminator/variant guards
preserved. Same3-provider canonical input:22,826→23,376nativepairs(+550,0lost),
51,475→52,715selectionroutes(+1,240,0lost); not six-provider/live-profit counts.

Focused finalchecks:174API tests;833SBO/observer tests;106SABA collector/observer
tests(overlap exists);506webtests,4existing skips;types/builds/diffchecks/peer
reviews passed. Audit files and before/after exact native diffs are in current
.run directory. Runtime sustained acceptance, fresh six-provider counts and
browser capacity check still pending. SABA full coverage is uncertain: prior
same-epoch796events/4,787markets collapsed to125/875 after socketfaults; collector
FINISHED with mainRosterComplete=false. Do not silently promote old hidden prices.

## Result/DC, partial offers và kiểm tra sáu nguồn — 2026-09-09 16:44

Đã triển khai FT/FH/SH 1X2 với Double Chance đối ứng, giữ các offer native hợp lệ
kể cả một cửa hoặc nhiều offer cùng sàn, giữ ID chân cược và tách settlement profile.
Thêm 20 nhóm tên giải có bằng chứng. BTI/CMD/AP/SBO/IM có mapping mới từ mã native;
SABA dùng nhãn DOM đã chứng minh. CMD hỗ trợ main và More FT/FH 1X2, More FT DC,
sửa ForMMR và delta 118 để giá mới không mở lại kèo bị ẩn. Extension giữ IM il.
SABA không cho candidate socket 20 trận ghi đè nguồn fresh 100 trận vì đổi provenance.

Frozen 15:30: 301.075 native observations; semantic reconstruction 94.860 → 120.890
canonical markets. Unknown historical status giữ SUSPENDED. Pairs 52.157 → 57.782,
routes 104.314 → 116.958, không mất pair/route. Năm nguồn stale; 4 positive historical
không phải live. Exact archive BTI 43.879 → 49.978 markets, giữ mọi native selection.
CMD cùng main + 897 More receipts: 4.582 → 7.447 markets; giữ 29.895 native observations.
Có 142 MR native IDs chuyển raw-only do chưa chứng minh format; không báo zero removed.

Frozen 16:41:04–08: 204.255 native, 79.540 canonical, 172.198 quotes; BTI/AP/IM/SABA
fresh, CMD/SBO stale. Cùng canonical input cho old/current matcher: 30.613 → 40.567
pairs (+9.954, 0 mất), 61.226 → 89.380 routes. Fresh4: 14.685 → 20.716 pairs, 0 mất.
Export common form đủ 79.540 dòng. 14.344 visible rows có 1 positive observed plan:
Torino/AS Roma FT total 2.75, AP UNDER 1.77 / IM OVER 2.31; worst profit 262.735 VND,
ROI 0.1486587% gồm quarter split, 0 preflight verified. Native dispositions:
80.232 NORMALIZED / 73.547 UNMAPPED / 50.476 EXCLUDED. Có 692 IM normalized observations
không phải canonical market hiện tại. Không dùng các đại lượng này thay thế nhau.

Cache bounded 30.000 entries: probe 22.740 rows warm 16.2s → 0.97–1.07s, thêm khoảng
12 MiB retained heap; cold khoảng 15s. API 623 tests / 20 files pass; web, contracts,
extension, typechecks/builds và review độc lập pass (chi tiết và overlap trong report).
Managed instance 2cec1795-afca-4fd2-8b80-e1f4e2f6fb90; API PID 9784, web PID 32440.
Build 36d84bf509a8c3c255d4c03d4869a697cbea8ca3b2f89779e70ba18cb0d903d1.
Extension disk 0.2.113, build 3e8f5fecd6dea67aad04f944096f870a3c94fc2d6ac0f516dad18c0065998b83.
New active worker 845e6681-43cd-437d-bdac-784aaea29122; API không expose manifest version.
Public https://live.babiesbo.uk/football-live trả HTTP 200, exact index-DLsV8k-u.js,
WS SNAPSHOT; startup/current build đồng nhất. API heap 2048, preview mode giữ nguyên;
đúng tab localhost đã reload; deployment lease đã trả.

Public browser 3 phút 09:37:31–09:40:32Z: không crash/page error/metadata error,
peak browser private 1.42 GiB, page heap 563.2 MiB, post-GC 269.4 MiB, 55 catalog transfers.
API không restart. Chưa phải nghiệm thu đủ 6 nguồn hoặc dài hạn: CMD thiếu baseline,
IM/SBO có freshness gaps; BTI đạt 47.014 markets rồi đổi source epoch :6 → :7 và rebuild.
Cache BTI vẫn giữ 1.667 events / 192.8 MB / 0 evictions; trigger đổi epoch chưa xác định.
Một CMD request-snapshot không navigation lúc 09:37:05Z timeout sau 90s, không lặp lại.
Closing 16:41:57: CMD/SBO stale; BTI 42.040 markets, IM/AP/SABA fresh. Chưa hoàn tất
exact-score/range/combined/time-segment contracts, CMD MR/main-DC format và SABA native
full coverage; không claim 100% mapping, tất cả arbitrage hay feed đã ổn định.

Report: [Result complements and partial offers](superpowers/reports/2026-09-09-result-complements-and-partial-offers.md).
Artifacts: .run/double-chance-normalization-2026-09-09/; common form và matcher audit trong deployed-matcher-audit/.

## Feed memory and opposing markets — 2026-09-09 15:17

Fixed bounded upstream extension queues, epoch cancellation, sequential large HTTP chunks,
SABA snapshot-write coalescing and bounded resync recovery. Web now uses per-event native
counts, unchanged market/quote record reuse, exact Asian integer/quarter settlement,
a bounded stake cache, early rejection of unavailable execution constraints and Decimal sort keys.

Same frozen 13:40 Fresh5 input: 54,714 canonical markets unchanged; unordered cross-book pairs
7,423 → 21,655 (14,232 added, zero lost). Positive worst-case plans remain zero on that snapshot.
Native normalization remains incomplete, including double chance versus complementary 1X2.
Do not equate normalized observations, canonical markets, matched pairs and live positive plans.

Chrome confirmed the existing Fieldline tab's 11.4 GB annotation. The initial 0.2.111 mature
public test exceeded 3 GiB at 90 seconds and had metadata timeouts; that check failed.
Follow-up unchanged-record reuse reduces serialized worker output by 41.5% on the same BTI
input with identical semantic hashes. The corrected actual-selected-merge six-book replay
retains 397 → 534 → 534 → 534 MiB; peak RSS is 1,192 MiB. The earlier 2 GiB OOM stress retained
both full display/fresh lists and is only an upper-bound test. Signal processing fell from
1.29–1.53 s to 0.17–0.24 s; global sorting from 0.24–0.34 s to 0.06–0.08 s, with the same top20.
Full-six worker computation plus cloning still takes 5.9–6.9 seconds in that replay.

Deployed extension 0.2.112, worker f1d51356-e9b6-4eee-b001-4c7fc1f4d543.
Extension build: 8625bbaf528b634eae03ed309d52d7cf7cf3f7f22c075ecf85e2ff90f16a64a7.
Managed instance bf6d81ea-0095-4235-99fa-8f1e68fbef00; API PID30580, web PID15792.
Unified build: 47bb96b6835547558f5a980ca0428b5d8a83006ec8d1a8b3004b801050d9fe30.
Public https://live.babiesbo.uk/football-live serves index-CbUUPwRB.js and worker B694T89k.
Local .env selects FIELDLINE_WEB_MODE=preview: web changes now require a build and reload.
The API heap remains 2048 MiB. The user's exact loopback dashboard was reloaded to apply it.
Validation: 254 web tests pass (4 existing skips), 65 bridge/queue tests and 26 launcher/handoff
tests pass. Typechecks, builds and independent reviews pass.

Final public observation 2026-09-09T08:13:02.976Z–2026-09-09T08:16:06.670Z: 7 samples, peak dedicated-browser private memory 1.94 GiB, peak page JS heap 530.6 MiB, post-GC page heap 351.5 MiB. Page crash: false; errors: []; visible metadata errors across samples: []. Completed catalog transfers: 93. Last visible summary: Kèo hai cửa đối ứng: 8.506 nhóm kèo · 18.011 cặp market giữa hai sàn · 21.617 market nguồn. Danh sách hiển thị tối đa 20 vé theo ROI. Positive estimated cards at the final sample: 1. These live catalogs were filling during the run; only the frozen replays provide controlled memory/matching comparisons. This three-minute check is not a long-duration memory guarantee.

Closing pipeline: CMD FRESH (4,213 markets); IM FRESH (12,439 markets); SABA FRESH (778 markets); SBOBET FRESH (7,806 markets); APSPORT FRESH (15,950 markets); BTI FRESH (45,067 markets). Runtime and current source build identities agree: true. Public web/health HTTP status 200/200; WebSocket SNAPSHOT.

One earlier targeted CMD restore returned BASELINE_TIMEOUT after 90 seconds. Continued
envelopes rule out a total forwarding stall; no exact source-recovery cause is claimed.
Stale or incomplete providers must remain visible in any closing coverage interpretation.
Deployment lease release is recorded in the report after the runtime checks.

Details: [Feed memory and opposing markets](superpowers/reports/2026-09-09-feed-memory-and-opposing-markets.md).
Artifacts: .run/extension-memory-audit-2026-09-09 and .run/memory-growth-2026-09-09.

## Chuẩn hóa native sáu sàn — 2026-09-09 14:00

Đã sửa đường normalizer BTI/CMD/AP/SBO/SABA/IM, shared contract FH team total/1X2, lưu native selection/format/row,
va chạm ID AP và matcher loại nhầm cả sàn khi Main/More cùng hợp đồng. Chọn nguyên market tương đương theo
độ mới cửa cũ nhất, không trộn chân giữa các offer. Cùng raw của từng sàn: 61.958→73.799 canonical record,
60.532→71.497 hợp đồng riêng biệt; production hai cửa không hoàn tiền 6.926→8.682 cặp, không mất quan hệ
theo hợp đồng. Ba cửa/line hoàn tiền chỉ audit, chưa vào ranking hai cửa; không suy ra ROI live từ replay.

Đã bắt và sửa cả extension IM compactMarket làm mất ot+s trước API. Cùng66.318 raw market, projection mới
thêm830 hợp đồng both-halves và sửa18.657 giá chung, không mất market. 399 tests extension/typecheck/E2E qua.
Extension0.2.110 đã reload bằng control plane, worker46607732-1154-47b7-ab3e-837df39bd42e. API live thực nhận
22.022 quoteHK/3.762DECIMAL; native54.346HK/167.750DECIMAL. Snapshot13:13 trước sửa phải giữ là trung gian.

Snapshot cuối về raw13:40: 182.216 native observation,63.769 canonical market,133.984quotes,12.447UNMAPPED;
SBO stale ở ảnh đó. Năm sàn Fresh54.714 canonical→25.476 hai cửa OPEN không hoàn tiền→8.518 source tham gia
7.423 cặp. 11.094 eligible đã ghép trận nhưng chưa có sàn kia cùng type/hiệp/line;5.113 chưa nhận ứng viên trận.
Duyệt hết14.846 hướng cược bằng phân số:0 dương,1 bằng0,14.845 âm. Một kết quảfloat2.22e-16 là sai số,
không được báo kèo dương thật. final-audit/common-markets-live.ndjson có63.769 dòng chuẩn chung và ID/giá gốc.

Sửa stale ngay khi nhận metadata, giữ observedAt floor chặn bodyFresh cũ; App buffer tối đa2entry/account
(latest+STALE có observedAt cao nhất), tránh React batching làm rơi cập nhật giữa sàn. 157 tests qua,
bốn skip cũ, typecheck/build/review qua. Nghiệm thu60s13:55: đủ6sànFresh,9.804cặp,1vé ROI ước tính0,58%
Hungary/Ukraine FT_TOTAL2.5 SBO+BTI. Không có chuyển Fresh→Stale tự nhiên trong cửa sổ cuối; các regression
App/page kiểm chứng race. Lượt lỗi trước được giữ riêng, không coi là nghiệm thu.

Dev https://live.babiesbo.uk/football-live HTTP200, WS SNAPSHOT. API PID16360, instance
b55ce3c2-06f9-42ce-ad31-8758cb04108f, startup build140a0f3e6d09862afa933c8aad224741d931dd6ba83b4d48d78213ceafe41f5e.
API thực heap2048; sửa launcher trước đó giới hạn1024 rồi âm thầm fallback512 khi cấu hình2048, sáu tests qua.
Web-only chỉnh timeout metadata nguồn2.5→10giây sau khi bắt request200 nhưng chậm3.6giây;36 tests/typecheck qua,
web artifactindex-CTYu2li3.js. Vite áp dụng, không restartAPI/extension thêm; startup buildAPI không bao gồm
chỉnh frontend deadline sau đó. Freshness/cancel/recovery giữ nguyên. Lượt cuối14:00,23/23 request metadata200,
tối đa5,1giây, không banner timeout. IM chuyểnSTALE và269ms sau không còn thẻIM: đã quan sát live guard hoạt động.
Lượt30giây kết thúc4.166cặp/0dương;IMstale vàBTI vẫn đang tải catalog ban đầu, không coi đó là nghiệm thu đủ6sàn.
Browser đã đóng, API giữPID16360; lease đã trả, coordinator deployment/edits/acceptances đều rỗng.

Chi tiết, giới hạn và artifact tái lập:
[Native normalization implementation](superpowers/reports/2026-09-09-native-market-normalization-implementation.md).

## Khôi phục tunnel và triển khai sửa ghép — 2026-09-09 12:17

Dev https://live.babiesbo.uk/football-live đã khôi phục, HTTP local/public 200 và WebSocket SNAPSHOT qua.
Tunnel vẫn chạy nhưng web/API mất listener; tái hiện khởi động API hết heap mặc định 512 MB rồi supervisor
dừng web. Khởi động managed stack với 1024 MB; lưu FIELDLINE_API_MAX_OLD_SPACE_MB=1024 trong .env bị Git
bỏ qua để giữ qua restart. API dist/extension giữ nguyên; API build sha256:30babf5345849f849079234a73eedf40c611f5b42f14b4a8673dd4d426379e96.

Web đã nhận 44 nhóm alias đội, hai nhóm giải, hợp ứng viên tên chính xác/gần giống và guard Young Violets.
Mẫu frozen sáu sàn: thêm 492 cặp, không mất cặp cũ. Mẫu mới bốn nguồn Fresh: 7.386→7.917, thêm 554,
23 cặp còn vướng nhiều nhóm ứng viên (không nới guard). Đã thêm bộ đếm nhóm/cặp/market nguồn riêng top 20,
chặn va chạm tên hiển thị bằng ID nhóm nguồn. Phạm vi UI vẫn hai cửa không hoàn tiền.

Đã sửa tải trùng giữa initial/revision bằng chia sẻ request theo account; dashboard chờ header 10 giây,
body tối đa 30 giây, giữ nguyên freshness/giá/dữ liệu đầy đủ. Bộ điều phối revision nhận tiến độ catalog
hợp lệ dù phiên bản mới tới trong khi tải; giữ chặn timestamp lùi, STALE, đổi baseline và external-held.
366 tests liên quan qua (bốn skip cũ); sau guard cuối, 33 tests coordinator/API chạy lại qua; web build/typecheck
qua, review độc lập qua. Web dist index-B_5oRnXp.js, worker comparison.worker-CjrsCJni.js; Vite phục vụ sửa mới.

Public 12:09 có 26.753 cặp/11.028 nhóm khi năm nguồn đã tải; mẫu cuối 12:17 có 16.453 cặp/10.229 nhóm,
23.216 market nguồn, top 20 có ROI ước tính +0,26%. SABA vẫn stale; IM có lúc Fresh, lúc báo chưa có nguồn
hợp lệ. Chưa nghiệm thu duy trì cả sáu nguồn, chưa chuẩn hóa toàn bộ native type. Trình duyệt kiểm thử hữu hạn
đã đóng, không thao tác tab nhà cái/đặt cược; lease phục hồi đã trả. Chi tiết và bằng chứng:
[Dev tunnel/matching deployment](superpowers/reports/2026-09-09-dev-tunnel-and-matching-deployment.md).

## SBO bị stale lâu / nối API — 2026-09-09 10:36

Đã triển khai extension 0.2.109. Bỏ API URL tự đoán và URL lỗi trong resource timing;
404 hết cooldown được thử lấy lại Live/Today native. Bộ chọn loại GS/virtual football.
Khi bridge nối lại, SBO đổi epoch và bootstrap lại; lấy request Main thật để cấp All Dates,
ưu tiên document hiện tại trước worker phụ. Giữ backoff lưu bền, không reload trang sàn.
Các bản trung gian vẫn thất bại sau API restart, đã giữ số liệu thất bại riêng.
Bản cuối đã qua lần dừng riêng API có kiểm soát: cùng worker extension, cùng tab SBO,
API PID 28012 → 7352; catalog Fresh lại ở mẫu sau 30.309 ms, 528 trận và giá thay đổi thật.
Sau đó 14 mẫu liên tiếp Fresh trong 138 giây; tuổi catalog tối đa 4.571 ms.
Catalog public cuối có 528 trận/7.734 kèo/15.468 giá. Observer hữu hạn đã kết thúc.
Dev public trả đúng build và catalog Fresh; lease đã trả. IM và CPU toàn máy chưa giải quyết.
Stack `sha256:30babf5345849f849079234a73eedf40c611f5b42f14b4a8673dd4d426379e96`,
instance `84e3a7c0-3956-405c-8950-ffb14dd5bd48`.
Chi tiết và giới hạn: [SBO recovery correction](superpowers/reports/2026-09-09-sbobet-stale-recovery-correction.md).

## IM timeout — 2026-09-09 09:34 (đã triển khai, chưa có feed mới)

IM có đăng nhập native; gate hardBlocked=false, lỗi lưu là REQUEST_TIMEOUT.
Resource timing có GetSE HTTP 200/640.902 bytes mất 7.971 ms, sát timeout cũ 8 giây.
Đã nâng timeout riêng roster-only lên 15 giây, giữ origin lock, khoảng cách request,
backoff và hard-stop. Tách log lock/cooldown/lỗi request; không xóa hoặc rút ngắn gate.
85 tests liên quan qua; extension typecheck/build, API build qua. Extension 0.2.103;
stack `sha256:6f391a21c306d36704b73372cc5377c4e024cc6e5638f5e5455f90c3dd25004b`,
instance `3526f706-bf09-4c32-8b66-285651e9a1d5`. Lease đã trả.
Chưa nhận catalog IM mới; không tuyên bố đã sửa xong/chứng minh account không bị chặn.
Thao tác chẩn đoán thanh địa chỉ đã điều hướng nhầm tab; đã Back về đúng IM,
kiểm tra source gắn lại và dừng phương pháp đó. Không chạy vòng reload/probe liên tục.
Chi tiết: [IM timeout diagnosis](superpowers/reports/2026-09-09-im-timeout-diagnosis.md).

## SABA nhận lại dữ liệu trang — 2026-09-09 09:11

Đã xác nhận nguồn SABA vẫn gửi snapshot, nhưng API chặn DOM để chờ socket trong khi
socket lỗi FIELD_INDEX_UNMAPPED và collector main chưa hoàn tất. Bản native-only
không phục hồi thực tế. Đã triển khai thêm fallback sau hai snapshot DOM ổn định,
đủ chunk, timezone tường minh và có event/market/quote; không giả collector complete.
Live sau deploy: SABA Fresh, 107 trận/645 kèo/1.290 giá, có thay đổi giá thật.
197 tests SABA và API/web build qua. Stack
`sha256:1f8b75948396291eb8cc8f2ceed4e54ca5c92860ba55b8e811e53e5eb6ea2349`;
instance `f297338f-4157-4a20-8f7a-40fcd1085939`, extension giữ 0.2.101, lease đã trả.
Đã reload dashboard localhost, không yêu cầu người dùng clear cache/reload sàn.
Chưa chứng minh phủ đủ mọi kèo SABA; IM, decoder native và CPU vẫn còn việc.
Chi tiết: [SABA admission correction](superpowers/reports/2026-09-09-saba-native-feed-unblock.md).

## Sửa thiếu dữ liệu và lọt cặp — 2026-09-09 05:22 (đã triển khai, còn lỗi chạy thật)

Bản nghiệm thu liveness trước chưa chứng minh đủ độ phủ: ảnh người dùng có SABA 22 trận,
SBO 19 trận nhưng Fresh. Đã sửa production SBO đợi All Dates; SABA đợi roster Today/Early
được xác nhận, giữ inventory và clock cũ khi socket/DOM cập nhật. Cùng epoch, socket nối lại được
dùng collector đầy đủ còn hạn để phục hồi, không mắc kẹt chờ collector đã kết thúc chạy lại.

Đã tìm thấy sai giờ thật: đồng hồ công khai SABA `#systemTime.c-header__time` là GMT+7,
nhưng DOM normalizer dùng +8. Thêm metadata offset xuyên capture/schema/normalizer;
không đoán khi thiếu/xung đột, giữ catalog cũ. Bổ sung alias chính xác tên đội/giải và giữ
các kiểm tra loại trận/hiệp/line/settlement. Chính sách bỏ line nguyên/quarter có hoàn tiền
từ spec 06-09 chưa bị thay đổi. IM vẫn chưa có source được nhận diện, không probe mới.

CPU web: index movement theo trận/row, gộp cập nhật đồng hồ ranking, bỏ lượt preflight rỗng
và cập nhật map giống nhau. Benchmark cùng đầu vào 13.000 row: 1.882 → 1.198 ms/lượt ấm,
kết quả vé giống hệt. Chưa chứng minh hết spike CPU cả máy. SABA xử lý tối đa 512 owner
đã có dữ liệu và không cần mở kèo trong RAM/lượt; giữ hạn mức thao tác mở kèo Today 1/Early 4.
Regression 650 owner: 2 lượt, 4 lần đọc roster, 0 mở rộng, clock và terminal không đổi.

Rà snapshot cuối tìm thêm AP Puebla/Toluca: event rỗng 5324882 chặn event có giá 5705441.
Chỉ bỏ khỏi ứng viên ghép những event không có cả market lẫn quote; giữ chặn trùng khi có
dữ liệu giá/thị trường. Cùng đầu vào: 8.006 → 8.049 rows; 13.998 → 14.115 cặp market có giá,
thêm 117, không mất cặp cũ. Puebla hồi phục 19 hợp đồng AP/SBO. Root chạy lại 144 tests ghép.

Bản 0.2.100 SABA lỗi MORE_OPEN_NOT_STABLE làm mất cả kèo chính. Đã tách MAIN_ROSTER_TERMINAL
độc lập với hidden completion: xác nhận/reconcile Today+Early và restore Today trước More;
generation :main riêng, timezone số tường minh, không giả OWNER_COMPLETE. Main gửi thất bại
thì chặn More đến khi mọi chunk thực sự forward. Offline extension → API production qua,
giữ đúng GMT+7 và clock gốc. API 254 SABA tests, extension 164 tests; root rerun 111 API,
106 extension, typecheck/build các phần bị đổi đều qua.

Đã triển khai extension 0.2.101, artifact
`sha256:a97913a7a57368e9ed1488bc91ef09597695c7d2027eb2ef09372587574b5f66`;
stack `sha256:8e0015262800b8da47a0096c2aed8e15e76a68aff00b0c9847d5ba489d35dcba`,
instance `91571575-206a-4e2e-91c3-58f88a27a4dd`. Lease đã trả. Chỉ reload tay dashboard localhost.

Chưa nghiệm thu SABA chạy thật: sweep main cuối FINISHED nhưng mainRosterComplete=false,
hiddenMarketsComplete=false, activeGeneration=null; lastErrorCode=null không giải thích
được lỗi validation main. Native vẫn field-index-unmapped. Cache 24 trận stale bị loại khỏi
ghép; IM cũng chưa hoạt động. Chưa xác minh lại UTC bằng catalog SABA mới. Không dùng số liệu
652 trận của bản trung gian làm nghiệm thu. Bốn feed cuối: CMD695/SBO454/AP552/BTI1357 fresh;
ảnh UI thật SBO454/10.099markets, top ROI khoảng−0,56%, BTI có lúc Lagging.
CPU mẫu cuối30s: tổng45,82%, Chrome32,56%, API10,06% — chưa hết giật cả máy.
Các observer/debug hữu hạn đã kết thúc; app vẫn duy trì theo budget cũ, không reset budget/
reload cứng sàn. Công việc còn dang dở ở SABA live, IM và CPU; phần sửa ghép đã triển khai.
Chi tiết: [Coverage correction](superpowers/reports/2026-09-09-coverage-matching-correction.md).
Artifacts `.run/coverage-matching-2026-09-09/`; không commit/reset các sửa đổi có sẵn.

## IM guard, chuẩn hóa 6 sàn, top 20 và CPU — 2026-09-09 03:38

Đã triển khai stack `sha256:04498b27b472125873ac566e3d6d810b4bd03f9140c27d723e10ab5262e28c69`,
instance `101d5de0-1030-439b-bbd8-4f50fbf14913`; extension artifact 0.2.97.
Lease triển khai đã trả. IM chỉ dùng GetSE theo gate chung origin: chờ đầu 30s,
mỗi vòng cách ít nhất 20s, không tự quét GetEBI. Lỗi 501/401/403 dừng bền vững;
lỗi khác nghỉ 30s, ba lần lỗi nghỉ 15 phút. Đã bỏ bootstrap dồn và chặn tự mở/
điều hướng/restore IM. Không thấy source/tab IM được nhận diện trong lượt quan
sát 2 phút, nên chưa nghiệm thu IM chạy thật; không gửi probe nhà cái mới.

Chuẩn hóa thêm alias giải góc/thẻ, giữ settlement chưa xác minh khi đảo đội,
chặn split line sai và thêm ba alias chính xác Colombia B/MLS Next Pro/UAE.
UI hiện top 20; đã sửa một sàn stale làm mất cặp giữa hai sàn fresh. Ảnh màn hình
thật cho thấy Hungary–Ukraine FT total 2.5 BTI/SBOBET khoảng +0,58% lý thuyết.
Tên accessibility của Chrome bị cũ (đếm 0), không phản ánh DOM đang render;
parser web thật đã nhận tốt SABA/APSPORT/BTI, không có lỗi schema tái hiện.

Worker gộp delta theo account thay vì RESET toàn bộ catalog khi bận. Giữ đúng
xóa/thêm lại, freshness và reset lựa chọn. Kiểm thử, typecheck/build và review qua.
CPU mẫu 30 giây sau triển khai: tổng 32,13%, Chrome 22,8%, API 7,42%; chưa chứng
minh hết spike 100%, renderer Fieldline vẫn vài GB. Năm feed còn lại LIVE/FRESH
sau phục hồi khởi động trong lượt quan sát. Không reload tay tab nhà cái.
Chi tiết: `docs/superpowers/reports/2026-09-09-im-normalization-top20.md`;
artifacts `.run/im-safe-2026-09-09/`. Không commit/reset các thay đổi có sẵn.

## CPU cao — đã sửa API, bản sao worker và giữ catalog cũ trong lịch sử (2026-09-09 03:07)

Đo API thực tế: tính revision chiếm khoảng 3 giây trong profile 10,4 giây; BTI có
khoảng 77 MB record được duyệt lại. Bản ghi BTI/native dùng lại khoảng 98% tham chiếu.
Đã thêm cache digest bằng WeakMap theo hợp đồng dữ liệu readonly, giữ nguyên nội dung,
thứ tự, freshness và receipt/sequence của AP. Revision v2 đổi ETag một lần khi triển khai.
Benchmark cùng catalog với 1% record thay mới: BTI từ 250–274 ms xuống 46–60 ms/lượt ấm;
lượt đầu chậm hơn và thêm khoảng 20 MiB heap. Cache không giữ lại record đã bị loại.

Web trước đây sao chép cả native observations vào worker dù worker không đọc trường này.
Đã bỏ trường đó tại ranh giới postMessage; catalog đầy đủ vẫn ở UI và hydrate màn chi tiết.
Đo structuredClone cùng BTI: 77,25 MB / 656–842 ms xuống 35,06 MB / 245–282 ms.
Đây là benchmark thao tác sao chép bằng Node, chưa phải profile renderer Chrome.

Chrome báo Fieldline dùng 3,4 GB; tìm thêm lịch sử PriceMovementTracker giữ nguyên
ComparisonEvent và toàn bộ catalog cũ trong 60 giây dù ranking chỉ cần event.key.
Đã lưu riêng mã trận cùng giá/magnitude/thời điểm như trước. Mô phỏng 20 generation:
20 movement vẫn còn, nhưng số catalog cũ bị giữ giảm từ 20 xuống 0. Đã reload riêng
dashboard bằng nút Chrome sau khi xác nhận địa chỉ đúng để thay instance cũ qua HMR.

159 test API, 109 test web liên quan qua, 4 test web bỏ qua từ trước; typecheck/build API/web
và ba review độc lập qua. Test cooldown/remount được sửa assertion nhãn bị phụ thuộc thời
điểm discovery; vẫn kiểm tra nút disabled, deadline được lưu và không gửi thêm recovery.
Không sửa recovery production. Extension giữ 0.2.96; các source giữ nguyên epoch, IM không bật.
Build cuối `sha256:da6a0ed3e8b8f9a8ccdd1afdfa8ab5e159f98574b59a3912da917c5ab217ad1b`,
instance `4d4f619d-2c7f-4666-91aa-cd5411f75899`, triển khai 03:06:38 UTC+7.
Lease triển khai đã trả, inspector tạm đã đóng. Quan sát hữu hạn tại
`.run/cpu-root-cause-2026-09-09/live-after.json`; không dùng 10 phút đầu sau restart để
nghiệm thu ổn định sàn. Không kết luận hết giật cả máy từ benchmark riêng API/worker.
Chi tiết: [CPU runtime](superpowers/reports/2026-09-09-cpu-catalog-runtime.md).

Quan sát cuối đã kết thúc: 12 mẫu, cả 5 sàn LIVE/FRESH ở mẫu cuối và tiếp tục phát
revision; websocket không lỗi/đứt. CPU mẫu 30 giây TB 34,04% cả máy, Chrome 22,56%,
API 8,13%; chưa chứng minh CPU cả máy giảm vì tải Chrome và roster thay đổi.
Các benchmark cùng đầu vào và test giữ tham chiếu xác nhận ba phần sửa cụ thể.
Bộ so sánh hiện vẫn mất 845–1.260 ms/lượt dựng đầy đủ trên 5 catalog; không nới
freshness hoặc giảm nhịp để hạ CPU. Bộ đo hữu hạn đã thoát; tổng hợp ở `acceptance.json`.

## SABA duy trì — đã triển khai và kiểm tra ngắn 0.2.96 (2026-09-09 02:40)

Khôi phục socket SABA dùng chung ngân sách tối đa 3 lượt, cách ít nhất 30 giây,
rồi nghỉ 5 phút; lưu deadline vào local storage trước khi chạy để giữ qua worker restart.
Mỗi lượt tối đa 3 truy vấn heap, tiếp tục các context còn lại ở lượt sau. Truy vấn chưa
trả về vẫn giữ slot sau timeout/đổi source; kết quả muộn chỉ dọn object group.
Baseline socket còn mới ngăn khôi phục thừa; bootstrap được gộp và dừng khi đổi generation.
DOM vừa cấp catalog trong 30 giây thì hoãn quét heap trang/iframe, vẫn cho phép worker;
kiểm tra lại trước khi ngắt socket nếu data mới tới trong lúc truy vấn đang chạy.
Lượt bị hoãn không tiêu ngân sách truy vấn nặng. Quan sát 0.2.95 có khoảng trống data
91 giây trùng thời điểm page heap query timeout; đã lưu riêng dưới `startup-0.2.95/`.
Không thêm reload cứng mới, không bật IM, không nới ngưỡng freshness.

343 bài SABA/recovery/page-lease, 81 bài SABA observer, 83 bài KSPORT observer và
218 bài API SABA đã qua; typecheck, build toàn workspace và review cuối đã qua.
Managed build mới cũng chứa các sửa CPU web bên dưới trong dist production.
Đo hữu hạn đã kết thúc tại `.run/saba-maintenance/acceptance.json`: sau khi loại 10 phút
khởi động, 8/8 mẫu LIVE/FRESH, tuổi data tối đa 7,219 giây, cùng epoch và không recovery
của feed. Recovery socket đã tới 3 lượt worker rồi nghỉ; trang/iframe được hoãn vì DOM mới.
Hai lần so sánh sau mốc ghi nhận 548 giá đổi và 1.048 clock tăng đúng. Startup có một đợt
stream gap tự phục hồi trên cùng source; không coi toàn cửa sổ là không gián đoạn.
Build khớp, IM có 0 source, bộ đo hữu hạn đã thoát. Chưa nghiệm thu 24 giờ.
CPU mẫu 28 giây: cả máy TB 33,3%, đỉnh 62%; Chrome TB 10,5%, API TB 9,6%.
Chưa kết luận hết giật lag cả máy. Chi tiết: [SABA maintenance](superpowers/reports/2026-09-09-saba-maintenance.md).

## Giật Chrome/cả máy — giảm xử lý thừa ở web (2026-09-09 01:56)

Người dùng báo CPU nhảy 50–80%, giật cả Chrome hoặc cả máy; tạm ưu tiên việc này trước
SABA. Đã đo được `saveCatalogCache` tạo chuỗi BTI khoảng 81 MB / 514 ms rồi mới chạm
giới hạn localStorage. Web đã đếm kích thước danh mục trước khi serialize, bỏ qua cache
tùy chọn khi quá 5.000 record và giới hạn chuỗi cache nhỏ ở 1.000.000 code unit.

Web dùng revision API đã cấp, lưu theo snapshot trong WeakMap, thay việc dựng lại chuỗi
so sánh toàn danh mục (mẫu BTI ~127 ms/lần). Vẫn so observedAt/state; khi cùng thời điểm và
revision thì kiểm tra clock quote/native observation, tránh bỏ mất receipt mới hoặc nhận
quote cũ từ response chồng nhau. Không giảm data hoặc nới ngưỡng freshness.

Mã mới đã được Vite phục vụ qua HMR; build kiểm tra riêng ở `.run/cpu-lag-2026-09-09/web-build/`,
không restart API/extension/tab nhà cái. Managed build identity của đợt SBO 0.2.94 giữ nguyên;
dist production chưa được thay bằng build kiểm tra. Xem số đo, kiểm thử và giới hạn kết luận:
[CPU/web performance](superpowers/reports/2026-09-09-cpu-web-performance.md).

## SBOBET duy trì — đã triển khai 0.2.94 (2026-09-09 01:24)

Đã thêm backoff chung cho Main/More/Early và detail đã được chứng minh: 30 giây tăng dần
đến 5 phút, tôn trọng Retry-After dài hơn; 401/403 nghỉ 15 phút. Lưu deadline bằng
`chrome.storage.local` qua worker/source/reload. Main kiểm tra pause giữa Live và Today,
hủy mỗi fetch treo sau 12 giây. Timeout More/Early không giải phóng slot vật lý trước khi
CDP kết thúc. Recovery kiểm tra lại pause ngay trước điều hướng, kể cả sau bootstrap.

Mẫu Main trả 400 được lấy lại từ trang sau cooldown bằng một lần khôi phục có giới hạn;
native 403/429 vẫn giữ đúng thời gian nghỉ, còn đổi source giữa chừng không tạo lỗi giả.

400 không kèm Retry-After cho thử tối đa 3 context đã gắn, giãn 500 ms, rồi mới nghỉ;
403/429 và lỗi máy chủ vẫn nghỉ ngay. Request native trả muộn vẫn giữ đúng cooldown.

Native recovery chờ xử lý xong cả hai partition, không dùng ordinal vừa cấp làm tín hiệu hoàn tất.
Main được xác nhận riêng bằng cặp đã forward, đúng document/epoch/cutoff và schema; không phụ thuộc
điều kiện kickoff của Detail. Vẫn giữ nguyên kiểm tra và chứng minh completeness của Detail.

549 kiểm tra extension liên quan, 83 ca KSPORT observer và 83 ca API data-plane đã qua;
typecheck/build và review cuối đã qua. Theo dõi đọc loopback 12 phút ở `.run/sbo-maintenance/`,
tự tạo `acceptance.json` sau khi hoàn tất; loại 10 phút đầu khỏi kết luận ổn định.
Checkpoint 01:36 sau mốc 10 phút: 4/4 mẫu LIVE/FRESH, cùng epoch, không recovery, tuổi data
tối đa 4,813 giây; 521 trận / 13.248 kèo / 26.496 quote. Một lần so sánh lấy sau mốc ghi nhận
599 giá đổi, 10.344 clock/sequence tăng đúng, không có giá đổi mà clock không tăng.
Consumer không ngắt kết nối; build khớp. Kết quả ngắn lưu tại `.run/sbo-maintenance/checkpoint.json`.
Người dùng không yêu cầu chờ 24 giờ; chưa có bảo đảm liên tục 24 giờ.
IM vẫn tạm dừng; phần reload cứng mới vẫn để sau. Chi tiết:
[SBO maintenance](superpowers/reports/2026-09-09-sbobet-maintenance.md).

## CMD duy trì liên tục — đã triển khai 0.2.89 (2026-09-08 23:49)

Người dùng chuyển sang CMD; phần reload cứng mới để sau, IM vẫn tạm dừng.
CMD đã thêm giữ trang khi baseline còn mới, chờ quan sát 90 giây sau worker restart,
backoff chung cho lỗi request (30 giây → 5 phút, tôn trọng Retry-After; 401/403 nghỉ 15 phút),
và giãn More 500 ms sau callback với tối đa 2 request đang chạy. Recovery kiểm tra cooldown
trong đúng frame trước khi điều hướng, giữ nguyên kiểm tra quyền sở hữu tab.
105 kiểm tra CMD liên quan, typecheck/build và review đã qua. Sau mốc 10 phút khởi động,
3/3 mẫu CMD LIVE/FRESH, tuổi catalog tối đa 1,222 giây, cùng epoch, không recovery;
138 quote More tăng clock/sequence ở lần so sánh sau mốc này. Soak thật đang chạy trong
`.run/cmd-maintenance/`; chưa có nghiệm thu 24 giờ. Chi tiết: [CMD maintenance](superpowers/reports/2026-09-08-cmd-maintenance.md).

## BTI duy trì liên tục; tạm dừng IM theo người vận hành (2026-09-08 tối)

**Đợt này đã làm BTI. IM đã bị loại khỏi scope production của extension; không bật lại,
không thử refresh/login IM khi chưa có chỉ đạo mới.** Collector IM cũ được nghỉ và hủy request
do extension sở hữu khi nâng cấp. Không kết luận nguyên nhân account bị chặn từ báo cáo của người dùng.

Extension **0.2.88** bỏ việc thay trang BTI khỏe mỗi 20 phút, tách việc làm mới roster khỏi
việc cấp detail, ưu tiên receipt mới và vẫn replay luân phiên khi mất forward/API restart.
Giảm concurrency list và giãn detail; 429/5xx có backoff chung, 401/403 dừng đến khi native
session đổi. Recovery không được thay document để vượt backoff. Timestamp cũ luôn giữ nguyên.

Quan sát production phát hiện API tự khởi động lại một lần; tab BTI vẫn giữ source epoch.
API đã được sửa để bỏ qua roster/detail trùng trước bước giải mã nặng và lưu được catalog có
`nativeMarketObservations` (schema cũ âm thầm bỏ mọi lần lưu BTI). Báo cáo fatal lúc 22:21
**xác nhận JavaScript heap out of memory**. API tiếp tục được sửa để hash revision và ghi
catalog theo nhóm 128 phần tử, tránh sao chép/mã hóa cả danh mục lớn thành một chuỗi cùng lúc.
Không tăng trần heap và không nới ngưỡng độ mới. `/api/diag/runtime` chỉ trả số đo CPU/bộ nhớ/uptime.

Kiểm tra cuối khoảng 22:48: bản cuối chạy ~17 phút, API giữ cùng PID; sau 10 phút khởi động,
25/25 mẫu BTI LIVE/ACTIVE/FRESH, độ trễ catalog tối đa 11,5 giây, không mẫu vượt 30 giây,
không recovery hoặc lỗi chẩn đoán trong cửa sổ này. 1.627 trận / khoảng 38.541 market;
IM có 0 source trong registry. Đây là cửa sổ kiểm tra ngắn, soak 24 giờ vẫn đang chạy.

Báo cáo, kết quả kiểm thử và trạng thái đo thật: [BTI maintenance](superpowers/reports/2026-09-08-bti-maintenance.md).
Soak đọc loopback 24 giờ nằm trong `.run/bti-maintenance/`; **không coi thời gian mô phỏng hoặc
vài phút LIVE là đã nghiệm thu đủ 24 giờ**. Giữ nguyên hợp đồng độ mới 30 giây và không F5
tab nhà cái như một bước deploy.

## IM tối liên tục cả phiên — ĐÃ SỬA (2026-09-01 sáng)

**Triệu chứng:** tab IM (`imsports.directsb.net`) sống, envelope về đều (`envAge` 0–5s),
GetSE về đủ cặp Market 1/Market 2 cùng cutoff, nhưng `decoded=0`, `ignoredEndpoints`
chỉ có `/api/EventV6/GetSE`, feed kẹt `HARD_RECOVERY` với catalog journal 46 giờ cũ.

**Nguyên nhân (tái hiện bằng replay capture qua adapter dist):** Market 2 có **11 trong
11 976 market thuộc miền hỗ trợ** (bti∈{1,2}, gp∈{1,2,3}) mà selection **không có khóa
`hdp`** (còn lại `dih,o,ot,s,si,wsi` nguyên vẹn) — kèo chưa công bố line. `isClassifiedImMarket`
coi đó là malformed → `classifySnapshot` trả `null` cho **toàn snapshot** → cả generation
bị `rememberRejected` vĩnh viễn → không bao giờ có baseline. Cùng luật ở `validDeltaMarket`
làm rớt **cả** GetSEDelta khi một market như vậy xuất hiện — giá cũ của các trận khác trong
delta đó đứng lại thành giá hiện tại.

**Sửa (`isLineFieldWellFormed`):** `hdp === undefined` là loại trừ có giải thích thuộc miền
nhà cái, không phải bằng chứng hỏng — `market()` vốn đã bỏ market đó, trận vẫn giữ. `hdp`
có mặt nhưng không phải số/quá 100 vẫn là malformed. Guard `acceptedCount === 0` sẵn có vẫn
bắt trường hợp đổi schema toàn cục. Adapter đếm `market-line-absent` vào
`imContentRefusals`; `HOP4.contentRefusals` giờ chọn counter theo sàn (IM/APSPORT),
bớt một phần bẫy "counter chung" bên dưới.

**Kết quả:** hot-swap API 11:22:40 → IM `LIVE` 11:23:06, 154 trận / 1 400 market /
2 800 quote, q60 = 44 ngay vòng đầu.

**Cách tìm:** `im-replay.mjs` (scratchpad) gom chunk `{snapshotId,chunkIndex,...}` từ
capture, gọi `ImHttpCatalogAdapter.decode` của dist → 0 output với cặp hợp lệ, rồi kiểm
từng điều kiện của `classifySnapshot`/`isClassifiedImMarket` theo hình dạng.

## SABA đứng 3–7 phút mỗi 10–15 phút — NGUYÊN NHÂN GỐC, ĐÃ SỬA (2026-09-01 13:40)

**Đường tìm (ghi lại vì ba lần trước đoán sai):**
1. `HOP3.wsAttach.reconnectAttempts`/`reconnectOutcomes` luôn 0/"" → tưởng request recovery
   không tới extension. **Sai:** heartbeat chưa bao giờ gửi hai trường này (đã sửa, `33d8383`).
2. Sửa scheduler lane (`5122bc3`) và nhánh refresh SABA (`0626c30`) — đúng nhưng **không phải
   nút thắt**: sau khi diag sống, `reconnectAttempts` tăng đều, `refresh:enter refresh:run
   context:closed-1` → extension đóng socket mỗi lần recovery; nhà cái reconnect nhưng **không
   gửi lại `reset`**, WS mãi `recovery-without-baseline`.
3. Nối `onIngestRejected` của data-plane vào telemetry (`c34b98f`; 31 cửa `#reject` trước đó
   **hoàn toàn im**) → lúc stall thấy ngay `CATALOG_COVERAGE_REJECTED:saba-ws-catalog-v1` tăng
   đúng nhịp DOM.

**Nguyên nhân:** SABA sống bằng baseline DOM (`<epoch>:dom:<seq>`, một generation mỗi 2–4s).
`CatalogCoverageGuard` không có parser cho dạng này, parser fallback cũng thất bại (đoạn trước
số cuối kết thúc bằng `dom`) → mỗi generation là **opaque**, set opaque có cap **256**. Sau
~256 baseline (10–15 phút kể từ epoch/restart API) guard từ chối **mọi** baseline DOM tiếp theo
→ catalog đứng, recovery vòng lặp vô ích, hết cap 180s → hard → không có gì để làm.

**Sửa (`catalog-coverage-guard.ts`):** `comparableSabaDomGeneration` — lineage `["SABA_DOM",
epoch]`, order `[seq, 0]`; replay seq cũ vẫn bị từ chối; epoch mới là lineage mới. Test 600
snapshot liên tiếp.

**Còn mở (thật):** socket SABA sau reconnect không resend `reset` → lane WS chết cho tới khi
đổi tab/epoch; SABA đang chạy thuần DOM (viewport). Cần cách ép nhà cái gửi `reset` (đổi period
tab rồi về Hôm Nay?) — chưa đo.

## SABA không bao giờ được reconnect socket — ĐÃ SỬA (2026-09-01 trưa)

**Triệu chứng:** sau restart API 11:22, socket SABA tiếp tục đẩy frame nhưng không bao giờ gửi
lại `reset` → `recovery-without-baseline` lên 1 233, 35 lần `PROVIDER_STREAM_GAP` → soft/hard
recovery; catalog sống nhờ DOM snapshot rồi rơi hẳn (đứng 7 phút, 11:47–11:54). API đã gửi
≥ 4 đợt `REQUEST_SNAPSHOT`, nhưng phía extension `baselineTabSelections` = 1 và
`reconnectAttempts` = 0 suốt 20 phút → **request tới nơi mà không được thực thi**.

**Nguyên nhân:** `LocalBridge.#recoveryScheduler = new ProviderWorkScheduler()` — mặc định
**3 slot chạy đồng thời dùng chung cho cả 6 sàn**, mỗi sàn chỉ xếp hàng được 1 request, quá thì
`PROVIDER_WORK_QUEUE_FULL` bị nuốt im. Ba recovery của sàn khác chưa kết thúc (heap query
KSPORT/APSPORT, resync…) là SABA chết đói vô hạn.

**Sửa (`local-bridge.ts`):** `maxConcurrent = RECOVERY_LANES (8)` để lane theo sàn thật sự
độc lập; mỗi recovery bị `#boundedRecovery` chặn ở `RECOVERY_OPERATION_TIMEOUT_MS = 90s` —
hết hạn thì **nhả lane** (thao tác bên dưới vẫn chạy nốt); reject/timeout `console.warn` thay
vì im. Hai test mới trong `local-bridge.test.ts`.

**Cách nhận ra lần sau:** `HOP3.wsAttach.reconnectAttempts` = 0 trong khi `HOP6.recoveryAttempt`
tăng và `baselineTabSelections` không tăng — request đang nằm ở scheduler của bridge.

## Hợp đồng realtime 30s (2026-08-31) — luật mới của hệ thống

**Luật do người vận hành đặt:** không sàn nào được quá **30 giây** mà không trả về
dữ liệu giải mã được. Quá ngưỡng là **lỗi phải chẩn hoặc reconnect**, không phải
"khoảng lặng" để chờ. Mọi policy, ngưỡng hiển thị và watchdog đều quy về mốc này.

### Đo đầu phiên vs cuối phiên (1 mẫu/giây)

| sàn | p50 trước → sau | p95 trước → sau | % > 15s |
|---|---|---|---|
| SBOBET | 5.1 → **1.3s** | 27.9 → **2.8s** | 17% → **0%** |
| SABA | 5.6 → **3.4s** | 29.2 → **22.9s** | 18% → **11%** |
| CMD | 6.4 → **3.7s** | 26.8 → **6.4s** | 12% → **0%** |
| BTI | 7.4 → **3.7s** | 30.3 → **6.5s** | 18% → **0%** |
| IM | 14.4 → **9.1s** | 29.8 → **18.9s** | 47% → **20%** |

Không sàn nào còn mẫu vượt 30s.

### Năm nguyên nhân tìm được (theo thứ tự ảnh hưởng)

1. **Endpoint FE đọc trả bản cũ** (`cb0b38d`) — nguyên nhân lớn nhất của "Lagging".
   `/api/catalog/sources` là cache stale-while-revalidate TTL 5s: trả bản cũ rồi
   mới làm mới. Đối chứng: catalog SBOBET thật tươi **0.0–1.0s** trong khi endpoint
   báo **0.7–7.0s**, răng cưa chu kỳ 5s; refresh chậm/timeout thì bản cũ già mãi.
   Nay revalidate 1s, quá 3s thì **chờ câu trả lời thật**.
2. **Ngưỡng policy mỗi sàn một kiểu** (`b4539b0`) — đều đặt theo cái mà lane hỏng
   của sàn đó tình cờ làm được (45–90s). Nay tất cả: evidence 30s, soft recovery 30s,
   hard giữ ≥ 2× hợp đồng (có test chặn).
3. **Trần backoff recovery 5 phút** (`a041856`) — trần 5 phút chỉ có thể tạo ra sự
   cố 5 phút. Nay 30s; an toàn vì soft chỉ xin snapshot, hard vẫn có gate riêng.
4. **SABA đói baseline** (`2c50953`) — socket mới chỉ đẩy delta, không bao giờ gửi
   lại `reset`; 70 frame bị từ chối trong im lặng, DOM che cho feed trông LIVE.
   Nay từ chối quá 20s là khai `PROVIDER_STREAM_GAP`. **5,5 phút → ~20s.**
5. **IM không có delta** (`c02b02f`) — trang IM không phát GetSEDelta nào trong 2
   phút, nên chu kỳ lấy của extension **chính là** nhịp cập nhật cả sàn. 15s → 8s.

### APSPORT — sửa xong phần hệ thống, tab đang có vấn đề riêng

Ở view "Trực tiếp" (`mg/1`) trang không gọi API danh sách → roster lập ra **rỗng**
→ `socket-not-in-roster-of-0` 636 lần, sàn tối. Hai bản vá:
`d6e5b8e` roster rỗng thì chính frame socket lập roster (20/24 bản ghi live có
market hợp lệ sẵn); `4a23882` phát **BASELINE** thay vì DELTA — vì delta thêm trận
mới bị coverage guard chặn, khiến catalog vẫn rỗng dù frame về mỗi 122ms. Sau vá:
**511 trận / 2.333 market, feed LIVE**. Người dùng báo tab APSPORT không F5 được
(vấn đề của tab, không phải pipeline) → **tạm ngưng chấm điểm sàn này**.

### Bẫy chẩn đoán phải nhớ

`contentRefusals` trong `/api/diag/pipeline` là **bộ đếm dùng chung giữa các sàn** —
cùng một chuỗi xuất hiện ở IM lẫn SBOBET. Nó đã dẫn sai hướng một lúc
(`record-no-usable-markets` của APSPORT hoá ra là nhiễu). **Việc còn mở: tách
contentRefusals theo từng sàn.** Chỉ `ignoredEndpoints` là đáng tin theo sàn.

### Việc còn mở

- Tách `contentRefusals` theo sàn (bẫy ở trên).
- IM còn ~20% mẫu ở 15–21s; muốn siết nữa thì hạ 8s → 5s, đánh đổi tải API sàn.
- SABA p95 22.9s — cao nhất trong 5 sàn được chấm, chưa truy nguyên.
- APSPORT: chờ tab F5 được rồi đo lại.


Đọc file này thay cho việc đọc lại lịch sử hội thoại. Mọi số trong đây đều là số đo
thật, không phải ước lượng.

## SBOBET realtime — ĐÃ SỬA (2026-08-30 rạng sáng, nhánh feat/realtime-hardening)

**Triệu chứng:** UI sàn (`zenandfe.com`, socket `*.sb21.net`) nhảy giá liên tục nhưng
catalog chỉ cập nhật theo đợt ~2 phút. Đo qua `/api/diag/pipeline`: tuổi catalog ==
tuổi baseline chính xác từng ms, `quoteChanges60s=0` giữa hai baseline, dù 1.396
frame WS về trong 60s.

**Chuỗi nguyên nhân (đo, không đoán):**
1. Sàn chỉ trả full snapshot khi có SUBSCRIBE mới; topic `today` đi qua
   `subSportHotMatch` — **không bao giờ** full-snapshot. Adapter yêu cầu cặp full
   live+today để chuyển authority HTTP→WS, nên không bao giờ chuyển.
2. Dưới authority HTTP, mọi delta WS bị bỏ qua (gate cũ ở `decode()`), catalog
   đóng băng cho tới baseline HTTP kế tiếp.
3. Bẫy thứ hai: 102/102 receipt kèo trong capture là bản cập nhật 1–2 trận nhưng
   mang **đúng hình dạng mảng league của full snapshot** — không thể phân biệt
   full/delta bằng hình dạng. Nếu để máy handover WS nhận cặp "full" này, nó sẽ
   thay cả partition bằng vài trận.

**Sửa (2 commit trong `ksport-ws-adapter.ts`):** khi đang có baseline HTTP, mọi
receipt WS qua fence `envelope.sequence > httpAuthorityCutoff` được **fold làm
upsert vào chính baseline HTTP** và phát `evidenceMode: DELTA` với generation HTTP
(khớp `activeGeneration` nên controller nhận). Không đụng `wsSequenceHighWatermark`
— đẩy nó sẽ vứt mọi baseline HTTP sau qua fence pending-baseline.

**Kết quả đo 3 phút liên tục:** tuổi catalog giữ 100–200ms trong khi baseline già
tới 120s; 765–1.182 đổi giá/60s (trước: 0). Chu kỳ còn lại: lease baseline 120s hết
~10s trước khi cặp getEvent trong trang về → HOP6 chớm SOFT_RECOVERY vài giây mỗi
~2 phút, catalog vẫn tươi suốt — ngưỡng giữ nguyên, không nới.

**Diễn biến tiếp (02:27, test sống với người dùng):** trong lúc đổi epoch, trước
khi baseline HTTP đầu tiên kịp về, một "cặp full" giả (fragment đội lốt) đã chiếm
quyền WS → **catalog sập 142 → 62 trận rồi đóng băng**. Kết luận cuối: với sàn này
**không receipt WS nào đáng tin làm baseline**. Đã gỡ toàn bộ máy socket-authority
khỏi `ksport-ws-adapter.ts` (~1.000 dòng kèm test cũ): chỉ cặp getEvent HTTP làm
baseline; WS chỉ fold upsert qua fence sequence; socket đóng không invalidate
catalog nó chưa từng sở hữu. Test adapter viết lại (18), data-plane chuyển sang
cặp HTTP (53/53).

**Nốt cuối cùng của chuỗi:** baseline chỉ được làm mới khi stall → recovery, mà
backoff recovery lớn dần (128s → 256s) → mỗi ~2 phút đứng 30–60s. Extension giờ
**chủ động gia hạn lease mỗi 75s** khi socket khỏe (`#renewKsportBaselineLease`,
bundle `2390eb51`) — template fetch trước, native period request khi template hỏng.

**Việc còn mở:** (a) delta chỉ upsert — trận bị gỡ và trận MỚI chỉ vào/ra ở
baseline kế tiếp (coverage guard chặn delta thêm event mới), trễ tối đa ~75s;
(b) `expectedEvidenceCadenceMs=60_000` của SBOBET chỉnh hồi thế giới còn hỏng —
giờ evidence p50 ~300ms, có thể siết sau soak; (c) extension vẫn bơm SUBSCRIBE
lặp vô ích — vô hại nhưng ồn, dọn sau; (d) APSPORT view "Trực tiếp" (mg/1) vẫn
là gánh nợ cũ: tab trôi sang đó là roster chết (`record-no-usable-markets`,
`delta-generation-mismatch`) — workaround giữ tab ở "Hôm nay", fix thật ~1-2h.

**IM đêm nay không phải bug:** hai lần "mất data" đều là tab không còn attach
(0 envelope tới bridge); mở lại tab là tự hồi ~1 phút. Snapshot GetSE bị chunk
110KB nên trong capture nhìn như thiếu `StatusCode` — bản ráp nằm ở tầng sau.

## SABA — đặt tên xong, và cái tên nói đầu vào sai chứ không phải bộ giải mã

Đã đặt tên 9 lối thoát câm của `saba-ws-adapter.ts` (commit `f4ae6da`) và tách
năm kết cục mà `decodePublicDomRecords` gộp chung thành một `null` (commit `7b72752`).

Kết quả sau khi triển khai:

```
4 /ignored/dom-no-record-of-1-matched-schema
```

Ảnh chụp DOM của SABA chỉ có **1 bản ghi**, và bản ghi đó không khớp lược đồ nào.
Một trang sổ thể thao đang chạy phải cho ra hàng chục bản ghi. **Một bản ghi lạ là
hình dạng của trang lỗi hoặc trang đăng nhập**, khớp với ghi chép cũ:
`ErrorPage?Game=DepositLogin&ErrCode=SPA-1008`.

**Kết luận: SABA không phải lỗi bộ giải mã — tab của nó không ở trang sổ thể thao.**
Cần người dùng mở lại. Khi tab về đúng trang, đo lại bằng `do-go-keo.mts`; nếu
vẫn hỏng thì bây giờ báo cáo đã biết nói cửa nào.

---

## Trạng thái mới nhất — 2026-08-29 tối

**5/6 sàn LIVE.** Đo bằng `npx tsx .run/do-go-keo.mts 60000`, chỉ tính trận đang đá:

| sàn | cửa live | GỠ | đổi giá | tình trạng |
|---|---|---|---|---|
| CMD | 750 | 90 (12%) | 528 | ✅ vừa sửa xong |
| BTI | 868 | 80 (9,2%) | 561 | ✅ |
| APSPORT | 120 | 120 (100%) | 0 | ✅ LIVE, roster vừa thay toàn bộ |
| SBOBET | 0 | – | – | LIVE, chưa có trận đang đá để đo |
| IM | 0 | – | – | LIVE, chưa có trận đang đá để đo |
| **SABA** | 1294 | **0** | **0** | ❌ HARD_RECOVERY, đứng hoàn toàn |

### CMD — một dòng hỏng vuứt cả baseline (ĐÃ XONG, commit `4eafdb4`)

CMD nằm HARD_RECOVERY với danh mục cũ **84 phút** trong khi 630 phản hồi HTTP
vẫn về mỗi kỳ đo. Nguyên nhân: mỗi baseline khoảng 1.690 dòng bị vứt sạch chỉ vì
**một** dòng không giải mã được. Không có baseline thì nguồn không bao giờ được
nâng từ CANDIDATE lên ACTIVE — `authorityDisposition: NONE` — nên danh mục đứng.

Tìm ra bằng đúng bước 4 của spec: adapter CMD có **13 lối thoát `return []` trần**,
không cái nào khai lý do. Sau khi đặt tên (commit `43ef281`), báo cáo hiện ngay:

```
6 /ignored/baseline-row-unusable-of-1690
6 /ignored/baseline-row-unusable-of-1694
2 /ignored/baseline-row-unusable-of-1696
```

Con số kèm theo là thứ quyết định cách sửa: **một** dòng hỏng trên 1.690, không
phải đổi lược đồ (đổi lược đồ thì cả 1.690 đều hỏng). Nên: bỏ riêng dòng đó, giữ
ngưỡng một phần hai mươi để vẫn từ chối khi lược đồ thật sự đổi.

Sau khi triển khai: LIVE/FRESH 1s, authority ACTIVE, giải mã 168 (trước 5).

### Bẫy mới mắc 2026-08-29

**`start-live-stack.mjs` báo "already running" thì KHÔNG nạp bản dựng mới.** Đã
mất 25 phút đo một hệ thống đang chạy đúng code vừa gỡ bỏ. Cách dừng êm đúng:

```bash
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('.auth/run/live-stack.json','utf8'));fs.writeFileSync('.auth/run/live-stack.shutdown.json',JSON.stringify({version:1,instanceId:s.instanceId,shutdownToken:s.shutdownToken}))"
```

Kiểm chứng bằng `buildIdentity` trong `.auth/run/live-stack.json` — nó phải đổi.

**`contentRefusals` trong `/api/diag/pipeline` là bộ đếm DÙNG CHUNG**, in y hệt cho
cả sáu sàn (nó là biến cấp module trong adapter APSPORT). Đừng gán cho sàn đang xem.
Các trường RIÊNG từng sàn: `decoded`, `ignored`, `rejectReasons`, `lastDecodedAgeMs`,
`ignoredEndpoints`.

---

## Mục tiêu

6 sàn chạy realtime, ghép trận giữa các sàn để tìm chênh lệch giá. Thước đo duy nhất
có nghĩa là **số dòng ghép chéo giữa các sàn**, không phải số trận của một sàn.

## Tình trạng 6 sàn (đo 2026-08-28)

| sàn | trạng thái | ghi chú |
|---|---|---|
| CMD | chạy tốt | tuổi dữ liệu ~0s, FRESH |
| BTI | chạy tốt | ~0s, FRESH |
| IM | chạy tốt | ~13s, FRESH. Đăng lịch 2 ngày, đã lọc còn 24h |
| APSPORT | chạy một phần | ~94s, STALE. Codex đang làm đường lấy qua API |
| SABA | **hỏng** | 50 phút cũ. Tab rơi sang `ErrorPage?Game=DepositLogin&ErrCode=SPA-1008` → **phiên đăng nhập hỏng, cần đăng nhập lại** |
| SBOBET | **hỏng** | 62 phút cũ, `decoded=0`. Khung CÓ về trên `/sport/{id}/{token}/websocket` nhưng không giải mã được |

## Lỗi đã tìm ra 2026-08-28 chiều — một sàn im giết cả sáu

Đây là lý do các sàn "rụng vào ra" suốt hai ngày, và là lý do mọi con số "5/6 sàn
chạy" đều sụp ngay sau khi đo.

Sáu sàn quan sát qua **một socket chung**. Trong `chrome-bridge-registry.ts`,
`#retireSources` xử lý một sàn im quá `retireAfterMs` (5 phút) bằng cách ném **cả
socket** vào `#revokedConnections`. `ingestDetailed` từ chối mọi khung tới trên một
socket đã thu hồi, và `WeakSet` đó không bao giờ được xoá. Nên một sàn chết là cả
sáu chết vĩnh viễn — trong khi socket vẫn mở, nên extension không thấy gì hỏng để
sửa, và API không còn source nào để gửi lobby snapshot.

Số đo lúc 17:58:11 ngày 2026-08-28: SABA (phiên đăng nhập đã hỏng) gửi khung cuối
lúc 17:29:05; CMD, IM, SBOBET, APSPORT, BTI đều dừng trong khoảng 17:34:02–17:34:05
— cách đúng 297–300 giây, bằng `retireAfterMs = 300_000`. 24 phút sau mọi số thứ tự
khung vẫn đứng im, `listSources` rỗng, còn kết nối Chrome thì mở liên tục từ
17:25:26 và chưa từng đứt.

**Đã sửa** (commit `b835cd9`): thu hồi theo **(socket, tài khoản)** thay vì theo
socket. Một sàn bị thu hồi vẫn phải chứng minh connection mới mới giành lại được
quyền — giữ nguyên ý đồ cũ — nhưng không nói thay cho sàn nó không sở hữu.
`releaseConnection` vẫn thu hồi tất cả, vì ở đó socket đứt thật.

Bài học chung: **extension khoẻ không có nghĩa dữ liệu đang chảy.** Trước khi nghi
extension, đo `listSources` và tuổi khung của từng sàn; nếu mọi sàn dừng trong cùng
vài giây thì lỗi nằm ở chỗ dùng chung, không phải ở từng sàn.

## CMD — dấu mức chấp hiệp 1 (ĐÃ XONG, commit `4e2b528`)

**Mỗi hiệp có trường riêng chỉ bên cho chấp.** `row[24]` là của kèo cả trận,
`row[64]` là của kèo hiệp 1. Adapter trước đây đọc `row[24]` cho cả hai.

Đo trên 732 hàng bắt được 2026-08-28: hai trường lệch nhau ở 54 hàng, và ở đúng
**4 hàng** có kèo chấp hiệp 1 thật — Atlante v Club Leon, Eintracht Braunschweig
v Hertha Berlin, FC Voluntari v Otelul Galati, ZKS Kluczevia v SKS Unia
Swarzedz. `row[64]` đúng cả 4. Chấm theo thang giá của chính từng trận (giá chủ
nhà phải giảm khi mức chấp chủ nhà tăng): `row[64]` đúng 44/44 cho hiệp 1,
`row[24]` đúng 40/44; ngược lại cả trận thì `row[24]` đúng 87/94 còn `row[64]`
74/94.

Cách bắt được: bật `CHROME_BRIDGE_CAPTURE=1 CHROME_BRIDGE_CAPTURE_LOBBIES=CMD`,
payload ghi vào `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures`. **Nhớ đọc cả
`data` lẫn `today`** khi ghép mảnh — bỏ `today` là mất phần lớn trận.

## Ghi chú cũ về CMD (giữ để tra cứu)

Nguồn thật của danh mục CMD **không phải DOM** mà là
`/Member/BetsView/BetLight/DataOdds.ashx`, giải mã ở
`apps/api/src/chrome-bridge/cmd-http-adapter.ts`. Mỗi hàng dài 91 trường, `-999`
nghĩa là không có kèo.

```
row[10] mức chấp cả trận   row[40]/[41] giá chủ/khách
row[14] mức chấp hiệp 1    row[44]/[45] giá chủ/khách
row[24] BÊN CHO CHẤP  ← dùng chung cho cả hai loại kèo
```

Mức chấp luôn là **trị tuyệt đối** (`0.25`, không bao giờ `-0.25`); dấu hoàn toàn
do `row[24]` quyết định. Trận nào hiệp 1 và cả trận nằm ở hai bên khác nhau thì
một trong hai chắc chắn sai, và nửa sai được phát ra như **ảnh gương** của mức
chấp thật.

Đo 2026-08-28: CMD ra `Atlante v Club Leon` hiệp 1 là `1.54/2.52` trong khi
SBOBET `2.54/1.51`, IM `2.47/1.56` cùng mức chấp — và kèo cả trận của chính CMD
đồng ý với họ. Ghép chéo, nửa bị gương đọc thành **ROI 16,46%**, hai chân vé
cùng đặt một cửa. 3/348 phép so chấp hiệp 1 giữa các sàn lệch; mọi loại kèo khác
đúng 1260/1260.

**Đã làm** (`32269b8`, `8c7c962`): giữ lại kèo khi một trận có hai kèo cùng loại
cùng mức chấp mà **giá khác nhau** — bằng chứng chắc chắn có bên bị gán sai,
nhưng không biết bên nào nên không phát cái nào. Trùng lặp **cùng giá** thì giữ
(SABA phát trùng y hệt rất nhiều).

**Chưa xong:** trận chỉ có duy nhất một kèo hiệp 1 thì không có gì để đối chiếu.
Muốn tìm trường mang bên cho chấp của hiệp 1 phải có payload của **trận chưa đá**
— mọi payload bắt được tới giờ chỉ có trận đang đá, và ở đó `row[24]` đúng cả
11/11 hiệp 1 lẫn 14/15 cả trận.

Bật ghi payload: `CHROME_BRIDGE_CAPTURE=1 CHROME_BRIDGE_CAPTURE_LOBBIES=CMD`,
ghi vào `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures`. Ghi cho cả 6 sàn sẽ
làm `replay-harness.test.ts` hết lỗi (hiện thiếu payload 5 sàn).

## Mức chấp nguyên bị loại là CỐ Ý

`isSupportedFootballTwoWayLine` có `quarterUnits % 4 !== 0` — loại mọi mức chấp
nguyên (0, 1, 2…). Khoảng một phần ba kèo chấp của CMD rơi vào đây. **Đừng
"sửa"**: kèo chấp nguyên có thể hoà vốn hoàn tiền, mà bộ tính ROI chưa mô hình
hoá hoàn tiền — tính vào là ra ROI sai.

## Nối tên giải — tích luỹ qua nhiều ngày (commit `38421d5`)

Luật vẫn là **2 trận khác nhau** mới nối hai tên giải — đó là thứ giữ cho một
cúp không gộp vào một giải khi chúng chung đúng một trận. Chỗ sửa: hai trận đó
**không cần cùng có mặt một lúc**.

Đo 2026-08-29: 104/124 cặp giải có trận chung chỉ có **đúng một** trận, vì cửa
sổ 24 giờ thường chỉ chứa một trận mỗi giải còn vòng sau cách vài ngày.

- Bằng chứng đếm theo **trận khác nhau**, không phải số lần thấy. Một giải xuất
  hiện nghìn lần với cùng một trận vẫn là một trận, vẫn không nối (có test chạy
  50 lần chụp liên tiếp).
- Chỉ nhớ **trận chưa đá** — trận đang đá báo thời điểm quan sát chứ không phải
  giờ bóng nên không tự định danh lại được, và nó cũng không cần vì trận live
  ghép được mà không cần nối tên giải.
- Cặp đã chứng minh **sống qua lần tải lại trang**, lưu ở `localStorage`
  (`comparisonCompetitionLinksV1`), nạp lại qua lệnh `RESET` của worker.

**Kỳ vọng thực tế:** nạp lại 4,5 giờ ảnh chụp của một tối chỉ thêm **4 dòng** —
vì trong một buổi chiều các trận trên bảng gần như không đổi. Lợi ích cộng dồn
theo **ngày**, khi các giải đá vòng tiếp theo. Không có lưu trữ bền thì cơ chế
này vô dụng, nên hai phần phải đi cùng nhau.

## Giá không cập nhật khi sàn đổi giá — CMD đã xong

**Mô-típ: một dòng hỏng vứt cả lô.** `cmd-http-adapter.ts` áp delta theo lô; chỉ
một dòng trả `INVALID` là `return []` — toàn bộ thay đổi giá của các trận khác
trong cùng phản hồi mất sạch, `state.rows` giữ nguyên giá cũ. Sàn đã đổi giá, danh
mục thì không.

Hai dòng gây ra chuyện đó liên tục:

- **`-999` là mã CMD dùng khi khoá kèo.** `finiteOdd` từ chối mọi `|x| > 1` nên
  mỗi lần CMD khoá một kèo (mỗi bàn thắng, mỗi lần dời mức chấp) là vứt cả lô.
- **Delta cho trận mình không giữ** (trang có nhiều môn khác) cũng thành `INVALID`.

Đã sửa (`b0a5f6e`): `-999` **ghi thẳng vào hàng** để `decodeRecord` bỏ kèo đó đi
(kèo biến mất thay vì giữ giá cũ); delta cho trận không giữ thì bỏ qua riêng nó.
Lỗi cấu trúc thật vẫn vứt cả lô.

**Đo sau khi sửa — giá đổi trong 30 giây:**

| sàn | giá đổi | giữ nguyên | % |
|---|---|---|---|
| CMD | 149 | 343 | **30,3%** ✅ |
| BTI | 195 | 451 | 30,2% ✅ |
| SBOBET | 81 | 375 | 17,8% ✅ |
| IM | 19 | 8.653 | **0,2%** ⚠ |
| APSPORT | 0 | 2.828 | **0,0%** ❌ (vẫn báo FRESH) |
| SABA | 0 | 1.660 | 0% (báo STALE, đúng) |

## Cách đo lại nhanh

`.run/dem-bti-thehe.mts` — chụp hai lần cách 30 giây, đếm `rawOdds` đổi theo
`providerSelectionId`. Đây là phép đo trực tiếp nhất cho câu "sàn có cập nhật
không".

`%LOCALAPPDATA%\tool-chenh\logs\realtime-ticket-checks.jsonl` — mọi lần bấm
"Kiểm tra giá thật", có `verificationStatus` (MATCH / MISMATCH / NOT_FOUND) kèm
`directMethod`. **Lưu ý:** `NOT_FOUND` của APSPORT/SABA phần lớn là **đầu đọc
DOM không thấy dòng** (trang chỉ dựng phần đang nhìn), không phải giá sai. Chỉ
`NOT_FOUND` của sàn dùng `IN_PAGE_FETCH` mới là bằng chứng kèo đã biến mất thật.

## APSPORT đứng giá — ĐÃ XONG (2026-08-29)

**Mẫu yêu cầu kẹt thế hệ.** Danh mục APSPORT làm mới qua một request template lấy
từ trang; template thuộc về thế hệ nguồn/tab lúc lấy, mà **cả hai nhảy sau mỗi
lần nối lại**. `#refreshApsportCatalog` dùng lại template trong bộ đệm, thấy nó
cũ hơn thế hệ hiện tại thì **thoát im lặng** — và không gì dọn bộ đệm, nên nó
thoát mãi mãi. Cả vòng đời tab chỉ có **một lần roster**.

Số đo lúc hỏng:

```
wsAttach.sourceGeneration = 20      nhung activeGeneration = apsport:...:1
baselineAgeMs = 281187              tran maxBaselineAgeMs = 120000  -> HARD_RECOVERY
observedEvidenceCadenceMs p50 = 199ms, 405 mau   <- socket VAN gui deu
observedAtMs khong doi sau 60 giay  <- 852 tran / 8132 gia dong bang nguyen khoi
```

Feed đòi baseline mới trong 2 phút; không có thì **ngừng phát danh mục** dù dữ
liệu vẫn về 5 lần/giây. Đó chính là "nguồn ổn định mà không realtime".

Đã sửa: template lệch thế hệ thì **dựng lại**; lối thoát còn lại khai tên
`APSPORT_TEMPLATE_GENERATION_STALE`. Sau khi reload extension: baseline không
quá 23s, 130–300 giá đổi mỗi phút.

**Đây là thay đổi trong extension** — phải `npm run build` ở `apps/chrome-extension`
rồi **reload extension** ở `chrome://extensions` mới có hiệu lực.

## Hai lỗi cùng họ đã sửa trong ngày

- **CMD**: một dòng delta hỏng vứt cả lô (`-999` là mã khoá kèo mà `finiteOdd` từ
  chối). Sửa: ghi `-999` xuyên qua để kèo biến mất; delta cho trận không giữ thì
  bỏ riêng nó.
- **APSPORT**: khung báo khoá kèo bị vứt, để lại giá cũ. Sửa: khoá đi xuyên qua
  thành `SUSPENDED`, tầng so sánh và tầng cược đều không định giá.

Mô-típ chung: **một tín hiệu "không có hàng" bị đọc là "lỗi", rồi vứt luôn cả
thứ đi kèm.** Gặp "sàn đứng giá" thì tìm mô-típ này trước.

## VIỆC GẤP NHẤT — chưa làm

**Bảng đang xếp vé ROI dương dựng từ dữ liệu cũ lên đầu.** Đo được: 4 vé dương
(2,66% / 1,60% / 0,56% / 0,23%) đều dựa vào SABA với dữ liệu 50 phút. Đó là chênh
lệch ảo — SABA đứng giá trong khi CMD/IM/BTI vẫn chạy.

API **đã** đánh dấu đúng (`snapshotState=STALE`), nhưng lớp so sánh vẫn nhận cả danh
mục STALE rồi mới phân biệt, nên vé sai leo lên chỗ dễ tin nhất.

Cần: không xếp vé dựng từ dữ liệu STALE chung bảng với vé tươi — hoặc loại, hoặc tách
khu và ghi rõ tuổi. `comparison-worker-engine.ts` đã tính sẵn cả `displayEvents` và
`freshEvents`, nên phần lớn cơ chế đã có.

## Việc còn lại, theo thứ tự

1. Chặn vé STALE khỏi bảng xếp hạng (trên)
2. SABA: đăng nhập lại, rồi kiểm tra `decoded` có tăng không
3. SBOBET: khung về trên `/sport/{id}/{token}/websocket` mà không giải mã được —
   cùng họ lỗi với APSPORT hôm qua (vân tay khớp đường dẫn cứng)
4. "Kiểm tra giá thật" của SABA chỉ đọc DOM nên trận không hiển thị là hỏng
   (`VISIBLE_PRICE_NOT_FOUND`). BTI/KSPORT/TSPORT có đường gọi API trong trang nên
   luôn khớp. Cần cho SABA một đường tương tự, hoặc mở trận trước khi đọc.
5. Chuyển phép ghép trận từ client sang server (xem "Kiến trúc" bên dưới)

## Cách đo — dùng lệnh, đừng đoán

```bash
# trạng thái 6 sàn, mọi cửa lỗi im lặng đều khai tên
curl -s http://127.0.0.1:4310/api/diag/pipeline

# tuổi dữ liệu + snapshotState từng sàn
curl -s http://127.0.0.1:4310/api/catalog/accounts/catalog-source:SABA:FOOTBALL
```

`.run/realtime/stability.jsonl` — soak liên tục, `up%` và số lần lật theo từng sàn.

**Đừng đo trong 10 phút sau một lần deploy.** Restart làm mọi sàn tụt; đo lúc đó là vô
nghĩa. Đây là lỗi lặp lại nhiều lần trong phiên trước.

## Chẩn đoán đã cài sẵn (dùng đi, đừng viết lại)

Trước đây mọi thất bại đều im lặng giống hệt nhau. Nay mỗi cửa đều khai tên:

- `HOP4_ADAPTER.ignoredEndpoints` — tiền tố `/route-…` (bộ định tuyến từ chối, kèm
  đường dẫn thật) và `/ignored/…` (bộ điều hợp tự bỏ, kèm lý do)
- `HOP4_ADAPTER.contentRefusals` — vì sao khung không phải bản ghi bóng đá
- `wsAttach.catalogShape` — hình dạng trang APSPORT thấy được, kèm danh sách socket
- `wsAttach.snapshotRejections` — vì sao ảnh chụp nền bị loại

Tất cả chỉ ghi **hình dạng**: tên trường, tên loại, số đếm. Không ghi giá trị, đích,
header, token.

## Ràng buộc bắt buộc

- **Chỉ đọc.** Không bao giờ đặt cược.
- Không navigate/reload tab nhà cái như một phần của deploy.
- Chẩn đoán chỉ ghi hình dạng, không ghi giá trị.
- `sảnh.md` chứa URL sảnh thật — trong `.gitignore`, không commit. Token trong URL là
  bí mật; token đã gửi qua chat cần đổi.

## Những cái bẫy đã mắc — đừng lặp lại

1. **Đo một khoảnh khắc rồi kết luận.** Đã nhiều lần báo "5/6 sàn chạy" dựa trên đúng
   lúc chúng đang lên. Số thật qua 6 giờ khác hẳn. Luôn dùng soak.
2. **Nâng ngưỡng để làm đẹp số.** Nâng cadence SABA 75s → 180s làm nó *trông* 90%,
   nhưng cũng nâng cửa sổ tươi lên 3 phút — giá cũ 3 phút hiện như giá hiện tại, tức
   chế ra ROI ảo. **Đã hoàn tác.**
3. **Chọn phần tử theo nhãn mà không giới hạn khu.** Bộ chọn mục thời gian bấm nhầm
   dải tab của "Á Vận Hội", đẩy trang SABA sang mục trống → socket không có gì để gửi.
   Đã gỡ; module còn đó, chưa nối, có ghi cảnh báo.
4. **Deploy liên tục rồi đo ngay.** ~20 lần deploy trong hai ngày, mỗi lần đánh sập
   mọi sàn vài phút.
5. **Dùng con số trên menu sàn làm số trận.** `bóng đá 604` là counter tổng của sàn,
   không phải số trận đủ điều kiện.
6. **Tin cách chuẩn hoá của mình thay vì của code.** Từng kết luận "26 trận mất vì tên
   giải" nhưng vài cặp trong đó đã được ánh xạ sẵn — bộ đo dùng hàm gấp chữ riêng,
   không phải `competitionIdentity`.

## Mô-típ lỗi lặp đi lặp lại trong kho này

**Hỏng một lần là chết vĩnh viễn.** Rất nhiều lỗi hai ngày qua đều cùng hình dạng:
một chốt không được thả, một danh sách "mong đợi" đòi đủ mới chịu phát, một cửa thoát
im lặng. Khi gặp "sàn im hẳn", tìm chốt trước khi tìm lỗi giao thức.

Ví dụ đã sửa: chốt chụp DOM không bao giờ thả; quét đòi *mọi* dòng đọc được; phục hồi
cứng tải lại tab 19 lần vì một nhịp thành công xoá sạch bộ đếm giãn nhịp; adapter vứt
mọi khung khi chờ dữ liệu nền.

## Kiến trúc — điều cần biết

**Phép ghép trận đang chạy ở client, không phải server.** `buildComparisonEvents` chỉ
có trong `apps/web`. Mỗi client tải ~6,5 MB rồi tự tính 134 ms. 5 người xem = 5 lần
tải và 5 lần tính.

Chuyển sang server thì **không làm chậm realtime, còn nhanh hơn ở client**, nhưng ba
điều kiện bắt buộc:
- Chạy trong **worker thread** ở API (API hiện không dùng worker nào; 134 ms chặn
  event loop sẽ làm hại chính luồng nhận dữ liệu)
- Client **lọc trên kết quả** khi tích/bỏ tích sàn (không thể tính sẵn 64 tổ hợp)
- Kết quả phải **mang theo tuổi dữ liệu của từng sàn**, không gộp thành một mốc chung

## Tài liệu liên quan

- `docs/apsport-handoff-codex.md` — nguyên nhân gốc APSPORT (adapter xoá record socket
  không nằm trong danh sách DOM, mà AP dùng danh sách ảo hoá) + luồng lấy đúng
- Lịch sử: mỗi commit trên `feat/six-provider-realtime-feed` ghi rõ đo được gì và vì
  sao sửa. Đọc `git log` rẻ hơn đọc lại hội thoại rất nhiều.
