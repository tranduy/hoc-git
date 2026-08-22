# Ticket Controls And Resource Lifecycle Design

## Goal

Hoàn thiện màn hình so sánh bóng đá để mỗi vé hiển thị đúng ROI và phép cân tiền riêng, hỗ trợ odds Hong Kong, sao chép từng đội, đồng thời chặn log, queue và tài nguyên trình duyệt của tool tăng không giới hạn.

## Ticket calculations

- Card trận tiếp tục dùng ROI cao nhất trong các vé exact của chính trận đó để xếp hạng.
- Mỗi vé detail tính độc lập: hai sàn, hai cửa đối nghịch đã qua exact-market gate, odds gốc và decimal, hai stake, tổng stake, lãi/lỗ của từng kết quả, worst-case và ROI của vé.
- Mỗi vé có hai ô stake. Sửa ô nào thì ô đó là anchor; ô còn lại được tính để cân payout và làm tròn theo bước 1.000 VND. Giá trị không hợp lệ hoặc không thể cân phải fail closed và không hiển thị lãi dương giả.
- Odds `HK` hợp lệ khi hữu hạn và lớn hơn 0; decimal bằng `HK + 1`. Các format chưa được yêu cầu không được tự suy diễn.

## UI

- Mỗi đội có một nút copy riêng, chỉ copy đúng tên đội đó.
- Cột danh sách chiếm xấp xỉ 40%, detail chiếm 60%. Detail dùng lưới compact, không scroll ngang và giữ chiều cao ổn định khi dữ liệu cập nhật.
- Global base stake vẫn là giá trị mặc định khi mở vé; chỉnh stake trong một vé không làm thay đổi vé khác.

## Resource lifecycle

- Production stack không ghi access log cho từng catalog poll ở mức `info`; lỗi quan trọng vẫn được giữ.
- Mọi log file do launcher quản lý phải có giới hạn dung lượng và số bản sao. Startup dọn log/artifact/profile kiểm thử cũ theo danh sách path cố định trong project; không duyệt hoặc xóa ngoài các root đó.
- Capture JSONL vẫn mặc định tắt và khi bật vẫn giữ giới hạn file hiện có.
- Extension queue phải bounded và non-blocking: khi backend mất kết nối, quote mới thay thế quote cũ cùng source hoặc loại bỏ bản cũ theo chính sách xác định; không tạo promise chờ vô hạn/`BRIDGE_QUEUE_FULL` storm.
- Tool chỉ đóng tab hoặc browser có marker ownership do tool tạo. Tab nhà cái do người dùng mở và Chrome profile mặc định không bao giờ bị kill.
- Khi shutdown, timer, debugger attachment, bridge socket và tab tool-owned phải được giải phóng best-effort; lỗi cleanup không được chặn shutdown.

## Verification

- Unit tests khóa HK conversion, stake anchor hai chiều, rounding 1.000 VND, outcome profits và fail-closed.
- Component tests khóa ROI từng vé, copy từng đội, state độc lập và layout không overflow.
- Script/API/extension tests khóa log retention, cleanup chỉ đúng root/process/tab sở hữu và queue không chờ vô hạn.
- Full web/API/extension tests, typecheck, build và runtime smoke phải xanh trước khi bàn giao.

## Explicit exclusions

- Không gửi lệnh cược thật.
- Không kill Chrome profile mặc định hoặc tab người dùng.
- Không mở rộng sang LoL hay odds format khác ngoài HK trong thay đổi này.
