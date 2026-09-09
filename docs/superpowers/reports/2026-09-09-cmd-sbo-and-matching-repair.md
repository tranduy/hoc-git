# CMD/SBO và đối chiếu ghép kèo ngày 09-09-2026

## Trạng thái

Bản sửa mới nhất đã triển khai local lúc **19:09 ngày 09-09-2026**: ghi nhận FULL CMD ngoài cửa sổ recovery, nhận kết quả worker hợp lệ khi có update đang chờ, và xử lý sự kiện hiệp phụ/luân lưu bị gắn nhãn 90 phút. Web đã có giải thích lợi nhuận của kèo có trường hợp hoàn tiền. Chưa xác nhận cả sáu feed ổn định hoặc chuẩn hóa toàn bộ market.

- Local: http://127.0.0.1:4311/football-live
- Public: https://live.babiesbo.uk/football-live
- Managed instance: `b14d767a-c6c5-4650-a156-1af9eda9c7c7`, API PID `27008`.
- Build: `sha256:f357129d385fecfd1f75a92b9938924c99d778a907506866aa1832f3d850c6ac`.
- Extension 0.2.115: `sha256:c81f74729a2c8122efa554a86311f2f2ce7a1bd82468086fcb1b0dcaed013fa6`.
- Web: `index-DlhYFTHc.js`, `index-p5BiG1xv.css`; worker so sánh `comparison.worker-S9JXkttS.js`. Deployment lease đã trả.

Hai lần kiểm tra trước đã bắt được lỗi tái phát và **không đạt**. Bản thứ hai có CMD mới trong hơn sáu phút rồi mất cập nhật, SBO có khoảng trễ 33–52 giây. Không coi cửa sổ đầu đạt là kết quả cuối.

## Lỗi đã tái hiện và sửa

1. Registry thu hồi nguồn hết hạn đã khóa cả tài khoản trên socket còn sống. Nguồn có epoch mới hợp lệ nay được làm candidate; chỉ baseline được chứng minh mới trở thành active. Socket đóng thật và epoch cũ vẫn bị chặn.
2. Khi candidate trở thành active, assembler cũ bị hủy làm mất các đoạn đầu của response đang nhận dở. Chuyển quyền sở hữu assembler nay giữ nguyên đoạn chờ, hạn hết thời gian, giới hạn byte và cơ chế rollback.
3. Một lệnh kiểm tra frame của Chrome không có timeout có thể giữ đầu hàng đợi gửi CMD/IM mãi, kể cả sau thay epoch. Nay dùng hạn 2,5 giây sẵn có và từ chối dữ liệu không kiểm chứng được. Nếu đã gửi một phần body rồi mất đoạn tiếp theo, dừng body và yêu cầu phục hồi đúng nguồn; không báo baseline thành công.
4. SBO dùng lỗi cục bộ của replay/Detail/More/Early để tạm ngừng cả luồng Main. Đã tách lỗi cục bộ khỏi tạm ngừng chung; phản hồi HTTP từ chối thật vẫn được giữ nguyên backoff. Đường native đang lấy được dữ liệu tiếp tục được dùng, tránh thử lại replay chậm sau mỗi 30 giây.
5. Khóa quote chỉ bằng market ID làm các trận của AP ghi đè nhau. Khóa nay gồm event ID và market ID.
6. Nhóm tên trận không có tính bắc cầu có thể làm mất một quan hệ đối ứng hợp lệ khi thêm sàn thứ ba. Bổ sung các quan hệ trực tiếp được chứng minh, giữ kiểm tra giải, đội, thời gian, chiều sân, loại kèo và tính duy nhất; không suy diễn thêm quan hệ chưa khớp.
7. ROI hòa vốn không còn màu dương hoặc tạo cảnh báo dương. Dấu lợi nhuận lấy từ worst-case Decimal, không từ phần trăm đã làm tròn. Lợi nhuận âm nhỏ không bị làm tròn thành hòa vốn. Bell thể hiện lịch sử cảnh báo, không phải số kèo dương hiện tại.

Lỗi Chrome không trả lời đầu tiên trong lần chạy CMD chưa được quan sát ở mức stack trực tiếp. Kiểm thử đã chứng minh và sửa đường khiến lỗi đó biến thành khóa hàng đợi vĩnh viễn; không khẳng định nguyên nhân ban đầu là mạng hoặc lệnh đồng bộ. Bản JS CMD đã lưu chứng minh `callWebService(..., false, 7500)` dùng HTTP bất đồng bộ; tham số `false` chọn Content-Type.

8. CMD nhận FULL ở cursor 100, sau đó delta nâng cursor lên 101. Khi có FULL mới thật ở 101, adapter cũ từ chối vì cursor của FULL trước khác 101. Nay nhận FULL có request mới hơn, cùng document/session và đúng cursor hiện tại; vẫn chặn cursor cũ, request trùng, replay và baseline không đầy đủ. Bốn hồi quy đã RED trước sửa và GREEN sau sửa, bao gồm data-plane hết hạn baseline rồi trở lại LIVE mà không đổi thời điểm quote More giữ lại.
9. SBO không còn dùng lại lỗi HTTP cũ để tăng backoff ở NATIVE_COMPLETION. Chỉ HTTP 400–599 thực tế từ request còn đúng owner mới có thể tạm ngừng luồng chung. Timeout/lỗi nội bộ vẫn có hạn thử lại riêng và giữ giới hạn request đang chạy; native đang thành công tiếp tục cập nhật Main. Đã kiểm tra cả request bị thay document/worker trong khi chờ, và trường hợp isolated world hợp lệ.
10. Kèo có lãi ở mọi kết quả phân thắng thua nhưng hoàn cả hai cược ở một kết quả nay có ghi chú **“ROI khi không hoàn tiền”** và lợi nhuận khi hoàn bằng 0. Worst-case ROI vẫn bằng 0; kèo hòa vốn thật không có ghi chú này. Không thay phép tính tiền, thứ tự xếp hạng hay ngưỡng cảnh báo 5%.

## Số liệu trên cùng dữ liệu đầu vào

Snapshot được lưu tuần tự lúc **17:39:28–17:39:33**, tính ghép lúc **17:39:35** (UTC+7). Đây là dữ liệu tại thời điểm lưu, không phải sáu nguồn đồng bộ và ổn định.

| Sàn | Bản ghi market gốc | Market chuẩn hóa thực tế | Bản ghi chưa mapping |
|---|---:|---:|---:|
| BTI | 107.928 | 48.958 | 35.456 |
| CMD | 28.615 | 7.682 | 7.967 |
| AP | 59.144 | 17.862 | 41.282 |
| SBO | 25.350 | 10.635 | 14.454 |
| SABA | 1.216 | 880 | 24 |
| IM | 43.935 | 15.124 | 0 |
| Tổng | **266.188** | **101.141** | **99.183** |

Có 101.833 bản ghi gốc mang disposition NORMALIZED, 65.172 EXCLUDED, 99.183 UNMAPPED, cộng đúng 266.188. Số market canonical nhỏ hơn số bản ghi NORMALIZED 692 do IM có bản ghi trùng sau canonicalization. Vì vậy không dùng các đơn vị này thay thế nhau.

Trên **cùng 101.141 market canonical và 219.806 quote**:

- Matcher trước sửa: 64.459 cặp market, 144.533 đường ghép lựa chọn đối ứng.
- Matcher sau sửa: **66.138 cặp market, 148.291 đường ghép đối ứng**.
- Tăng **1.679 cặp** và **3.758 đường ghép**, không mất cặp/đường ghép cũ.

Một cặp market có hai market nguồn ở hai sàn và có lựa chọn đối ứng hợp lệ; một đường ghép xác định thêm hai selection ID cụ thể. Nhiều đường ghép có thể nằm trong cùng cặp market. Số cặp không lấy số market nhân chéo bất kể trận, loại kèo hoặc kết quả thanh toán.

Ví dụ một nhóm cùng trận, kỳ đấu, loại kèo, line và settlement có đúng một market ở mỗi sàn: sáu sàn tạo **15 cặp sàn**, tối đa **30 đường ghép hai chiều** khi đủ hai cửa mở ở mỗi market. Nếu một sàn có nhiều market nguồn tương đương, số cặp của nhóm là tổng `n_i × n_j` cho từng cặp sàn khác nhau. Đây là tăng theo tổ hợp trong từng nhóm tương đương; không nhân chéo toàn bộ inventory của những trận/line khác nhau.

Trong snapshot này CMD stale nên không tham gia phép tính có lọc freshness. AP có snapshot trên đĩa trễ 20,819 giây, vượt hạn quote prematch 15 giây của production nên các chân AP bị bộ tính loại ở thời điểm tính. Không tăng ngưỡng hoặc làm mới thời gian của quote cũ.

Phần còn đủ điều kiện tại thời điểm tính có **21.526 cặp, 48.032 đường ghép, 15.077 nhóm kèo**. Mức cược cơ bản 500.000 VND là tiền chân thứ nhất, không phải tổng hai chân. Production ranker có **3 nhóm dương ở trường hợp xấu nhất, 2 nhóm có lãi khi không hoàn tiền, 1 nhóm hòa vốn thật và 15.071 nhóm âm**. Có thêm 5.588 phương án không tính được; đây là đơn vị phương án, không cộng vào số nhóm. Ba nhóm dương là Hungary/Ukraine total 2,5 và 2,25, Torino/Roma total 2,75. Đã xét chia kèo phần tư và hoàn tiền; chưa xác minh khả năng đặt thực tế.

Hai nhóm có trường hợp hoàn cả hai cược là Fernando de la Mora / Deportivo Capiata FH_AH 0 (BTI/SABA, ROI tối thiểu khi không hoàn **1,236188%**) và England / Spain FH_TOTAL 1 (BTI/SBO, **0,282180%**). ROI xấu nhất của cả hai vẫn là 0. Lausanne / Servette SH_TOTAL 1,5 IM/BTI có lợi nhuận đúng 0 ở cả hai kết quả: đây là hòa vốn thật. Giá Malay BTI quy đổi là 2,010101…; số 2,0101 trên màn hình đã làm tròn. Các số này thuộc snapshot 17:39, không phải xác nhận kèo còn tồn tại lúc đọc báo cáo.

Chưa mapping không có nghĩa là bỏ bản ghi gốc. Dữ liệu và lý do vẫn được giữ để điều tra; nhiều nhóm còn là tỷ số chính xác, khoảng bàn thắng/phạt góc, kết hợp nhiều điều kiện hoặc native enum chưa đủ bằng chứng. Chưa đạt chuẩn hóa toàn bộ, và SABA hiện chỉ có một phần roster qua DOM.

Chi tiết 99.183 UNMAPPED: 44.476 chưa chứng minh hợp đồng tương đương, 43.465 native type chưa có mapping, 10.642 cấu trúc nhiều kết quả và 600 nhóm có hoàn tiền chưa mapping. Đây là phân loại trước bước ghép trận, không phải 99.183 lỗi alias tên đội. Ví dụ 27.962 bản ghi tỷ số chính xác và 8.025 bản ghi nhóm số bàn cần tập kết quả đối ứng đúng. Trong 65.172 EXCLUDED có 26.686 bản ghi ở event không vào inventory so sánh, 17.163 bị chặn bởi miền kết quả, 10.547 selection chưa dùng/không hợp lệ, 3.465 shape hai cửa không hợp lệ và 2.868 chưa xác nhận odds format. Bảng lý do cộng đúng mẫu số nằm trong `current-audit-20260909-1746/unmapped-breakdown.md`; không gọi tất cả các nhóm này là không thể hỗ trợ.

## Kiểm tra và bằng chứng

- 506 kiểm thử web và typecheck đã qua (4 test có sẵn được skip); các ca mới kiểm tra mất quan hệ ghép, ID trùng, ROI hòa vốn và settlement.
- 174 kiểm thử API liên quan assembler/registry/authority/telemetry đã qua; chuyển assembler được review độc lập.
- Extension: 174 kiểm thử tập trung của bản SBO cuối cùng đã qua, có typecheck và review độc lập; bao gồm các đường timeout, HTTP thật, native fallback và owner thay trong lúc chờ. Bản hàng đợi CMD/IM có 18 kiểm thử tập trung, ba ca RED→GREEN và review độc lập. Không cộng các bộ kiểm thử chồng nhau thành số kiểm thử riêng biệt.
- CMD FULL sau delta: 54 kiểm thử tập trung và API typecheck/build qua. Reviewer chạy độc lập cả bốn hồi quy mới đều qua, xác nhận các chốt chống replay và giữ thời điểm More còn nguyên.
- Ghi chú ROI có hoàn tiền: 220 kiểm thử web liên quan qua, 4 ca skip có sẵn; sau điều chỉnh typing, 140 kiểm thử của phạm vi thay đổi và typecheck qua. Web build và kiểm tra diff qua.
- Browser lúc 17:40–17:43: không page error/crash, đỉnh private memory 1.873 MiB, đỉnh JS heap 736 MiB, sau GC 350 MiB. Đây là phép đo ba phút, không phải cam kết chạy dài hạn.

Bằng chứng nằm trong `.run/cmd-sbo-live-fix-2026-09-09/`: `current-audit-20260909-1746/audit.json`, `manifest.json`, canonical gzip và hashes, `positive-observed-plans.ndjson`, `source-relations-replay.json`, `cmd-forwarding-deadlock-proof.json`, `candidate-body-rotation-fixed-proof.json`, `sbo-fix-review.md`, `dashboard-memory-mature.json`.

Các lần chạy cũ giữ tại `feeds-repaired.jsonl` và `feeds-current.jsonl`. Lần phục hồi SBO duy nhất trả HTTP 500 / BASELINE_TIMEOUT lúc 18:07:42, nên không được báo là thành công theo response; dữ liệu thực tế sau đó chứng minh SBO có baseline mới lúc 18:08:36, quote đổi thật và assembler không bị chặn. Cửa sổ 18:08:43–18:10:38 có SBO 24/24 mẫu LIVE/ACTIVE/FRESH; CMD chỉ 18/24 và là lý do tiếp tục sửa cursor FULL ở trên.

Kiểm tra bản triển khai cuối được lưu ở `feeds-deployed.jsonl` và `dashboard-memory-post-fix.json`. Lần đọc đầu 18:31:24 có CMD/SBO FRESH với quote mới; IM còn stale. Không suy từ trạng thái khởi động này ra độ ổn định dài hạn. Lệnh reload dashboard của Chrome người dùng dừng đúng chốt DASHBOARD_NOT_SELECTED vì người dùng đang chọn trang khác; không thao tác vào trang đó. Trình duyệt kiểm tra riêng truy cập bản local mới.

**Kết quả thực tế 18:31–18:33 vẫn chưa đạt:** CMD ngừng có evidence mới rồi stale trong cửa sổ kiểm tra; IM stale và BTI cũng stale ở mẫu trình duyệt cuối. SBO tiếp tục có quote và baseline mới. Bản sửa cursor được chứng minh bằng hồi quy nhưng chưa giải quyết hết liveness CMD. Chỉ số CMD_NATIVE trong heartbeat là snapshot diagnostic lần trước, không phải số request đang chạy đo trực tiếp; không dùng chuỗi active1 lặp lại để kết luận một request đang treo. Đọc độc lập 18:35:57 thấy CMD tự đổi tab/epoch và phục hồi, baseline mới `cmd:11083009:observation:22022`; việc phục hồi này không xóa thất bại trước đó.

Browser 18:31:25–18:33:26 tải đúng bundle mới, 42 catalog transfer HTTP 200, không page error/crash; private memory đỉnh 2.227 MiB, JS heap đỉnh 829 MiB, sau GC 173 MiB. Ghi chú ROI có hoàn tiền xuất hiện thật trên các card (0,26%, 0,53%, 0,28%). Có 2 card dương ở hai mẫu đầu, 0 ở ba mẫu sau khi nguồn/giá thay đổi. Đây là phép đo hai phút, không chứng minh đã hết vấn đề bộ nhớ dài hạn.

Đã sửa cơ chế worker: trước đây chỉ nhận kết quả nếu generation hoàn thành bằng generation mới nhất, nên update đến giữa phép tính làm bỏ kết quả vừa tính. Ca liên tục bốn update có **0 → 4 kết quả được nhận**. Nay chỉ giữ một snapshot đầu vào đang tính, đối chiếu roster và điều kiện/giá/identity với dữ liệu mới, giữ clock gốc; loại cell đã đổi nhưng giữ cặp khác còn hợp lệ. Reset/remove/stale, đổi trận/miền market, lùi clock/generation và vượt ranh giới hiệu chỉnh kỳ đấu đều chặn kết quả cũ. Kết quả trung gian xóa bằng chứng preflight cũ và không chạy preflight mới. Worker chết hẳn sẽ dừng nhận job và giải phóng snapshot. Trace thực tế có lượt 1,5–3 giây bị bỏ xen kẽ lượt được nhận; chưa chứng minh starvation vĩnh viễn trong lần trace đó. 39 kiểm thử tập trung cuối, page suite 92 pass/4 skip có sẵn, typecheck/diff/build và review độc lập qua; không cộng các suite chồng nhau.

Follow-up CMD đã triển khai trong bản 19:09: `cmdFullBaselineAtMs` trước đây chỉ cập nhật khi FULL khớp token recovery còn hoạt động trong 10 giây. Reproducer dùng NetworkObserver và CmdPageKeepalive thật chứng minh FULL native ngoài cửa sổ, hoặc FULL hoàn thành sau deadline, vẫn được forward nhưng không được keepalive ghi nhận; mỗi ca tạo một reload thừa. Sau sửa, cùng đầu vào vẫn forward đúng một FULL, ghi nhận thời điểm nhận gốc và reload thừa **1 → 0**. Chỉ body full-scope hoàn chỉnh, current owner/document/epoch và mọi fragment gửi thành công mới ghi nhận; replay không được làm mới. Recovery SUCCESS không ghi đè clock đó. 78 kiểm thử liên quan/typecheck/diff check qua, reviewer chạy độc lập 12 ca mới đều qua. Worker mới quan sát được sau deploy: `2838f499-1af0-4be8-8030-25c2a6627b3a`.

## Kèo Nagano–Mito 71,38% do người dùng gửi

Chưa xác nhận đây là arbitrage hợp lệ. Phép tính từ hai decimal odds 2,28205 và 6,88235 cho khoảng 71,38%, nhưng chưa lấy lại được đúng hai giá gốc cùng thời điểm ảnh chụp. Giá đã thay đổi trong các lần đọc sau. Không kết luận một nguyên nhân cụ thể đã tạo ra toàn bộ con số này.

Dữ liệu thật chứng minh lỗi kỳ đấu: CMD event `25426567` có hai tên `(ET)`, SABA event `134101803` có hai tên `(Hiệp Phụ)`, nhưng cả hai bị gắn `REGULATION` và profile 90 phút. Vì **cả hai đều là hiệp phụ**, đây không phải bằng chứng chúng đã bị ghép hiệp phụ với 90 phút. Nguồn còn có các event riêng `(PEN)`/`(Luân Lưu)` bị gắn sai tương tự. Capture: `cmd-nagano-mito-current.json`, `saba-nagano-mito-live-evidence.json`.

Đã sửa shared CMD HTTP/DOM/More và SABA DOM: giữ event/name/ID, phân loại EXTRA_TIME/PENALTY_SHOOTOUT/UNKNOWN, giữ toàn bộ native observation/giá và ghi `EVENT_PERIOD_SETTLEMENT_UNSUPPORTED`; không tạo market 90 phút cho kỳ chưa có settlement được hỗ trợ. Matcher chặn cả dữ liệu cache có marker ET/PEN/Hiệp Phụ/Luân Lưu mâu thuẫn với scope, kể cả khi hai sàn cùng khai sai REGULATION. Marker chỉ xét trong ngoặc, giữ nguyên tên gốc. 116 kiểm thử normalizer/API trong workspace hiện tại và 215 kiểm thử matcher cuối qua; build/typecheck/review độc lập qua. Đường SABA WS riêng đã chặn ET/PEN tiếng Anh từ trước, chưa mở rộng phân loại localized tại normalizer đó; matcher mới vẫn chặn những nhãn localized khai sai scope.

Kiểm tra API thật **19:10:45** (`nagano-period-deployed.json`): SABA giữ event hiệp phụ với 11 native observations bị loại có lý do, event luân lưu với 4; CMD giữ event hiệp phụ với 18 và luân lưu với 63. Scope lần lượt EXTRA_TIME/PENALTY_SHOOTOUT, không còn market/quote 90 phút ở các event này. Đây là giữ inventory nhưng chưa hỗ trợ ghép hợp đồng hiệp phụ/luân lưu, không phải đã chuẩn hóa xong toàn bộ.

Replay cùng sáu file canonical lịch sử sau marker guard vẫn **66.138 cặp / 148.291 đường ghép**, không thay đổi. Snapshot 17:39 không chứa các event ET/PEN hoặc ID mới trong ảnh, nên không dùng phép replay đó để suy số cặp bị chặn ở thời điểm ảnh. Bằng chứng `period-guard-same-input-replay/summary.md`.

## Kiểm tra bản 19:09

Một cửa sổ 180 giây, `feeds-corrected-summary.json`: CMD 25/36 mẫu LIVE/ACTIVE/FRESH và 8/12 mẫu phút cuối; IM 0/36. SBO phục hồi baseline mới và quote đổi thật ở cuối cửa sổ sau đổi worker. AP 36/36, BTI 18/36 (12/12 cuối), SABA 35/36. **Vẫn chưa đạt sáu feed ổn định**; CMD cuối cửa sổ SOFT_RECOVERY dù có evidence gần đây. Không khởi động lại vòng quan sát để che thất bại này.

Browser 19:10:35–19:12:36 tải đúng `index-DlhYFTHc.js`, 40 catalog GET thành công, không page error/crash, không thấy card Nagano trong năm mẫu. Peak private memory 1.156 MiB, JS heap 330 MiB, sau GC 182 MiB. Số nguồn hoạt động biến động trong cửa sổ nên đây không phải thử tải sáu nguồn đầy đủ hoặc bằng chứng ổn định bộ nhớ lâu dài. 15/16 card dương xuất hiện ở hai mẫu đầu rồi hết ở các mẫu sau; đây là quan sát chưa preflight, không phải 16 kèo đã xác nhận đặt được.

Lệnh reload Chrome người dùng tiếp tục dừng đúng chốt DASHBOARD_NOT_SELECTED, không reload trang khác đang được chọn. Người dùng mở lại local hoặc refresh tab dashboard để nhận bundle mới. Trình duyệt kiểm tra riêng đã đóng, observer đã kết thúc, deployment lease đã trả.
