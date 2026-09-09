# Khôi phục dev tunnel và triển khai sửa ghép kèo

Dev: <https://live.babiesbo.uk/football-live>.

## Vì sao link chết

Trước phục hồi, cả cổng API 4310 và web 4311 đều từ chối kết nối; public trả 502 trong khi tiến trình tunnel vẫn chạy. Khởi động lại với cấu hình mặc định tái hiện API hết heap 512 MB, thoát mã 134; trình quản lý dừng tiếp web. Không còn đủ log để khẳng định nguyên nhân chính xác của lần tiến trình cũ biến mất, nhưng lỗi hết bộ nhớ khi khởi động đã được tái hiện trực tiếp.

Đã dùng cấu hình được launcher hỗ trợ `FIELDLINE_API_MAX_OLD_SPACE_MB=1024`, lưu trong `.env` bị Git bỏ qua để giữ qua lần khởi động sau. Dùng lại tunnel và API dist đang có; không thay DNS, credential hay extension. Public/local HTTP 200 và WebSocket SNAPSHOT đã kiểm tra. API cùng PID vẫn chạy sau 16 phút, heap khoảng 705 MiB, RSS 918 MiB. [Bằng chứng phục hồi](../../../.run/dev-tunnel-2026-09-09/recovery/README.md).

## Sửa ghép đã đưa vào mã đang phục vụ dev

- Bổ sung 44 nhóm tên đội và hai nhóm tên giải đã đối chiếu qua sáu nguồn, gồm dạng tên đầy đủ có tiền tố của IM.
- Xét cả ứng viên tên chính xác và tên gần giống, rồi áp dụng kiểm tra trận/giải/hiệp/line/chiều đội/luật thanh toán. Vẫn từ chối chọn tùy tiện khi có nhiều nhóm phù hợp.
- Giữ dấu hiệu riêng `Young Violets`, tránh alias Wien/Vienna làm đội này nhập vào đội một Austria Vienna.
- Thêm bộ đếm nhóm kèo, market nguồn tham gia và cặp market giữa hai sàn; danh sách vẫn là top 20 vé. Chỉ đếm các dòng ghép thực tế, không nhân chéo market khác hợp đồng. Dùng ID nguồn để tránh tên hiển thị trùng làm cộng sai hoặc thay nhầm nhóm.

Chạy lại cùng snapshot cũ: **12.098 → 12.590 cặp**, thêm 492, không mất cặp cũ. Trên mẫu mới lúc 11:53 với bốn nguồn Fresh: **7.386 → 7.917**, thêm 554 nhưng giữ lại 23 cặp ngoài kết quả do kiểm tra nhiều ứng viên, tăng ròng 531. Không dùng việc dữ liệu sàn thay đổi theo thời gian để tính mức tăng của bản sửa. [Replay và giới hạn](../../../.run/six-provider-normalization-audit-2026-09-09/matching-agent/production-integration-notes.md).

## Lỗi tải catalog qua tunnel

Chỉ sửa alias chưa đủ để trang hiển thị đúng. Trình duyệt ban đầu tải trùng catalog từ luồng khởi tạo và luồng thông báo revision; các tải BTI/APSPORT/IM bị hủy quanh 10 giây. Public đã nén zstd/br, nên không kết luận là thiếu nén. Parser thực tế chấp nhận cả các snapshot BTI/APSPORT và một lần đọc APSPORT hiện hành.

Đã gộp các lần đọc đồng thời cùng tài khoản thành một yêu cầu, chia sẻ cả tải nội dung và kiểm tra cấu trúc. Dashboard giữ thời hạn chờ header 10 giây và cho phép tải body tối đa 30 giây sau header; các caller không truyền tùy chọn mới giữ deadline cũ. Không thay observedAt, snapshotState, ngưỡng freshness hay dữ liệu market/quote/native inventory. Catalog BTI khoảng 90 MB trước nén đã tải xong trong 12,55 giây thay vì bị hủy ở giây thứ 10. [Các lần tải trước/sau](../../../.run/dev-tunnel-2026-09-09/dashboard-after.json).

Mẫu giao diện public lúc **12:09:55 UTC+7**: **11.028 nhóm kèo, 26.753 cặp market, 28.514 market nguồn tham gia**. Năm nguồn BTI/CMD/APSPORT/SBOBET/IM đã hiển thị dữ liệu; SABA còn stale và bị loại khỏi ghép trực tiếp. [Mẫu 12:09](../../../.run/dev-tunnel-2026-09-09/dashboard-before-revision-fix.json). Top 20 có Boca Juniors–Central Cordoba, chấp hiệp một −0,5, SBOBET/CMD, ROI ước tính khoảng +0,26%. Đây là giá quan sát tại thời điểm kiểm tra, chưa phải xác nhận thực thi.

Mẫu cuối sau sửa revision lúc **12:17:26**: **10.229 nhóm kèo, 16.453 cặp market, 23.216 market nguồn tham gia**, top 20 đã render, không lỗi JavaScript hoặc request catalog thất bại trong cửa sổ ghi nhận. BTI tải xong trong 26,09 giây tổng cộng, nằm trong ngân sách header/body. IM chuyển sang thông báo chưa có nguồn hợp lệ trong mẫu này, trong khi SABA vẫn chưa trở lại; không coi số giảm giữa hai thời điểm khác dữ liệu là hồi quy matcher. Việc collector sáu sàn ổn định liên tục chưa được nghiệm thu. [Ảnh giao diện cuối](../../../.run/dev-tunnel-2026-09-09/dashboard-after.png).

Đã sửa tiếp luồng revision: một catalog tải hoàn tất không bị bỏ mãi chỉ vì có thông báo revision mới trong lúc tải. Luồng nhận dữ liệu tiến về phía trước và tiếp tục lấy revision mới nhất; giữ chặn tài khoản sai, timestamp lùi, thay baseline, thông báo STALE và trường hợp luồng khác đã nhận revision mới hơn. Kiểm thử mô phỏng lượt tải sáu giây trong khi revision đổi mỗi giây; thêm kiểm thử giữ chặn qua cả lượt retry sau cập nhật bên ngoài.

Kiểm tra root: 366 tests liên quan ghép/worker/ranking/catalog/UI qua, bốn test UI có sẵn bị skip. Sau sửa guard cuối, chạy lại 33 tests coordinator/API đều qua. `npm.cmd run build --workspace @tool-chenh/web` qua, gồm typecheck; có cảnh báo kích thước chunk 500 kB từ Vite. Build web cuối có `index-B_5oRnXp.js` và `comparison.worker-CjrsCJni.js`. Các sửa chạy qua Vite; API vẫn là dist có sẵn, nên build identity API không được dùng để nhận diện mã web mới.

## Vì sao 216.977 bản ghi chỉ thành 65.383 market ở snapshot cũ

**216.977 = 62.933 NORMALIZED + 71.555 UNMAPPED + 82.489 EXCLUDED.** Đây là phân loại của adapter hiện tại; chưa phải kết luận mọi bản ghi EXCLUDED đều không dùng được. Sau lọc/tách ở từng adapter và cộng cache IM: **62.933 − 104 CMD − 1 APSPORT + 7 SABA + 2.548 IM = 65.383**.

Một bản ghi native có thể chứa cả bảng nhiều giá, nhiều cửa, slot đóng hoặc hợp đồng đã hiện ở mã khác. Ngược lại một bản ghi có thể tách ra nhiều hợp đồng chuẩn. Vì vậy số raw không phải số market hai cửa có thể giao dịch. Tuy nhiên còn thiếu mapping thật: riêng nhóm EXCLUDED của APSPORT có 31.312 bản ghi chưa chứng minh được loại tương đương; BTI còn 395 bản ghi thuộc họ both-halves over/under đã biết nhưng chưa ánh xạ. CMD phục hồi được 8.715 tuple More từ nhãn JSON, trong đó 4.379 tuple có vị trí giá dùng được. [Phân tích đầy đủ](2026-09-09-market-pair-count-correction.md).

Đã biết đường xử lý toàn bộ: giữ mã native và dữ liệu selection/line/odds gốc; ánh xạ theo môn, statistic, hiệp, line, chiều đội, miền kết quả và luật thanh toán; sau đó ghép trận bằng cả hai đội, giải, giờ và dấu hiệu đội trẻ/nữ/dự bị. Các loại ba cửa hoặc có hoàn/nửa tiền vẫn cần cấu trúc miền kết quả và cách tính riêng trong form chung. Không ép chúng thành hai cửa để tăng số ghép.

**Chưa hoàn thành chuẩn hóa mọi loại kèo của sáu sàn.** Bản triển khai này sửa các lỗi tên/ứng viên đã chứng minh và đường tải/đếm kết quả. Bộ đếm trên dashboard hiện ghi rõ phạm vi hai cửa không hoàn tiền; không dùng số đó thay cho toàn bộ coverage của các loại kèo còn chưa map.

Các kiểm tra trình duyệt chạy hữu hạn, chặn yêu cầu ghi/recovery/preflight từ trình duyệt kiểm thử, không thao tác tab nhà cái. API hiện có tiếp tục duy trì nguồn theo cấu hình sẵn có. Không đặt cược.
