# Bảng trạng thái — mỗi dòng một số, mỗi số một lệnh tự kiểm

Checkbox trong `docs/superpowers/plans/*.md` **không phải thước đo**: nhiều plan ghi
`0/67` trong khi mã đã chạy đủ. Không ai cập nhật chúng. File này thay thế, và chỉ
nhận một dòng là XONG khi có **số đo được** kèm **lệnh tái lập**.

Cập nhật lần cuối: 2026-09-15. Nhánh `feat/realtime-hardening`.

## Lệnh đo chính

```bash
npx tsx scripts/measure-cross-book-rows.ts
```

Số quan trọng nhất nó in ra: `ROWS ACROSS BOOKS` và khối `by edge`.

```bash
curl -s http://127.0.0.1:4310/api/diag/pipeline
curl -s http://127.0.0.1:4310/api/catalog/sources
curl -s http://127.0.0.1:4310/api/sessions
```

> **Đừng đo trong 10 phút sau deploy.** Restart làm mọi sàn tụt về 0.

---

## XONG — có số, đã kiểm trên bản chạy thật

| # | Việc | Số đo được | Kiểm bằng |
|---|---|---|---|
| 1 | Đo được bảng ghép ngoài trình duyệt | Cùng phiên 2026-09-16: BTI chết **13.145** dòng / 1.291 trận → BTI đủ kèo ẩn **16.807** / 2.057 trận. Ghép của riêng BTI: SBOBET **9.590**, APSPORT **9.430**, IM **8.705**, CMD **7.343**, SABA **382** | `measure-cross-book-rows.ts` |
| 2 | Chặn sàn chết khỏi ghép (IM cũ 55,7 giờ) | kèo dương **80 → 13** | khối `by edge` |
| 3 | Phiên quá hạn phải tự khai | **6/6** sàn báo `reason=EXPIRED` | `/api/catalog/sources` |
| 4 | Feed sống không được bảo lãnh cho phiên chết | `overlayStatuses` giữ `EXPIRED` | `/api/catalog/sources` |
| 5 | Tách một mã từ chối gộp ba vấn đề | preflight trả `CATALOG_SOURCE_SECRET_UNAVAILABLE` | `POST /api/preflight/provider` |
| 6 | Thôi báo lịch 03:00 không tồn tại | `scheduledHour` **3 → null** | `/api/maintenance` |
| 7 | Đường gia hạn chỉ-phiên (Task 5 của plan 2026-08-17) | chạy, fail-closed, ghi journal | `%LOCALAPPDATA%/tool-chenh/maintenance/events.jsonl` |
| 8 | CMD: đếm phủ sóng theo **trận**, không theo **event id** | `partialWanted` **68 → 0** | `CMD_NATIVE[...]` trong `/api/diag/pipeline` |
| 9 | Chặn giá in-play lệch đồng hồ (hai lớp) | kèo dương **10 → 3**, cao nhất **66,25% → 0,31%**, in-play dương **0** | khối `by edge` + `positive rows by phase` |
| 10 | APSPORT: kèo in-play của cùng một trận lệch nhau ~50.000 sequence | p50 **49.680** so với **0** ở CMD/SBOBET/BTI, **74** ở SABA | `coherentLiveQuotes` |
| 12 | `FT_HALF_FULL_RESULT` dùng chung tên selection `HOME_AWAY` — **an toàn** | 0 dòng được tạo; `footballResultMarketSpec` chỉ nhận 6 loại, không có nó | `marginBearingMarkets` |
| 14 | Ghép kèo nhiều cửa chưa ai so | HT/FT **0 → 180**, RESULT_BTTS **0 → 99**, HIGHEST_SCORING_HALF **0 → 436** | `by market type` |
| 15 | Ráp phân hoạch bị sàn tách thành nhiều market gốc | HT/FT 72 → **180** sau khi ráp | `partitionRowsForTest` |
| 19 | Kèo có nhánh hoàn tiền (DNB, first-corner) | **0 → 126** dòng; tách bảng riêng, `hasVoidBranch` phân biệt | `by market type` |
| 20 | Vì sao 20% bảng không có giá | **3.408/3.408** là "một sàn tốt nhất ở mọi cửa" — đúng thiết kế. 0 dòng thiếu chân | `whyUnpriced` |
| 21 | Trần kèo góc, đo qua bộ ghép thật | **49** trận / 2.025 khi đủ 6 sàn; **31** / 999 khi thiếu BTI. Đo lại 2026-09-16: BTI chỉ có kèo chính **55** / 1.291 (377 dòng góc) → BTI có cả kèo ẩn **67** / 2.057 (**485** dòng góc) | `cornerCoverage` |
| 22 | Kèo góc có bị thu sót không | **Không.** SBOBET **0**, CMD **0** kèo góc thấy-mà-không-chuẩn-hoá-được | `nativeMarketObservations` |
| 30 | BTI collector giờ tự khai | `BTI_COV[chars:N]` → `BTI_COV[phase:…;failed:…;requestStatus:…;authBlocked:…]`. Chính nó cho ra `none` và chốt được chẩn đoán mục 29 | `catalogShape` trong `/api/diag/pipeline` |
| 31 | Sweep gia hạn tự giữ backoff | 8 lần thử/giờ → **1 lần mỗi 5→60 phút**, và nói rõ đợi bao lâu | `%LOCALAPPDATA%/tool-chenh/maintenance/events.jsonl` |
| 32 | Ứng viên kẹt được hỏi lại | Trước: **1 lần/nhiệm kỳ**. Sau: nonce vẫn chặn spam mỗi ACK, nhưng ứng viên còn là ứng viên sau **60s** thì hỏi lại | `chrome-bridge-route.test.ts` |
| 33 | Collector đang chờ tự khai là đang chờ | `cancelled()` trước trả **không có `coverage`** → `BTI_COV[none]`, giống hệt "không có collector". Giờ mang `phase:PAUSED\|ROSTER_BACKOFF\|SESSION_LOST\|CANCELLED` kèm `authBlocked`, `requestStatus`, backoff còn lại | `bti-coverage-shape.test.ts` |
| 34 | Gắn vào `worker`/`service_worker` cho mọi sàn | Trước chỉ `iframe`, cộng `worker` riêng KSPORT/SABA. BTI chỉ có service worker nên không bao giờ được gắn | `network-observer.test.ts` |
| 35 | Ghi kết quả dựng target con cho mọi sàn | Lỗi `Network.enable` trước chỉ ghi cho SABA, các sàn khác nuốt lặng. Nay `child[net-ok-worker:1]` — chính nó chốt được mục 29 | `catalogShape` |
| 36 | Ghi kết quả bật Network trên chính tab | Trước `await` trần: hỏng là `start()` đứt và không ai biết. Nay `main-net-ok` / `main-net-<lý do>` — chính nó loại bỏ giả thuyết "gắn hỏng" | `catalogShape` |
| 24 | BTI `UNPAIRED_OR_INVALID_NATIVE_SELECTIONS` — **không phải lỗ hổng** | 2.466 market/144 trận là bản tổng hợp trùng; **144/144 trận đã có sẵn** cả thang tài xỉu lẫn kèo chấp. **0** trận bị từ chối mà không có gì thay thế | `nativeDetail=summary` |
| 23 | `OTHER_SCORE_DOMAIN_REQUIRED` — **trần thật** | APSPORT **0/805**, SBOBET **0/184** market có cửa vét "tỉ số khác". Không có cửa đó thì không định giá được | `nativeDetail=summary` |
| 37 | Tên lối thoát roster bị chính bộ lọc hiển thị nuốt | `lastRosterFailure` in ra `none` rồi **biến mất** đúng lúc collector bắt đầu đặt tên. Bộ lọc chỉ cho qua `[A-Za-z_]`; mọi tên thật (`early-inventory-null`, `threw-TypeError-live`) đều có gạch nối. Một trường **biến mất** bị đọc thành **không có lỗi** — đúng cái bẫy đã mắc 4 lần | `bti-coverage-shape.test.ts` |
| 29 | **BTI tối 11 giờ: lịch xa kéo theo cả live và prematch** | Đọc được tên thật: `early-inventory-unusable`. Cổng sau `Promise.all` đòi **đủ 3** phân hoạch, nên `early` hỏng thì **vứt luôn** live + prematch đã dựng xong. Nay chỉ live + prematch là bắt buộc; `early` vắng thì đứng thế bằng **rỗng**, không phải bằng bản cũ — trận rời khỏi danh mục chứ không giữ giá không ai xác nhận. **`catalogAgeMs` 39.481.000 → 10.513**; BTI **380 trận / 2.732 market / 6.193 quote**, ghép **1.191 dòng với IM, 1.017 CMD, 965 APSPORT, 961 SBOBET, 18 SABA** | `catalogShape` + `measure-cross-book-rows.ts` |
| 38 | **BTI: mở rộng `early` mỏng hơn làm mất TOÀN BỘ kèo ẩn** | Tên thật: `early-inventory-thin` — request mở rộng **có trả lời**, chỉ ít giải hơn hoặc ít dòng đọc được tên hơn danh sách ban đầu. Từ chối nó làm hỏng cả phân hoạch `early`, mà lập kế hoạch detail + `COMPLETE` + tái dùng cache detail **đều gán điều kiện đủ 3 phân hoạch**, nên lịch xa hẹp đi đang trả giá bằng **mọi kèo ẩn của BTI**. Nay từ chối thì `early` giữ lát cắt ban đầu (10 giải thật, tươi — không phải bản cũ phát lại). Đo được: mỏng **không cố định** — lần chạy sau tự mở rộng 10 → **192 giải**, 120 = 120 dòng có tên. BTI **380 → 1.531 trận, 2.732 → 29.729 market, 6.193 → 65.076 quote**, `detailCoverageComplete:1` | `catalogShape` + `measure-cross-book-rows.ts` |
| 26 | CMD `EVENT_NOT_COMPARABLE` — tách 5 nguyên nhân | 1.170/130 trận họ kèo bị từ chối có chủ ý · 459/51 e-soccer · 190/10 còn sót. **`EVENT_STATISTIC_LEAGUE_UNRESOLVED` = 0** → không mất giải góc nào | `nativeDetail=summary` |

## ĐANG CHẠY — đã giao nhưng **chưa** chứng minh hết

| # | Việc | Tình trạng thật |
|---|---|---|
| 11 | ~~SABA: set ảnh chụp DOM bị xé~~ | **Chẩn đoán SAI, đã rút.** `dom-chunk-1/2/3-of-4-awaiting-rest` bằng nhau và không có `4-of-4` là hình dạng của **ráp THÀNH CÔNG** — mảnh cuối hoàn tất nên không ghi note. 774 lần bằng nhau = 774 lần ráp xong. SABA đói baseline vì `BASELINE_TIMEOUT`, không phải vì mất mảnh. Phần giữ lại: cửa xé set giờ tự khai tên nếu thật sự xảy ra. |

## CHƯA LÀM — chỉ còn thứ thật sự chặn

> **Cảnh báo cho chính mình:** phiên 2026-09-15 đã tự sinh thêm 9 mục từ việc đi
> đo. Đo xong thì không mục nào đáng làm. Đừng thêm mục vào đây vì vừa phát hiện
> ra nó — chỉ thêm khi đo được nó đáng bao nhiêu dòng ghép.

| # | Việc | Số đo được | Ai làm được |
|---|---|---|---|
| 14–16 | 0 lệnh đặt được | 61 phiên, **0 dùng được** | **Cần anh:** một lần đăng nhập FABET. `FABET_LOCAL_WARP_AUTH=1` là thứ đáng thử tiếp theo, **không phải bản vá chắc chắn** — lý do hỏng của từng egress đi ra console không đọc được |

## ĐÃ ĐÓNG — đo rồi, không đáng làm

| # | Việc | Vì sao đóng |
|---|---|---|
| 13 | CMD 26 trận thiếu More | ≈170 dòng (1%), và đường lấy không tồn tại |
| 16 | Đuôi 215 loại kèo | 11 ứng viên, **8 trùng khớp trận = 0**, 3 cái đã mở |
| 18 | `FT_GOAL_RANGE` 4 sàn 1.114 trận | Mỗi sàn chia khoảng khác nhau → khác sản phẩm |
| 23 | `OTHER_SCORE_DOMAIN_REQUIRED` | **0/805** APSPORT, **0/184** SBOBET có cửa vét |
| 24 | BTI `UNPAIRED_OR_INVALID` 2.466 | **144/144** trận đã có sẵn thang line |
| 25 | CMD `NATIVE_MR_ODDS_UNPROVEN` 1.260 | 1.058 đã phủ; **202** thiếu, toàn chẵn lẻ hiệp 1 |
| 26 | CMD `EVENT_NOT_COMPARABLE` | 130 họ kèo từ chối có chủ ý + 51 e-soccer; **0** giải góc bị mất |
| 27 | CMD `NATIVE_MARKET_HIDDEN` 2.031 | 1.378 đã phủ; **653** thiếu, 435 là chẵn lẻ. Và "hidden" = walk chưa tới, không phải lỗi |
| 28 | 190 tên gộp còn sót ở `cmd-more-native.ts` | **Tôi tự tạo ra mục này khi đi tách tên.** Không ai cần |

## CHẶN — không sửa được bằng mã

| # | Việc | Vì sao |
|---|---|---|
| 14 | **0 lệnh đặt được** | 61 phiên, **0 dùng được**. `ExecutionLegAdapter` chỉ có `dryRun`. |
| 15 | Gia hạn phiên FABET | Cần đăng nhập — tôi không làm. Và mọi egress đều hỏng: `FABET_AUTH_PROXY_URL` chưa đặt, `FABET_LOCAL_WARP_AUTH` chưa đặt (dù `warp-cli` đã cài). Một biến môi trường. |
| 16 | Chứng minh giá hiển thị đặt được | Hệ thống **chỉ đọc**. Giới hạn thiết kế, vĩnh viễn. |

## KHÔNG PHẢI CỦA TÔI

| # | Việc | Ghi chú |
|---|---|---|
| 17 | 9 test đỏ / 4 file (`replay-harness` ×6, `sbobet-*` ×3) | Stash mã của tôi chạy lại vẫn đỏ y hệt. Việc đang dở của phiên song song. |
| 18 | `wip/apsport-supplement-2026-09-14` (`3fbb508`), 4 nhánh `worker/*-hidden-20260907`, 2 worktree | Của phiên khác. Không gộp, không xoá. |

## TRẦN NHÀ CÁI — đã chứng minh, đừng đào lại

| Việc | Số |
|---|---|
| **Kèo góc: trận có góc ở ≥2 sàn** | **49** / 2.025. Không phải lỗi thu thập — SBOBET và CMD bỏ sót **0** kèo góc |
| CMD: trận ngoài 72h bị chính sách PASSIVE loại | **392** (cố ý) |
| SABA: More mở ra rỗng | 52/52 |
| SABA: giải góc trong feed | 0 |
| IM | Anh bảo bỏ |

---

## Điều đã nói sai trong phiên 2026-09-15, giữ lại để đừng lặp

- **"Lịch 03:00 bị xoá nhầm"** — sai, gỡ **có chủ ý**, lý do ghi ngay tại chỗ gọi.
- **"CMD walk đứng im"** — sai, `started:0` là ảnh chụp tức thời, `due:1`.
- **"16 chữ số thập phân = giá bịa"** — sai, 931/942 quote APSPORT đều vậy.
- **"Ô chứa quote của line khác"** — sai, `candidates=1`, line khớp hết.
- **"APSPORT live còn sàn khác prematch"** — sai, `rows split on phase: 0`.
- **"BTI dùng SSE nên bị bộ lọc XHR/Fetch bỏ qua"** — SAI. Sau khi đếm:
  `sse[]` rỗng, **0 tin nhắn**. Tab không phát mạng ở kênh nào cả.
- **"Gỡ service worker làm BTI gọi mạng trở lại"** — SAI, và là lỗi phép đo. So
  "0 request trước" với "28 sau" trong khi bộ theo dõi **mới bắt đầu ghi** và lần
  tải trang là do chính tôi `navigate`. Service worker đó là
  `imageCacheBustingWorker.js`, chỉ xử lý ảnh, không chạm API, `caches: []`.
- **"BTI là sàn duy nhất không có target con"** — SAI. Bộ đếm `targets[]` khi đó
  chỉ ghi cho KSPORT và SABA; CMD/APSPORT cũng rỗng mà vẫn chạy. Đọc một **chỗ
  trống** thành một **sự thật**, đúng lỗi đã mắc với `BTI_COV[none]` cùng ngày.
- **"BTI tối vì tab không còn là trang ứng dụng"** — SAI. Ảnh chụp cho thấy trang
  đang chạy, có kèo, không cần login. Đúng là: biểu thức refresh treo, không trả về.
- **Đổi tên lý do từ chối trong `saba-football-normalizer`** — phình phạm vi giữa
  lúc sửa BTI, làm đỏ 5 test không liên quan. Đã hoàn nguyên. Việc đó không dính
  gì tới lỗi đang sửa.
- **"197 trận CMD bị loại là e-soccer"** — sai tỉ lệ. E-soccer chỉ **51/191**;
  phần lớn (130) là họ kèo bị từ chối có chủ ý. Tách tên ra mới biết.
- **"SABA mất mảnh thứ 4 của ảnh chụp DOM, 511 lần"** — SAI. Ba bộ đếm bằng nhau
  và thiếu bộ thứ tư chính là dấu hiệu **ráp thành công**. Đã rút, sửa cả trong mã.
- **"215 loại kèo bị bỏ phí"** — đọc sai một phần: `FT_DOUBLE_CHANCE` đứng đầu bảng
  chỉ vì nó góp ô vào dòng `FT_1X2`, không sinh dòng mang tên nó.
- **"4 quote `HOME_AWAY` của APSPORT sai"** — sai quy mô. Là **nửa số trận đang đá**
  của APSPORT lệch sequence nội bộ; 4 quote chỉ là phần nhô lên trên mặt nước.
- **"SABA gấp 2,6 lần là nhờ bản vá"** — sai, do extension nạp lại, không phải mã tôi sửa.
- Không thấy log `[fabet-auth]` **không chứng minh được gì**: child stderr đi `stdio: "inherit"`, không vào file.
