# Điều tra chuẩn hóa và ghép market của 6 sàn — 09/09/2026

> **Đính chính phạm vi đếm:** 23,91% và 12.590 cặp bên dưới chỉ mô tả phần market hai cửa không hoàn tiền, không phải toàn bộ hợp đồng đã chuẩn hóa. Đếm cả line nguyên/¼ trên cùng sáu nguồn cho **31.378 cặp / 11.899 nhóm hợp đồng / 62.756 cách phân công hai cửa**. Đồng thời đã khôi phục 8.715 tuple CMD từ `nativeLabel`, nên thiếu `nativeSelections` không có nghĩa mọi giá gốc đều mất. Xem [báo cáo đính chính và bóc tách 71.555 UNMAPPED](2026-09-09-market-pair-count-correction.md). Form đầy đủ mới là `common-markets-six-providers-all-lines.ndjson` được liên kết trong báo cáo đó.

Đã đọc toàn bộ dữ liệu API trong một lần chụp cố định, không lấy mẫu: **216.977 bản ghi quan sát market gốc, 4.010 trận, 65.383 market chuẩn hóa, 130.768 giá**. **Dùng cả dữ liệu IM cũ để chuẩn hóa tên và kiểm tra ghép đủ sáu sàn**, theo yêu cầu; phần sửa feed IM để sau.

Replay cả sáu catalog bằng bộ ghép hiện tại tạo **6.378 nhóm kèo / 12.098 cặp market**. Bản chuẩn hóa thử cuối gồm 44 nhóm alias đội, hai nhóm alias giải và sửa chọn ứng viên tạo **6.448 nhóm / 12.590 cặp: thêm 492, không mất cặp cũ**. Riêng IM có **707 cặp market với các sàn khác, từ 246 market thuộc 124 trận**. Tuổi giá được giữ riêng và không ngăn việc chuẩn hóa tên IM.

Đây là kết quả điều tra và bản thử offline; chưa thay đổi bộ ghép production. Các cặp có IM không được gọi là cơ hội giá hiện tại. Đo lợi nhuận riêng trên năm nguồn FRESH vẫn thấy hai kèo dương lý thuyết ở cả trước và sau chuẩn hóa. Không thể kết luận “không có kèo dương ⇒ chắc chắn không ghép được”: lỗi chuẩn hóa được chứng minh bằng các cặp bị bỏ sót, còn lợi nhuận phải đo riêng.

## Kết quả cuối: chuẩn hóa cả sáu nguồn, bao gồm IM cũ

| Chỉ số cùng bộ dữ liệu sáu nguồn | Bộ ghép hiện tại | Bản chuẩn hóa thử cuối |
|---|---:|---:|
| Nhóm kèo so sánh | 6.378 | 6.448 |
| Cặp market giữa hai sàn | 12.098 | 12.590 |
| Market nguồn có ít nhất một cặp | 15.320 | 15.631 |
| Cặp có IM | 631 | 707 |
| Market IM có ít nhất một cặp | 223 | 246 |
| Trận IM có market ghép được | 113 | 124 |

Đã đối chiếu tập khóa nguồn: **492 cặp thêm, 0 cặp mất**; trong đó IM thêm 76, không mất cặp IM cũ. Sau chuẩn hóa thử, **15.631/65.383 market nguồn có đối tác ghép, khoảng 23,91%**. Không cộng số đo của năm nguồn với IM để suy ra tổng vì tập nguồn làm thay đổi cách học tên giải và gom nhóm trận. [Replay sáu nguồn](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/six-provider-offline-six-broad-replay.json), [mã thử cuối](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/comparison-six-final-proposal.ts).

Đã xử lý và xuất đủ 351 bản ghi trận IM, gồm 635 biến thể tên đội phân biệt. So với tên trong năm nguồn còn lại: số tên khớp chính xác tăng **446 → 459**, 122 tên còn cần quy tắc gần đúng hiện có, 54 tên chưa có đối chiếu đủ chắc. Theo cặp đội của trận: 222 trận có cả hai tên khớp chính xác, 86 cần đối sánh gần đúng, 43 còn ít nhất một tên chưa đối chiếu được. Đây là đối chiếu tên độc lập với tuổi cache; không gộp những lần gặp khác ngày chỉ vì cùng đội. Thiếu đối chiếu cũng có thể do đội không xuất hiện ở các nguồn khác.

Các biến thể IM đã đưa về cùng nhóm gồm Helsingborgs IF/Helsingborg, SK Slavia Praha/Slavia Prague, AC Sparta Praha/Sparta Prague, SK Rapid Wien II/Rapid Vienna II. Giữ đội II, U23, U20 và đội nữ riêng. [Chi tiết từng trận IM](../../../.run/six-provider-normalization-audit-2026-09-09/names-agent/im-six-normalized-events.json).

Form cuối đã xuất **4.010 dòng trận** vào [common-events-six-providers.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/common-events-six-providers.ndjson), **65.383 dòng market** vào [common-markets-six-providers.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/common-markets-six-providers.ndjson), và **12.590 cặp** vào [six-provider-matched-pairs.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/six-provider-matched-pairs.ndjson). `normalizationStage`, `offlineGroupKey` và sàn đối ứng tách riêng khỏi `freshness`; IM vẫn có kết quả chuẩn hóa/ghép dù `snapshotState=STALE`.

Đã quét lại toàn bộ export, kiểm tra từng cặp cùng nhóm, loại market, hiệp, line, settlement và đúng miền cửa sau đảo chiều. [Kiểm chứng form sáu nguồn](../../../.run/six-provider-normalization-audit-2026-09-09/six-provider-form-verification.json).

## Dữ liệu và mẫu số

Lấy catalog bóng đá của đủ sáu nguồn qua API local đang chạy, từ **10:41:17 đến 10:41:23 UTC+7 ngày 09/09/2026**. Mỗi nguồn giữ nguyên revision, thời điểm nhận và SHA-256 trong [manifest](../../../.run/six-provider-normalization-audit-2026-09-09/manifest.json). Các request không phải giao dịch nguyên tử đồng thời; độ lệch lấy dữ liệu khoảng sáu giây. Các phép thử sau đó không đọc lại mạng.

| Sàn | Trạng thái khi chụp | Trận trong catalog | Market gốc quan sát | Market chuẩn hóa | Qua chính sách line hiện tại | Market nguồn ghép offline sau chuẩn hóa thử |
|---|---|---:|---:|---:|---:|---:|
| BTI | FRESH | 1.667 | 99.877 | 34.658 | 24.610 | 3.369 |
| CMD | FRESH | 716 | 27.476 | 3.633 | 1.209 | 985 |
| APSPORT | FRESH | 604 | 55.565 | 14.132 | 9.091 | 5.982 |
| SBOBET | FRESH | 537 | 32.263 | 9.841 | 4.953 | 4.862 |
| SABA | FRESH | 135 | 1.796 | 571 | 217 | 187 |
| IM | STALE, khoảng 57 giờ; dùng chuẩn hóa | 351 | Không có dữ liệu gốc trong cache | 2.548 | 818 | 246 |
| Tổng | Sáu nguồn để chuẩn hóa | 4.010 | 216.977 | 65.383 | 40.898 | 15.631 |

IM giữ thời điểm catalog từ ngày 07/09; dùng đầy đủ cho chuẩn hóa và replay cấu trúc, không dùng cache này để tính kèo hiện tại. SABA FRESH chỉ chứng minh tuổi dữ liệu, chưa chứng minh đã thu đủ thị trường ẩn. Vì vậy đã kiểm kê toàn bộ API trả về, **chưa chứng minh API đã lấy đủ mọi market thực có trên sáu sàn**.

216.977 bản ghi gốc đều duy nhất theo `(provider, eventId, marketId, nativeType)` trong snapshot. Riêng APSPORT có ba va chạm nếu bỏ `nativeType` khỏi khóa. Các bản ghi khác ID vẫn có thể đại diện cùng hợp đồng, như các loại tài/xỉu BTI. Số giá, số market gốc, số market chuẩn hóa, số nhóm kèo và số cặp giữa hai sàn là các đơn vị khác nhau.

Phân loại market gốc theo chính hệ thống: **62.933 NORMALIZED, 71.555 UNMAPPED, 82.489 EXCLUDED**. EXCLUDED gồm kèo ba cửa, market đóng, hình dạng sai, trận không thuộc phạm vi, hoặc chưa chứng minh luật tương đương; không được coi toàn bộ là kèo có thể ghép. Số NORMALIZED không bằng số market xuất ra: CMD loại tiếp 104 bản ghi, APSPORT mất một market do va chạm ID, SABA mở rộng bảy market giữ sạch lưới thành 14 hợp đồng. `62.933 − 104 − 1 + 7 = 62.835` market ở năm nguồn mới.

## Cách đang chuẩn hóa và ghép

Luồng thực tế: dữ liệu trang/socket/HTTP của từng sàn → adapter riêng → `ProviderEvent`, `ProviderMarket`, `ProviderQuote` → catalog API → `apps/web/src/catalog/comparison.ts` → ranking/preflight. Dashboard dùng bộ ghép trong web; không nên chỉ sửa `packages/core/src/mapping` rồi giả định bảng so sánh đã thay đổi.

ID trận/market là **ID riêng của sàn**. Không tìm thấy một ID trận chung đáng tin cậy xuyên cả sáu nguồn trong dữ liệu này. `fixtureDiscriminator` có thể bổ sung bằng chứng nếu tồn tại và tương thích; không thay thế được hệ thống đối chiếu trận.

| Tầng | Quy tắc hiện tại |
|---|---|
| Tên đội | Giải mã HTML, bỏ dấu, chữ thường, chuẩn hóa ký tự, một số tiền/hậu tố CLB và alias cụ thể. Đối sánh gần đúng chủ yếu dựa vào quan hệ chứa token; không tự giải quyết mọi phiên âm/viết tắt. |
| Trận | Cùng môn/biến thể/phạm vi/phase; bảo vệ đội nữ, trẻ, dự bị và sản phẩm khác. Trước trận cần giải tương thích và giờ lệch không quá hai phút; live cần thêm bằng chứng phù hợp. |
| Giải và sản phẩm | Alias thủ công và liên kết học từ nhiều trận; phân biệt GOALS/CORNERS/CARDS. Không gộp góc/thẻ vào bàn thắng chỉ vì cùng hai đội. |
| Market | Cùng loại kèo, hiệp, line theo chiều đội đã chuẩn, miền kết quả và settlement profile. Đảo đội phải đảo HOME/AWAY, dấu chấp và các kèo riêng chủ/khách. |
| Giá | Chuyển DECIMAL/HK/MALAY sang decimal theo nguồn. Market mở, đủ hai cửa riêng biệt, đúng market/event/phase, cùng sequence. Toàn bộ giá trong snapshot không có timestamp gốc từ sàn; hệ thống dựa vào thời điểm nhận local. |
| Ghép và lợi nhuận | Có ít nhất hai sàn trong một nhóm kèo chưa có nghĩa là giá tốt nhất hai cửa đến từ hai sàn khác nhau; càng chưa có nghĩa là lợi nhuận dương. Giá dương quan sát vẫn cần preflight. |

Các adapter cũng không đồng nhất ở tầng đầu: BTI đọc event/market/selection phân cấp; CMD đọc bảng main/more; IM dùng GetSE và định dạng dòng hiển thị; SABA có native l/m/o và DOM có timezone; SBOBET có socket/direct group; APSPORT dùng group số và odd row. BTI/IM/APSPORT/SBOBET đi qua normalizer chung của SBOBET ở bước sau. Chi tiết trường, mã market và vị trí mã nguồn nằm trong [audit normalizer](../../../.run/six-provider-normalization-audit-2026-09-09/normalizers-agent/normalizer-audit.md).

## Đối chứng bộ ghép hiện tại trên năm nguồn FRESH

Năm nguồn mới có **62.835 market**. Các tầng loại trừ sau là không chồng nhau:

| Kết quả trên market nguồn | Số lượng |
|---|---:|
| Đã ghép với ít nhất một sàn khác | 15.131 |
| Bị chính sách line nguyên/¼ loại khỏi so sánh hiện tại | 22.755 |
| Qua chính sách hai cửa nhưng chưa có cặp được bộ ghép xuất ra | 24.948 |
| Giá và market không nhất quán tại APSPORT | 1 |
| Tổng | 62.835 |

Như vậy tỷ lệ market nguồn có đối tác ghép là **24,08% trên market của năm nguồn mới**, hoặc **37,75% trên 40.080 market qua chính sách line**. Nếu dùng cả cache IM làm mẫu số thì là 15.131/65.383 = 23,14%, nhưng mẫu số đó trộn dữ liệu mới và cũ.

24.948 market chưa có cặp gồm: **10.333** nằm trong nhóm trận/sản phẩm chỉ có một sàn; **1.508** trùng hợp đồng trong cùng sàn, nằm ở nhóm trận đã có sàn khác; **13.107** đã tìm được nhóm trận nhưng chưa xuất được hợp đồng đối ứng. Nhóm cuối gồm thiếu loại/line tương ứng, khác settlement, hoặc dữ liệu cửa không phù hợp; không phải 13.107 lỗi tên. Phân loại đầy đủ: [unmatched-breakdown.json](../../../.run/six-provider-normalization-audit-2026-09-09/unmatched-breakdown.json).

15.131 market nguồn tạo 6.349 nhóm kèo, với **11.579 cặp market độc lập giữa hai sàn**. Một nhóm ba sàn có thể tạo ba cặp; vì vậy không lấy 11.579 chia thẳng cho tổng market để gọi là tỷ lệ market ghép được. Chỉ 3.124/6.349 nhóm có giá tốt nhất hai cửa thuộc hai sàn khác nhau (`crossBook=true`).

| Cặp sàn | Cặp market hiện tại |
|---|---:|
| APSPORT – SBOBET | 4.776 |
| APSPORT – BTI | 2.829 |
| BTI – SBOBET | 1.794 |
| BTI – CMD | 661 |
| APSPORT – CMD | 594 |
| CMD – SBOBET | 514 |
| CMD – SABA | 155 |
| BTI – SABA | 106 |
| APSPORT – SABA | 78 |
| SABA – SBOBET | 72 |
| Năm cặp có IM | 0, nguồn cũ bị loại |
| Tổng | 11.579 |

## Lỗi và phần còn thiếu đã có bằng chứng

**Tên đội chưa đồng nhất.** Có các trường hợp PSG St-Germain/Saint Germain, Bayern Munich/Munchen, Estudiantes La Plata/LP, Busan I Park/IPark. Bản thử 26 nhóm alias cụ thể giữ nguyên qualifier và mọi cửa kiểm tra khác. Alias là đề xuất dựa trên snapshot, chưa phải danh bạ ID đội toàn cầu được xác minh. Một alias Colchester trong lượt thử đầu làm mất ba cặp CMD; đã loại nó khỏi kết quả bảo toàn cặp bên dưới.

**Có ứng viên tên khớp chính xác thì bỏ cả nhóm ứng viên gần đúng.** `comparison.ts:1248` có thể ưu tiên một nhóm cùng tên nhưng khác giờ, rồi không xét nhóm tên biến thể đúng giờ. Đã tái hiện năm cặp bị bỏ sót; bản thử xét hợp cả hai tập ứng viên lấy lại đủ năm, không mất cặp cũ.

**Ghép qua một trận đại diện không bảo đảm mọi cặp thành viên qua cùng kiểm tra.** Có tám liên kết CMD/BTI mà từng sàn khớp với đại diện SBOBET, nhưng hai sàn không khớp trực tiếp theo hàm đối sánh hiện tại. Ví dụ Central Cordoba Santiago del Estero/SdE, Akron Togliatti/Tolyatti. Đây là sự không nhất quán của quy tắc đối sánh; không phải bằng chứng tám cặp là tám trận thật bị ghép sai. Kèo dương Boca bên dưới chọn SBOBET/CMD, không chọn liên kết CMD/BTI này.

**APSPORT va chạm namespace market.** Event `5726300`, market `181138159611075` có cả native type `6` (chấp hiệp một −0,75) và `61` (tài/xỉu góc đội nhà cả trận 7,5). Catalog chỉ giữ market sau nhưng còn bốn giá của cả hai. Cùng một receipt/sequence nên không phải nhầm hai lần chụp. Khóa merge chưa bao gồm loại market; cần giữ namespace hoặc từ chối va chạm có lý do rõ ràng.

**BTI có hợp đồng trùng, CMD có nhãn chẩn đoán sai.** BTI có 1.172 bản market dư theo khóa hợp đồng do các mã OU0/OU200, OU1/OU201, OU10/OU6010; 1.158 nhóm có giá khác nhau. Không được tự chọn giá cao nhất khi chưa hiểu khác biệt giữa các mã. CMD có 104 market được ghi NORMALIZED nhưng đã bị bộ lọc chấp mâu thuẫn loại khỏi catalog; cần cập nhật disposition sau lọc, không khôi phục mù quáng.

**Tên giải, giờ và luật market vẫn cần điều tra.** Quét ứng viên tìm được 277 liên kết trận/sản phẩm bị bỏ sót tiềm năng, chứa 821 cặp hợp đồng: tên đội 649, giải 105, cả hai 11, cách gom nhóm 56. Đây là tổng ứng viên có điều kiện, không phải 821 cặp an toàn có thể cộng vào kết quả. Có 14 cặp lệch giờ chứa 30 hợp đồng khác tương thích; ví dụ lệch 30 phút, 150 phút và 24 giờ. Chưa sửa timezone hay nới hai phút chỉ để ghép được chúng.

## Đối chứng bản chuẩn hóa cuối trên cùng năm nguồn FRESH

| Bộ ghép offline | Nhóm kèo | Cặp market | Market nguồn có cặp | Kèo dương quan sát |
|---|---:|---:|---:|---:|
| Mã hiện tại | 6.349 | 11.579 | 15.131 | 2 |
| Bản cuối 44 nhóm đội + hai nhóm giải + xét đủ ứng viên | 6.420 | 11.979 | 15.412 | 2 |

Bản kết hợp cuối đã được chạy trực tiếp trên cả sáu nguồn và tập con năm nguồn. Riêng năm nguồn: **thêm 400 cặp, không mất cặp cũ**, không cộng vào 492 cặp của replay sáu nguồn. [combined-replay-six-broad.json](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/combined-replay-six-broad.json). Chưa triển khai hoặc dùng alias đề xuất làm ID đội chính thức.

Hai kèo dương trong snapshot: Hungary – Ukraine, tài/xỉu cả trận 2,5, SBOBET/BTI khoảng **+0,5815%**; Boca Juniors – Central Cordoba, chấp hiệp một −0,5, SBOBET/CMD khoảng **+0,2570%**. Đã kiểm tra lại số học từ giá; cả hai vẫn là OBSERVATION. Đây không phải giá hiện thời hoặc lợi nhuận đã xác nhận: không gửi preflight, không đặt cược. [analysis.json](../../../.run/six-provider-normalization-audit-2026-09-09/analysis.json) giữ giá, nguồn, lý do và top 20 tại thời điểm chụp.

## Line nguyên/¼: đã chuẩn hóa nhưng bị chính sách loại

Trên chính các nhóm trận hiện tại, có thêm **5.371 nhóm hợp đồng / 16.433 cặp market / 15.496 market nguồn** line nguyên hoặc ¼ cùng loại, hiệp, chiều đội, line, settlement và đủ giá. Trong 16.433 cặp có 5.435 cặp line nguyên, 10.998 cặp line ¼. Kết quả này không cần sửa tên hoặc thêm nguồn.

Đây là độ phủ hợp đồng hiện bị loại theo chính sách không hòa tiền, không phải thêm 16.433 cơ hội arbitrage. Muốn đưa chúng vào tính lợi nhuận phải tính vector thanh toán gồm hòa tiền, thắng/thua nửa và từng nhánh line. Không dùng `1/o1 + 1/o2 < 1` như đủ bằng chứng có lãi cho mọi line này. Không thay chính sách hiện tại trong lần điều tra. [push-contract-overlap.json](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/push-contract-overlap.json).

## Form chung và dữ liệu bàn giao

Form ban đầu phản ánh bộ ghép production được giữ trong [common-markets.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/common-markets.ndjson), **65.383 dòng**, để đối chiếu trước/sau. **Form cuối dùng đủ sáu nguồn là `common-markets-six-providers.ndjson` ở đầu báo cáo**, giữ riêng tình trạng giá và kết quả chuẩn hóa. Các trường bao gồm:

- `source`: sàn, ID trận/market nguồn, khóa nguồn đầy đủ; không giả định ID chung.
- `event`: tên catalog trước đối sánh, tên chuẩn nguồn và tên theo đại diện nhóm, giải chuẩn theo family, giờ nguồn và giờ nhóm, phase/phạm vi/biến thể.
- `market`: loại, thống kê/family, hiệp, line đã đảo đúng chiều, settlement, miền kết quả, loại line và cờ đủ điều kiện theo chính sách hiện tại. Line nguyên/¼ vẫn giữ miền HOME/AWAY hoặc OVER/UNDER, không làm mất ngữ nghĩa vì chưa được phép so sánh.
- `quotes`: ID cửa, cửa gốc và cửa đã đảo, odds gốc/format/decimal, trạng thái, receipt/sequence; không thay tuổi dữ liệu.
- `productionGroupKey`, `orientationBasis`, `matchStage`: nhóm hiện tại, quy ước chiều đội và kết quả ghép/loại. Nhóm hiện tại là khóa đối sánh trong snapshot, không phải ID trận phổ quát bền vững.

Với market thuộc nhóm của bộ ghép, loại kèo/cửa/line được đưa về chiều đội đại diện của **cùng nhóm production**. Market không thuộc nhóm, ví dụ IM cũ, dùng thứ tự tên chuẩn nguồn và ghi rõ `SOURCE_LEXICAL`. Không lấy hai tên chuẩn giống nhau làm đủ bằng chứng tự ghép.

Toàn bộ **216.977 bản ghi quan sát market gốc mà API lưu** đã xuất thành [native-market-inventory.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/normalizers-agent/native-market-inventory.ndjson), giữ native type/label/scope, nhãn cửa, disposition và các liên kết canonical zero/one/many. Snapshot không có trường `nativeSelections` cho bất kỳ bản ghi nào; giá đã chuẩn hóa nằm trong `common-markets.ndjson`. **Đính chính: 8.715 observation CMD vẫn giữ mảng số gốc trong `nativeLabel` và đã được khôi phục ở báo cáo tiếp theo**; không thể suy ra toàn bộ 71.555 UNMAPPED đều thiếu mọi dữ liệu gốc. Có một dòng APSPORT được đánh dấu lệch ngữ nghĩa khi liên kết. IM không có dữ liệu gốc trong cache nên không bịa thêm. Các event bị adapter loại có thể thiếu tên vì catalog không còn tên gốc của chúng.

[common-form-samples.json](../../../.run/six-provider-normalization-audit-2026-09-09/common-form-samples.json) chứa các ví dụ nhỏ dễ đọc: cùng kèo Hungary–Ukraine từ BTI/SBOBET, market APSPORT bị va chạm và một market IM cũ.

[matched-pairs.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/matched-pairs.ndjson) chứa đủ **11.579 cặp nguồn hiện tại**. [native-type-dispositions.csv](../../../.run/six-provider-normalization-audit-2026-09-09/normalizers-agent/native-type-dispositions.csv) cho phép mở bảng đếm theo sàn, native type, disposition và lý do.

Thiết kế nên dùng tiếp từ form này: registry đội/giải có phiên bản và bằng chứng alias; thuộc tính nữ/trẻ/dự bị/biến thể riêng; kickoff có nguồn gốc; khóa native có namespace; miền thanh toán tách khỏi cờ đủ điều kiện chiến lược. Tên gần giống chỉ tạo ứng viên. Mọi cặp source-market đưa vào bảng cần bằng chứng trực tiếp, hoặc cùng liên kết đến ID canonical đã được xác minh.

## Kiểm chứng và giới hạn hoàn thành

Đã kiểm tra SHA-256 của cả sáu input, quét lại tất cả dòng export, đối chiếu tổng từng tầng, kiểm tra giá decimal và cửa đảo chiều, kiểm tra khóa cặp duy nhất, không có IM trong cặp hiện tại, và đối chiếu độc lập kết quả bộ ghép. [verification.json](../../../.run/six-provider-normalization-audit-2026-09-09/verification.json) ghi kết quả. Không chạy lại toàn bộ test/build vì không sửa production.

Chạy lại offline, từ thư mục repo:

```powershell
node .run/six-provider-normalization-audit-2026-09-09/analyze.mjs
node .run/six-provider-normalization-audit-2026-09-09/matching-agent/combined-replay.mjs
node .run/six-provider-normalization-audit-2026-09-09/verify.mjs
node .run/six-provider-normalization-audit-2026-09-09/six-provider-form.mjs .run/six-provider-normalization-audit-2026-09-09/matching-agent/comparison-six-final-proposal.ts
node .run/six-provider-normalization-audit-2026-09-09/verify-six-provider-form.mjs
```

`capture.mjs` là bước lấy snapshot mới và ghi lại input trong thư mục này; không chạy nếu muốn giữ nguyên bộ bằng chứng hiện tại. Các phép phân tích dùng nguồn mã được ghi hash; không xem một lần replay sau khi mã nguồn thay đổi là cùng phiên bản engine.

Đã hoàn thành điều tra catalog API hiện có, chuẩn hóa theo form chung đủ sáu nguồn kể cả IM cũ và đo bản thử trên toàn bộ dữ liệu. Chưa giải quyết hết 54 biến thể tên IM thiếu đối chiếu, chưa chứng minh phủ hết market gốc/ẩn hoặc ngữ nghĩa 71.555 market UNMAPPED. Namespace/duplicate production và nghiệm thu bản ghép mới trên feed thật là bước triển khai tiếp; sửa feed IM được để sau theo yêu cầu. Các số lợi nhuận trong tài liệu là ảnh chụp lịch sử, không phải vé có thể thực hiện hiện tại.
