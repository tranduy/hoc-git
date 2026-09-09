# Đính chính cách đếm cặp market và điều tra 71.555 bản ghi chưa map

**23,91% = 15.631 / 65.383**: số market nguồn có đối tác trong lát cắt hai cửa không hoàn tiền, chia cho toàn bộ market đã chuẩn hóa. Đây không phải tỷ lệ ghép chéo, không phải số cặp trên tổng số cặp có thể tạo ra và không mô tả đầy đủ độ phủ chuẩn hóa. Báo cáo trước dùng chỉ số này làm kết luận chính là không phù hợp với yêu cầu đếm toàn bộ cặp.

**12.590 cặp cũng chỉ là lát cắt không hoàn tiền.** Đếm cùng hợp đồng trên toàn bộ line của cùng snapshot sáu sàn, dùng bản alias/ứng viên cuối và giữ nguyên kiểm tra trận, hiệp, chiều đội, line, settlement, trạng thái và miền cửa, cho kết quả sau:

| Phạm vi | Nhóm hợp đồng | Market nguồn có đối tác | Cặp market giữa hai sàn | Cách chọn hai cửa đối ứng |
|---|---:|---:|---:|---:|
| Hai cửa không hoàn tiền | 6.448 | 15.631 | 12.590 | 25.180 |
| Line nguyên và ¼ | 5.451 | 16.321 | 18.788 | 37.576 |
| **Tổng phần hợp đồng đã chuẩn hóa** | **11.899** | **31.952** | **31.378** | **62.756** |

Toàn bộ inventory canonical vẫn là **65.383 market**, cùng **130.768 giá**; số bản ghi quan sát native là **216.977**. Ba đơn vị này không thay thế nhau. Số 31.378 là số hợp đồng ghép được theo quy tắc hiện tại trên phần canonical, không phải trần sau khi khôi phục mọi loại chưa map, và không phải số cơ hội có lãi. Giá IM cũ được giữ cho điều tra cấu trúc theo yêu cầu. Không tính ROI bằng công thức hai cửa win/lose cho các line có hoàn tiền hoặc thanh toán nửa.

Đã sửa form kiểm toán để **đủ điều kiện chiến lược không che mất kết quả chuẩn hóa hợp đồng**: [common-markets-six-providers-all-lines.ndjson](../../../.run/six-provider-normalization-audit-2026-09-09/common-markets-six-providers-all-lines.ndjson) có đủ 65.383 market, trường đối tác ghép tính tất cả line, còn `noPushStrategy` và `freshness` giữ riêng. [Danh sách đủ 31.378 cặp](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/combinatorics-all-pairs.ndjson), [kiểm chứng export](../../../.run/six-provider-normalization-audit-2026-09-09/all-lines-form-verification.json).

## Vì sao cặp ghép không nhất thiết nhiều hơn số market nguồn

Với **một hợp đồng giống nhau** có ở k sàn, số cặp sàn là `k × (k − 1) / 2`. Hai sàn có hai market nguồn tạo một cặp; sáu sàn có sáu market nguồn tạo 15 cặp. Mỗi cặp hai cửa có hai cách phân công nguồn: cửa A ở sàn 1/cửa B ở sàn 2, hoặc ngược lại.

Nếu cả sáu sàn đều có cùng 1.000 hợp đồng: 6.000 market nguồn tạo 15.000 cặp và 30.000 cách phân công hai cửa. Kỳ vọng tăng theo tổ hợp đúng khi hợp đồng thực sự cùng có ở nhiều sàn. Các market khác trận, hiệp, line hoặc luật không tự thành cặp cùng hợp đồng trong phép đếm này.

Phân bố đo được thực tế:

| Số sàn trong một nhóm | Số nhóm hợp đồng | Market nguồn tham gia | Cặp sinh ra |
|---:|---:|---:|---:|
| 2 | 6.222 | 12.444 | 6.222 |
| 3 | 3.811 | 11.433 | 11.433 |
| 4 | 1.338 | 5.352 | 8.028 |
| 5 | 445 | 2.225 | 4.450 |
| 6 | 83 | 498 | 1.245 |
| **Tổng** | **11.899** | **31.952** | **31.378** |

Đã kiểm tra cả hai đẳng thức: `Σ số_nhóm(k) × k = 31.952` và `Σ số_nhóm(k) × C(k,2) = 31.378`; tập khóa cặp độc lập không trùng. Vì đa số nhóm chỉ có hai hoặc ba sàn, không thể lấy giả định tất cả nhóm đều có sáu sàn. Điều này giải thích số học, **không chứng minh bộ chuẩn hóa đã đầy đủ**. Các cặp bị mất vì thiếu mapping/nhận dạng vẫn phải xử lý.

Theo từng nguồn, market canonical đã tìm được đối tác cùng hợp đồng: BTI 7.540/34.658; CMD 3.023/3.633; APSPORT 10.515/14.132; SBOBET 9.614/9.841; SABA 524/571; IM 736/2.548. [Toàn bộ ma trận 15 cặp sàn và histogram](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/combinatorics-followup.json).

## 71.555 UNMAPPED thực chất là gì

Đây là **bản ghi kiểm kê chưa được bảng mapping hiện tại chuyển thành hợp đồng**, không phải 71.555 kèo hai cửa đang mở và chắc chắn ghép được. Mã nhánh không tìm thấy native type thường trả `NATIVE_TYPE_UNMAPPED`; taxonomy giữa các adapter không thống nhất, nên kèo nhiều cửa có thể bị gắn UNMAPPED ở một sàn nhưng EXCLUDED ở sàn khác.

| Sàn | Bản ghi UNMAPPED | Điều tra nguyên nhân |
|---|---:|---|
| BTI | 40.480 | 189 mã chưa được giải quyết đầy đủ. Có thiếu mapping thật cho họ binary đã hỗ trợ; đồng thời gồm tỷ số chính xác, double chance, cược cầu thủ và các cặp lựa chọn không bù nhau. |
| CMD | 13.747 | 5.032 bản ghi của bốn lớp main và 8.715 tuple More. Có nhãn UNMAPPED trùng kèo canonical đã nhận, slot giá đóng, kèo nhiều cửa và nhóm binary cần bổ sung. |
| SBOBET | 16.992 | 15 nhóm chưa có mapping được chứng minh. Fixture gốc có nhóm chứa token dạng tỷ số, nhóm ba giá và nhóm dạng khoảng số; chưa đủ chứng minh tên loại/hiệp/luật của từng nhóm. Observer không giữ chuỗi giá gốc trong inventory, chỉ giữ nhãn kiểu H/A/D. Không mượn mã giống APSPORT để quyết định ngữ nghĩa. |
| SABA | 336 | 48 mã; thiếu tên loại, phần lớn nhãn cửa là OUTCOME_1/2 tự sinh. Hai nhãn tự sinh không chứng minh đó là kèo hai cửa bù nhau. |
| **Tổng** | **71.555** | Đã đối chiếu đủ 271 nhóm native type. |

Một lỗi trong trả lời trước là suy từ `nativeSelections` thiếu sang “không có dữ liệu cửa/giá gốc”. **Điều đó không đúng cho toàn bộ CMD.** Đã đọc lại từng bản ghi và khôi phục đầy đủ **8.715 mảng số More được lưu dưới dạng JSON trong `nativeLabel`**, khớp nguyên bản từng mảng; chúng chứa 62.167 scalar và thuộc 560 event ID phân biệt. Một native row có thể chứa nhiều giá/hợp đồng, không phải luôn một kèo.

Sau khi đối chiếu renderer công khai đã lưu trên máy và loại mask tỷ số, line/cờ của kèo chấp ba cửa:

- **4.379 tuple** có ít nhất một vị trí giá decimal > 1, tổng **34.105 giá** khôi phục được.
- **4.336 tuple** không có vị trí giá dùng được; không tính chúng thành market đang mở.
- Trong nhóm CNS bốn cửa HY/HN/AY/AN, 280/581 tuple có ít nhất một cặp giá đầy đủ, tổng **540 cặp giá ứng viên**. Đây chưa phải 540 cặp chéo giữa các sàn. Cần xác minh tiêu đề và luật trước khi phát hành như market giữ sạch lưới.
- Main `MAIN:2` có 1.258 observation nhưng **860 observation đã có FT_ODD_EVEN canonical ở cùng event**. Đổi nhãn đơn thuần rồi cộng chúng như kèo mới sẽ đếm trùng. Main `FH:2` chỉ có ba observation tương ứng loại canonical; tuy nhiên chúng còn bao gồm event ngoài catalog và placeholder, nên 1.255 còn lại chưa thể gọi là kèo mở bị thiếu.

BTI có **395 bản ghi** mang nhãn “cả hai hiệp tài 0,5/tài 1,5/xỉu 1,5” thuộc họ market registry đã có; 394 giữ đủ nhãn Có/Không nhưng chưa có canonical tương ứng. Đây là thiếu bảng mapping cần ưu tiên. Thêm 284 bản ghi Asian team total: 268 đã có cùng event/team canonical family từ mã khác, nhưng không còn line gốc để xác định là cùng hay khác hợp đồng. Không cộng mù 284 market mới.

[Chi tiết từng loại, số lượng, bằng chứng và giới hạn](../../../.run/six-provider-normalization-audit-2026-09-09/unmapped-followup/unmapped71555-breakdown.md), [CSV đủ 271 nhóm](../../../.run/six-provider-normalization-audit-2026-09-09/unmapped-followup/unmapped71555-breakdown.csv), [8.715 tuple CMD đã khôi phục](../../../.run/six-provider-normalization-audit-2026-09-09/unmapped-followup/cmd-unmapped-more-recovered.ndjson), [kiểm chứng độc lập dữ liệu khôi phục](../../../.run/six-provider-normalization-audit-2026-09-09/unmapped-followup/raw-retention-verification.json).

## Giá trị của inventory và phần chưa hoàn thành

Inventory có ích để chỉ đúng loại đang bị bỏ rơi, đo lỗi phân loại và giữ bằng chứng để viết mapping. **Bản thân nó không tham gia ghép, không tạo cơ hội và không được tính như market đã hỗ trợ.** Cần phân biệt market mở có giá, placeholder/đóng, market đã có canonical tương đương, loại nằm ngoài chiến lược và loại thực sự thiếu mapping. 82.489 bản ghi EXCLUDED ngoài số UNMAPPED cũng cần phân loại theo phạm vi, không thể mặc nhiên coi mọi loại đó là vô ích hoặc đều map được.

Đã sửa số đếm và form điều tra; khôi phục được phần dữ liệu CMD bị báo thiếu quá rộng. **Chưa hoàn thành chuẩn hóa toàn bộ các loại kèo của sáu sàn.** Không dùng số tăng alias để thay thế công việc đó. Các mục cụ thể còn lại là bổ sung registry cho nhóm có bằng chứng, giữ selection/line/odds gốc cho nhóm đang bị bỏ trường, loại trừ hoặc tách kèo nhiều cửa đúng ngữ nghĩa, và đưa mọi market đã chuẩn hóa qua mô hình thanh toán phù hợp. Chưa sửa hoặc triển khai bộ collector/normalizer production trong lần đính chính này.

Mọi phép đếm dùng lại snapshot 09/09/2026 10:41 UTC+7; không lấy dữ liệu mới để trộn kết quả. Đã chạy lại độc lập `combinatorics-followup.mjs`, đối chiếu toàn bộ 31.378 cặp với form 65.383 market, kiểm tra histogram và đối chiếu nguyên bản 8.715 tuple CMD. Không gửi yêu cầu tới sàn hay tính các giá cũ thành vé có thể thực hiện hiện tại.
