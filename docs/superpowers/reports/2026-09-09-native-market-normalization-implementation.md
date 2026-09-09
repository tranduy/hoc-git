# Chuẩn hóa native market sáu sàn và sửa ghép — 2026-09-09

Đã sửa đường dữ liệu production của BTI, CMD, AP, SBO, SABA và IM, shared contracts và bộ ghép. Kết quả dưới đây phân biệt số bản ghi nguồn, hợp đồng kèo khác nhau, cặp sàn có cùng hợp đồng và cơ hội ROI dương. Đây không phải tuyên bố mọi loại native market đã được chuẩn hóa hoàn chỉnh.

## Một cấu trúc chung để ghép

Mỗi market đã hiểu nghĩa đi vào `ProviderMarket` và các `Quote`, giữ ID gốc của sàn để truy vết. Hợp đồng ghép gồm:

`trận đã đối chiếu + môn/biến thể + live/prematch + loại kèo + đối tượng đội/trận + hiệp + line + settlement + đủ cửa kết quả`

Tên gốc vẫn được giữ. Đối chiếu trận dùng tên đội/giải chuẩn hóa, giờ bắt đầu và các điều kiện phân biệt trận; không giả định có một ID trận chung cho sáu sàn. Khi đảo thứ tự đội, loại kèo đội nhà/khách và settlement tương ứng cũng phải đảo. FT/FH, bàn thắng/phạt góc, line và cách thanh toán khác nhau không được nhập chung.

Ví dụ thật mới ghép được trong replay: BTI `Bayern Munich / Union Berlin`, event `884501820318437376`, market `0OU884501824391098411:1.5` và IM `Bayern Munchen / FC Union Berlin`, event `113428428`, market `2522020894`. Cả hai trở thành `HOME_FH_TOTAL`, line `1.5`, settlement `football-home-goals-first-half`, đủ OVER/UNDER. ID selection gốc của cả hai sàn được giữ.

Các dòng chưa đủ bằng chứng về nghĩa vẫn giữ trong `NativeMarketObservation`, gồm selection, giá/format gốc và dòng gốc nếu có. Giữ được dữ liệu thô không có nghĩa nó đã trở thành hợp đồng đủ điều kiện ghép.

## Những lỗi đã sửa từ dữ liệu thật

| Sàn | Sửa trong đường dữ liệu production |
| --- | --- |
| BTI | Bổ sung tài/xỉu bàn thắng từng đội hiệp một, các mã Asian team total, cả hai hiệp và FT/FH 1X2. Dùng tên participant và outcome gốc để xác định phía đội; không đoán từ vị trí giá. |
| CMD | Đọc Odd/Even FT/FH từ slot Main thật và cập nhật giá delta tương ứng. Kiểm tra trùng Main/More bằng cùng hợp đồng. |
| AP | ID offer trước đây va chạm giữa các nhóm kèo; thêm group vào ID ở cả inventory lẫn canonical. Chuẩn hóa FT/FH 1X2 với đúng ba selection và giá Decimal. |
| SBO | Dùng enum của chính SBO và raw row để chuẩn hóa FT/FH 1X2; giữ các native row khác để đối chiếu tiếp. Sửa đường browser cũ thiếu nhãn giá Decimal. |
| SABA | Sửa scope theo mã/nhãn gốc, giữ giá native DOM/socket. Mã 12 là FH Odd/Even khi có nhãn cửa; mã 24 không được đoán là Odd/Even. |
| IM | Bổ sung FH team total, FT/FH 1X2 và both-halves total đọc từ specifier `total=...`; kiểm tra đủ cửa, line hai cửa tương đương. Sửa đọc format odds theo `ot` của từng selection. |

SABA dựa trên [BetType Selection Information của Saba-sports](https://github.com/Saba-sports/OddsDirectAPI/wiki/BetType-Selection-Information), không lấy mã của sàn khác gán sang. Mẫu SABA DOM đã lưu không có mã 12 cần bổ sung, nên replay SABA không được ghi nhận tăng canonical market.

**Lỗi giá IM ảnh hưởng trực tiếp tính ROI:** public client của IM định nghĩa `ot=2` là Hong Kong, `ot=3` là Euro/Decimal. Bộ đọc cũ coi giá dương là Hong Kong. Ví dụ Decimal `3.2 / 1.3` có thể bị diễn giải thành `4.2 / 2.3`. Bản sửa đọc format rõ ràng, chuyển Indo khi cần, xử lý American trong bộ ghép, giữ raw format để kiểm tra. Không dùng ROI từ replay cũ làm bằng chứng lợi nhuận.

Bằng chứng IM: `.run/im-odds-proof-2026-09-09/odds-type-proof.json`; saved public client `.run/parallel-hidden-markets-2026-09-08/im/main-9992f20.js`, SHA-256 `663ab38cea0f8bbb09292fa97710c2fe179a42a13fe374dba490af1134c8df8a`. Trong 66.318 native market của mẫu owner, 10.502 market dùng HK và 55.816 dùng Euro; nhiều market trong đó thuộc loại nhiều cửa chưa đủ điều kiện ghép hai cửa.

**Lỗi loại trùng làm mất cặp:** replay đầu tiên sau bổ sung normalizer làm số cặp production giảm 6.926→6.323. CMD Main tạo thêm 698 hợp đồng đã có ở More; BTI cũng có các offer tương đương. Matcher cũ gặp nhiều market ID từ một sàn thì loại tất cả. Đã sửa chọn nguyên một market có đủ cửa, cùng event/type/scope/line/settlement, ưu tiên độ mới của cửa cũ nhất rồi ID ổn định. Không ghép giá từ hai market khác nhau. Khác settlement hoặc chưa phân biệt được trận trùng vẫn bị chặn.

## Đo trước/sau trên cùng raw input của từng sàn

Mỗi sàn dùng đúng cùng file raw trước/sau. Các file giữa sáu sàn được thu ở những thời điểm khác nhau; AP là mẫu ngày 27/08, phần lớn mẫu khác ngày 08/09. Đây là phép đo thay đổi thuật toán, không phải ảnh chụp odds đồng thời và không chứng minh cơ hội có thể vào tiền.

| Sàn / mẫu raw chính | Canonical record trước | Sau | Tăng ròng |
| --- | ---: | ---: | ---: |
| BTI | 36.889 | 43.879 | 6.990 |
| CMD Main + More | 3.875 | 4.582 | 707 |
| AP probe | 237 | 347 | 110 |
| SBO Early | 3.959 | 4.712 | 753 |
| SABA DOM | 837 | 837 | 0 |
| IM owner | 16.161 | 19.442 | 3.281 |
| **Tổng** | **61.958** | **73.799** | **11.841** |

Sau khử trùng theo hợp đồng trong từng sàn: **60.532→71.497**, tăng **10.965 hợp đồng khác nhau**, gồm 6.170 hai cửa và 4.795 ba cửa. Riêng CMD +707 bản ghi chỉ tạo +9 hợp đồng mới; 698 còn lại trùng Main/More. Không đánh tráo hai số này.

| Phạm vi | Nhóm có từ hai sàn trước→sau | Cặp sàn trước→sau | Market nguồn tham gia trước→sau |
| --- | ---: | ---: | ---: |
| Production: hai cửa, line không hoàn tiền | 4.778→5.769 | **6.926→8.682** | 10.566→12.859 |
| Tất cả hai cửa, kể cả line nguyên/quarter — audit | 8.757→9.843 | **17.468→19.319** | 21.345→23.828 |
| Ba cửa hoàn chỉnh — audit | 0→1.072 | **0→2.174** | 0→2.695 |
| Tổng hợp đồng đủ đối chiếu — audit | 8.757→10.915 | **17.468→21.493** | 21.345→26.523 |

Không mất quan hệ ghép theo hợp đồng. Năm cặp đổi ID đại diện do chọn offer tương đương đã được đối chiếu riêng; không tính chúng là mất hợp đồng. UI/ranking production hiện vẫn là hai cửa không hoàn tiền; số ba cửa và line có hoàn tiền ở bảng là audit cấu trúc, chưa phải vé chiến lược production.

Một hợp đồng có `k` sàn đóng góp tạo `k × (k−1) / 2` cặp sàn: sáu sàn tạo 15 cặp. Với market hai cửa, mỗi cặp còn có hai cách phân cửa, chẳng hạn OVER sàn A/UNDER sàn B và ngược lại: 15 cặp tương ứng 30 cách phân cửa. Vì vậy 8.682 cặp hai cửa trong replay tương ứng 17.364 cách phân hai cửa trước các kiểm tra thực thi. Tổng cặp là cộng trên từng nhóm hợp đồng tương đương. Không lấy mọi market khác trận/khác hiệp/khác line nhân chéo với nhau. Số bản ghi nguồn, số nhóm, số cặp và số ROI dương là bốn đại lượng khác nhau.

Tái lập: `.run/six-provider-normalization-audit-2026-09-09/matching-agent/native-six-combined-replay.mjs`; kết quả `.json` cùng tên, schema validation, ma trận sàn và NDJSON ID cặp thêm/mất nằm cùng thư mục. Mười hai catalog before/after đều qua schema, không có lỗi.

## Phần chưa thể gọi là ghép hoàn chỉnh

Các họ correct score, exact total, double chance, kết hợp double chance/BTTS, khoảng bàn/phạt góc và một số prop chưa đi hết vào canonical settlement có thể so sánh. Không thể lấy hai cửa bất kỳ trong market nhiều cửa rồi gọi là hedge phủ hết kết quả.

AP đã phân loại được 31.312 dòng excluded cũ theo họ native; SBO đã xác định họ của 16.992 dòng unknown cũ bằng enum của chính SBO. Việc phân loại này giúp biết chính xác phần thiếu, nhưng không được cộng vào số market đã chuẩn hóa đầy đủ. Một số SABA DOM 1X2 có giá mà thiếu nhãn xác định HOME/DRAW/AWAY nên vẫn giữ native, không gán cửa theo phỏng đoán.

## Triển khai và kiểm chứng

Stack build sau handoff cuối: `sha256:140a0f3e6d09862afa933c8aad224741d931dd6ba83b4d48d78213ceafe41f5e`, instance `b55ce3c2-06f9-42ce-ad31-8758cb04108f`. Extension `0.2.110`, bundle `sha256:08208fe511c4f8970a705cf409272880a4da83a06025463ddb49d9c77350120f`. Web artifact `index-BMlMFuNk.js`. Dev: https://live.babiesbo.uk/football-live. Giữ riêng receipt của các build trung gian `30a52a...` (trước sửa projection) và `98dc75...` (trước sửa buffer App).

Để giữ đủ giá native phục vụ audit mà dashboard không phải tải phần thô lớn ở mỗi revision, thêm `nativeDetail=summary` chỉ bỏ `nativeSelections`/`nativeRow` trong response dashboard. Các event/market/quote, observation count, disposition, thời gian và freshness giữ nguyên. GET mặc định vẫn trả đủ native. Full/summary có ETag riêng, không sửa catalog trong bộ nhớ.

Các nhóm kiểm chứng đã qua: contracts 135, adapters 153; API integration 234; BTI 122; AP/SBO 393; IM 104; web comparison/worker/count/ranking 189; API route 25; catalog client 19. Có phần giao nhau giữa các nhóm, không cộng thành số test duy nhất. Typecheck/build contracts, adapters, API và web qua; review độc lập normalizer, odds, duplicate policy và transport qua.

Sau deploy lần đầu, public từng trả 200 rồi origin dừng. Phát hiện launcher chỉ cho cấu hình heap tối đa 1.024 MB: giá trị 2.048 bị âm thầm đưa về mặc định 512 MB. Đã sửa giới hạn chấp nhận đến 4.096 MB; regression 2.048/4.096 thất bại trước sửa, cả sáu test launcher qua sau sửa. Khởi động managed launcher có log lúc 13:20:51, kiểm tra tiến trình API thực sự có `--max-old-space-size=2048`. Log lần chết trước bị bỏ bởi launcher cũ, nên không tuyên bố đã có stack trace chứng minh nguyên nhân kết thúc lần đó.

## Ảnh chụp trung gian, 13:13:15–13:13:25 — trước sửa projection extension IM

**Phát hiện sau audit:** `apps/chrome-extension/src/im-catalog-refresh.ts` bỏ `ot` và `s` khi tạo `compactMarket`. Vì vậy bản sửa API không nhận được format/specifier của dữ liệu live. Điều này giải thích tại sao ảnh chụp IM vẫn có toàn quote MALAY/native HK dù replay raw có Euro. Đã sửa projection, triển khai extension 0.2.110 và kiểm tra toàn tuyến; ảnh 13:13 không được dùng làm bằng chứng đã sửa đúng odds IM live.

| Sàn | Freshness lúc lấy | Canonical market | Native observations | Native chưa mapping |
| --- | --- | ---: | ---: | ---: |
| BTI | FRESH | 16.031 | 22.325 | 3.916 |
| CMD | FRESH | 4.131 | 15.319 | 1.697 |
| AP | FRESH | 16.401 | 58.967 | 0 |
| SBO | **STALE, cache cũ** | 17.168 | 66.253 | 36.890 |
| SABA | FRESH | 803 | 1.086 | 1 |
| IM | FRESH | 12.141 | 49.163 | 564 |
| **Tổng** | | **66.675** | **213.113** | **43.068** |

213.113 native observation = 67.425 NORMALIZED + 102.620 EXCLUDED + 43.068 UNMAPPED. Native observation không có quan hệ một-một với canonical record; nhiều dòng nguồn có thể trỏ cùng market nên không dùng 67.425 thay cho 66.675. Có 138.638 quotes. Mỗi event/market/quote/native observation được kiểm tra qua parser thật; cả sáu catalog hợp lệ, không có quote mồ côi/sai phase/type/line.

Trên ảnh chụp này, cùng bộ ghép production hai cửa không hoàn tiền: cả sáu nguồn nếu chỉ đối chiếu cấu trúc có 9.526 nhóm / **18.757 cặp** / 22.842 market nguồn. Chỉ năm nguồn được đánh dấu FRESH tại thời điểm chụp có 2.938 nhóm / **6.145 cặp** / 7.275 market nguồn; bộ đếm cho **0 nhóm ROI ước tính dương**. Kết quả ROI này dùng giá IM đã mất format ở extension, nên không được coi là kết luận sau sửa giá. Không dùng odds SBO stale để báo cơ hội live. Các con số này không được so với replay cũ để suy ra tăng/giảm do code, vì input khác nhau và các collector đang nạp lại sau restart.

Đã xuất **66.675 dòng chung** vào `.run/native-normalization-2026-09-09/common-markets-live.ndjson` (80.502.945 bytes, SHA-256 `9cb1077176e8927148db16b0a009756f7a4dcdb50c750318c31a2d65b359a4e4`). Mỗi dòng có native ID/tên đội/giờ đấu, hợp đồng chuẩn hóa, các cửa/giá/format gốc và Decimal, freshness/thời gian gốc; đánh dấu `HISTORICAL_SNAPSHOT_NOT_CURRENT`. Script tái lập và số liệu chi tiết: `live-capture-audit.mjs/.json/.md` cùng thư mục.

Backlog có mã/nhãn/hiệp, số lượng và ví dụ event/market/outcome/giá thực: `.run/native-normalization-2026-09-09/remaining-mapping-backlog.md/.json`. Tách 6.178 UNMAPPED của năm nguồn được đánh dấu Fresh và 36.890 của cache SBO stale. Không coi AP zero UNMAPPED là phủ đủ: còn 33.434 dòng EXCLUDED với `CANONICAL_EQUIVALENCE_NOT_PROVEN` trong ảnh này.

Lượt màn hình trung gian 13:28–13:30 hiện 8.875 cặp, 0 ROI dương và banner timeout; nhiều nguồn chuyển stale. Không coi lượt đó là nghiệm thu thành công. Kiểm tra này chặn automatic dashboard writes, nên các yêu cầu phục hồi UI không được chạy; các request đọc catalog vẫn hoàn thành.

## Sửa xuyên extension→API và loại kết quả stale ngay

Projection IM mới giữ `ot` nguyên mã số và `s` nguyên chuỗi tối đa 512 ký tự; mã sai rõ ràng giữ dấu invalid để API từ chối, không biến thành “thiếu format” rồi dùng fallback. Fixture native thật 157 market/680 selection đi qua expression thực rồi API: 51 canonical market/104 quotes, cả 44 quote Euro được giữ đúng Decimal; both-halves có line1.5. Ví dụ raw Chelsea `3.2 / 1.3` vẫn là Decimal `3.2 / 1.3`. Bộ kiểm chứng extension 399 tests và typecheck qua, review độc lập qua.

Replay toàn bộ 66.318 IM raw market với **cùng API mới**, chỉ thay projection cũ/mới: **18.612→19.442 canonical market**, 38.313→39.973 quotes. Có đúng **830 hợp đồng mới** (415 both-halves OVER và 415 UNDER), không mất hợp đồng/quote cũ. **18.657 quote chung được sửa giá Decimal đã tính sai**; 19.656 quote khác chỉ đổi biểu diễn MALAY→HK, giá Decimal không đổi. 830 này đã nằm trong phần tăng IM ở bảng replay normalizer, không cộng lần nữa. Bằng chứng: `.run/im-odds-proof-2026-09-09/im-full-projection-replay.json` và `projected-normalization-proof.json`.

Lỗi stale được tái hiện bằng bốn regression: nhận `CATALOG_REVISION(STALE)`/baseline STALE mà thẻ ROI dương còn giữ; body FRESH cũ về muộn có thể khôi phục dữ liệu đã stale. Coordinator nay báo invalidation ngay cho UI, không chờ tải body. UI loại nguồn khỏi counts/ranking/detail/preflight ngay và giữ mốc observedAt để body cũ không phục hồi nó; cặp giữa hai sàn còn Fresh vẫn tồn tại. 147 tests liên quan qua, bốn skip có sẵn, web typecheck/build qua; review độc lập qua. Không nới freshness hoặc điều kiện ghép. Chi tiết: `.run/native-normalization-2026-09-09/stale-metadata-fix.md`.

Sau handoff cuối, HTTP public/local 200 cùng build và HTML hash; public WebSocket nhận SNAPSHOT. API PID16360 thực chạy heap2048. Nghiệm thu raw format thực nhận và UI cuối được ghi riêng dưới đây.

## Dữ liệu thực nhận sau sửa extension, 13:40:32–13:40:39

Worker đã đổi từ `956c53f0-69f1-408c-98d2-65462f0bc307` sang `46607732-1154-47b7-ab3e-837df39bd42e`; IM FRESH trước khi lấy ảnh chụp. Cả sáu GET trả200. Tổng **182.216 native observation, 63.769 canonical market, 133.984 quotes**. Native disposition: 64.526 NORMALIZED, 105.243 EXCLUDED, 12.447 UNMAPPED. Các bộ thu đang nạp thêm/thay baseline; khác snapshot13:13 nên không dùng chênh lệch tổng market giữa hai lần để đo tác dụng thuật toán.

| Sàn | Snapshot state | Canonical market | Native observation | UNMAPPED |
| --- | --- | ---: | ---: | ---: |
| BTI | FRESH | 21.169 | 37.832 | 10.043 |
| CMD | FRESH | 4.136 | 15.586 | 1.786 |
| AP | FRESH | 16.488 | 59.414 | 0 |
| SBO | STALE | 9.055 | 19.175 | 0 |
| SABA | FRESH | 656 | 1.930 | 47 |
| IM | FRESH | 12.265 | 48.279 | 571 |

**Bằng chứng giá IM đã qua luồng live:** 22.022 quote HK và 3.762 quote DECIMAL; raw inventory giữ 54.346 selection HK và 167.750 selection DECIMAL. Trước sửa projection tất cả bị gán HK ở inventory/MALAY ở canonical. Snapshot này chưa có canonical both-halves IM; chỉ replay raw owner đã chứng minh họ đó, không quảng cáo là đã nhận được live.

Ghép production theo cùng ảnh: năm nguồn FRESH có **3.389 nhóm, 7.423 cặp sàn, 8.518 market nguồn tham gia**. Bộ đếm float ban đầu ghi một nhóm dương, nhưng kiểm tra phân số chính xác cho thấy đó là ROI0 bị sai số `2.22e-16`, không phải lợi nhuận thật. Nếu cho cả cache SBO stale vào phép đối chiếu cấu trúc thì có 4.544 nhóm/12.271 cặp/12.152 market nguồn; phần stale không được báo là cơ hội live. Cả sáu catalog qua schema và kiểm tra reference, không có lỗi.

File cấu trúc chung đã cập nhật riêng: `.run/native-normalization-2026-09-09/final-audit/common-markets-live.ndjson`, **63.769 dòng**, SHA-256 `77a6f4b14f8ac8d83bfd9fcb1512e4e1b97ce7f9d20aef696ae39d58e23ccbab`. Audit, ma trận ghép, format trước/sau và backlog có nhãn/mã/ví dụ thật nằm trong `final-audit/`. Bằng chứng worker: `worker-freshness-proof.json` trong thư mục task.

Lượt UI13:41–13:42 hiển thị một vé Hungary/Ukraine, SBO+BTI FT_TOTAL2.5, Decimal1.87/2.17647, ROI ước tính0,58%. Tuy nhiên kiểm tra vẫn bắt được thẻ IM còn lại sau thông báo IM STALE. Trace thực tế cho thấy App chỉ giữ một revision nên React batching làm mất thông báo của các sàn khác. Đã sửa App giữ tối đa hai entry mỗi account: entry mới nhất và entry STALE có observedAt cao nhất; tie-break bằng sequence, xóa buffer khi baseline/disconnect, page xử lý theo sequence. Regression callback thật của App tái hiện mất cập nhật giữa các sàn và STALE→FRESH trong cùng batch, kể cả hai STALE có observedAt giảm; 157 tests liên quan qua, bốn skip cũ, typecheck/build và review độc lập qua. Không dùng tổng12.560cặp của lượt lỗi trước buffer làm số cặp Fresh đã nghiệm thu.

## Vì sao số xử lý lớn nhưng số cặp nhỏ hơn nhiều

Phân rã bằng đúng gate production trên **cùng ảnh chụp13:40**, chỉ năm sàn FRESH:

| Gate, không đếm trùng | Market nguồn |
| --- | ---: |
| Line nguyên có thể hoàn tiền, ngoài ranking hiện tại | 7.664 |
| Line quarter có thể hoàn/ăn thua nửa, ngoài ranking hiện tại | 16.150 |
| Market ba cửa, ngoài ranking hai cửa | 5.276 |
| Market đóng/treo | 144 |
| Thiếu/thừa quote để đủ cặp cửa | 4 |
| **Hai cửa OPEN đầy đủ, line không hoàn tiền** | **25.476** |
| **Tổng canonical của năm sàn Fresh** | **54.714** |

Trong25.476 market đủ gate, **8.518 tham gia ghép**. 16.958 còn lại:

| Nguyên nhân theo bộ ghép thực | Market nguồn |
| --- | ---: |
| Đã ghép trận nhưng không có sàn thứ hai cùng type/scope/line | 11.094 |
| Chưa có ứng viên trận được chấp nhận trong cùng nhóm loại kèo | 5.113 |
| Có nhiều ứng viên trận | 336 |
| Nhiều contract/receipt trong chính nguồn chưa phân biệt được | 290 |
| Offer tương đương đã được đại diện bởi market khác | 58 |
| Sàn kia cùng line nhưng contract còn mơ hồ | 39 |
| ID trận nguồn còn mơ hồ | 27 |
| Sàn kia cùng line nhưng thiếu/đóng/invalid quote | 1 |

Không gọi5.113 là “thật sự không có trận bên sàn kia”: đó là kết quả gate hiện tại, vẫn có thể còn tên/giải/giờ/biến thể cần đối chiếu. Số11.094 chỉ ra nút thắt lớn hơn đang là độ phủ **cùng loại kèo/hiệp/line**, không chỉ tên đội. Các assertion kiểm tra tổng loại trừ, gate `isFocusedTwoWayTicket`, số nhóm/cặp/source đều khớp production; không có phần dư bị gán nguyên nhân tùy tiện. Chi tiết và ví dụ: `final-audit/same-snapshot-funnel.json/.md`.

Đã duyệt **14.846 cách phân hai cửa = 7.423 cặp × 2 hướng**, tính dấu ROI bằng phân số từ giá/format gốc: **0 dương, 1 bằng0, 14.845 âm**; không có format không xử lý được. Không có lựa chọn dương bị bỏ sót trong1.805 nhóm có giá tốt nhất hai cửa cùng một sàn. Trường hợp float tưởng dương là Lausanne/Servette SH_TOTAL1.5: Decimal `199/100` và `199/99`, nên nghịch đảo `100/199 + 99/199 = 1` chính xác. Đây là sai số của bộ đếm float, không phải cơ hội lợi nhuận. Kiểm tra toàn bộ hướng cược này giải thích vì sao số cặp nhiều không tự tạo thêm kèo dương trên ảnh đó; khác thời điểm và thêm nguồn Fresh có thể đổi kết quả.

## Nghiệm thu UI sau sửa buffer App

Lượt60giây khoảng13:55 trả HTTP200, đủ sáu sàn tải và chọn, metadata mới nhất đều FRESH. Mẫu DOM60giây: **3.339 nhóm / 9.804 cặp / 9.219 market nguồn**,20thẻ. Snapshot màn hình sau đó tiếp tục cập nhật thành3.550/10.157/9.703; không lấy hai thời điểm này để tính hiệu quả sửa code.

Một vé ước tính dương: Hungary/Ukraine FT_TOTAL2.5, **BTI UNDER Malay0.87→Decimal1.87**, **SBO OVER Malay−0.85→Decimal2.17647**, ROI0,58%. Native BTI event847398624844636160/market0OU847398625981276162:2.5; SBO event5729460/market17792271931025. Đây là số quan sát sau khi SBO Fresh, khác ảnh raw13:40 có SBO stale. Không chạy đặt cược/preflight; không khẳng định lợi nhuận thực thi.

Không có lỗi JavaScript hoặc catalog request thất bại trong lượt này; mọi catalogGET dùng summary. Headers452–3.792ms, các transfer hoàn thành913–17.656ms. Không xuất hiện chuyển FRESH→STALE tự nhiên trong cửa sổ này, nên không nói đã quan sát trực tiếp việc biến mất trên live; các regression App callback burst/page/worker đã kiểm chứng hành vi đó. Browser đóng trong finally.

Metadata `/api/catalog/sources` còn hai lần bị timeout do client chỉ chờ2.500ms, dù các response quan sát được là200 và có header tới3.613ms. Đã chỉnh riêng default metadata thành10.000ms, giữ AbortController/freshness/recovery;36 tests cũ liên quan và typecheck qua. Web build mới `index-CTYu2li3.js`, Vite phục vụ trực tiếp; **không restartAPI/extension** cho chỉnh frontend này. Vì vậy startup identity140a0f... của API mô tả lần khởi động trước thay đổi deadline; web artifact cuối được ghi riêng, không gọi đó là combined build mới. Public sourceGET xác nhận compiled default `timeoutMs = 1e4`.

Chi tiết: `.run/native-normalization-2026-09-09/app-buffer-final-acceptance.md` và `source-metadata-timeout-fix.md`; kết quả metadata cuối được ghi riêng sau quan sát30giây.

**Kết quả kiểm tra frontend cuối,14:00:20–14:00:54:** 23/23 request metadata hoàn thành200, tối đa5.098ms, không timeout banner hoặc lỗi JavaScript; không có catalog request thất bại được ghi nhận. API vẫn PID16360, không restart. IM chuyển FRESH→STALE lúc14:00:32.560; kiểm tra sau269ms có **0 thẻ IM** và nguồnIM hiển thị Outdated/disabled. Đây là bằng chứng live bổ sung cho các regression buffer/invalidation.

Lượt30giây này kết thúc với3.043nhóm/4.166cặp/6.627market nguồn,0vé dương; IMstale và catalogBTI ban đầu còn đang tải. Không coi lượt đọc metadata ngắn này là nghiệm thu đủ sáu sàn hoặc dùng nó làm chênh lệch thuật toán so với9.804cặp lúc13:55. Browser đã đóng. Lease deployment đã trả; coordinator không còn deployment/edit/acceptance đang giữ. [Chi tiết trong artifact](../../../.run/native-normalization-2026-09-09/source-metadata-final-acceptance.md).
