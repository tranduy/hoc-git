# CPU và giật giao diện — 2026-09-09

Người dùng báo CPU nhảy 50–80%, giật cả Chrome/cả máy. Phạm vi đợt này là đo và bỏ
xử lý thừa khi web nhận danh mục; chưa chuyển sang SABA maintenance. IM vẫn tạm dừng.

## Bằng chứng

- Máy có 16 logical CPU, khoảng 32 GB RAM. Mẫu đầu ghi nhận API dùng khoảng 1,66 lõi,
  một Chrome renderer khoảng 1,82 lõi và hơn 4 GB RAM. Chưa xác định được renderer này
  tương ứng tab nào; không quy nó cho một sàn cụ thể.
- API profile 10,54 giây: `revisionFor` khoảng 26% inclusive; GC khoảng 1,59 giây self,
  merge catalog khoảng 1,46 giây self. Không cộng các số inclusive có quan hệ cha/con.
- Benchmark trên BTI 67.746 quote: serialize cache 80.793.776 byte / 514 ms.
  `saveCatalogCache` trước đây serialize toàn bộ danh mục sau mỗi update rồi mới bắt lỗi
  quota, nên lỗi localStorage không tránh được CPU và bộ nhớ đã cấp phát.
- Benchmark sửa đổi với BTI 67.686 quote: 1.000 lần cache guard tổng 0,508 ms, không có
  lần ghi storage; fingerprint cũ một lần 126,696 ms; 20.000 so sánh snapshot mới/304 bằng
  đường mới tổng 1,13 ms. Đây là benchmark các hàm bằng Node trên dữ liệu live, không phải
  thời gian render Chrome hoặc phép đo A/B CPU toàn máy.
- Thử thay object projection trong API hash bằng JSON replacer cho cùng revision nhưng
  chậm hơn (431 ms so với 310 ms); không áp dụng cách đó.

## Thay đổi

`catalog-cache.ts` đếm events/markets/quotes/native observations trước khi serialize.
Danh mục trên 5.000 record bỏ qua cache khởi động tùy chọn; cache nhỏ còn chặn trên
1.000.000 code unit trước khi ghi. Live catalog vẫn đầy đủ. Cache cũ giữ timestamp gốc
và vẫn được đánh dấu stale khi khôi phục.

`CatalogRevisionCache` nhớ revision API trong WeakMap theo object snapshot. Những API cũ
chỉ có `read()` và dữ liệu khôi phục vẫn tính fingerprint cũ, tối đa một lần mỗi snapshot.
Trang dùng `same()` để tránh dựng lại chuỗi danh mục ở các lần so sánh. Object 304 dùng
lại được nhận ngay. Snapshot mới khác observedAt/state không bị bỏ qua chỉ vì cùng giá.
Các response khác object nhưng cùng observedAt/revision vẫn so sequence/sourceTimestamp
của quote và observedAt của native observation, không dựng chuỗi phụ. Cổng chống response
cũ ghi đè dữ liệu mới được giữ lại.

Review độc lập phát hiện vấn đề clock trong bản dùng semantic revision đơn thuần;
đã sửa với ca tái hiện red→green và review lại không còn vấn đề quan trọng.

## Kiểm tra và áp dụng

- Cache, revision cache, coordinator và trang live catalog: 95 ca liên quan qua; 4 ca
  skip có sẵn. Có ca integration nguồn trở lại với revision giá không đổi nhưng clock mới.
- Web typecheck, Vite production build và `git diff --check` qua. Build vẫn có cảnh báo
  chunk lớn hơn 500 kB; đây không phải lỗi build.
- GET từ Vite xác nhận trang đang dùng revision cache, count guard và kiểm tra clock.
  Mã nguồn được phục vụ qua HMR; không restart stack/API/extension/tab nhà cái.
- Build kiểm tra nằm trong `.run/cpu-lag-2026-09-09/web-build/`; không thay production dist
  hoặc managed build identity của stack SBO 0.2.94 đang chạy.
- Browser tích hợp không khởi tạo được do lỗi metadata sandbox. Vì vậy chưa trực tiếp
  xác nhận HMR đã được nhận ở tab người dùng hoặc đo long task trong tab đó.
- Mẫu OS cuối 20 giây lúc 01:56: CPU cộng từ các process / 16 logical CPU khoảng 34,4%,
  Chrome cộng khoảng 15,8%, API khoảng 10,2% toàn máy. Có tải ứng dụng khác; đây không phải
  trần CPU hoặc phép đo A/B. Renderer 26068 trong mẫu đầu không còn ở mẫu cuối, chưa biết
  lý do và không dùng sự thay đổi đó làm bằng chứng bản sửa đã giảm tải renderer.
- Ba lần đọc trong khoảng 27 giây cuối: BTI/CMD/SBO đều LIVE/FRESH, tuổi evidence
  1.718–3.245 ms và có thay đổi quote trong cửa sổ 60 giây. API giữ PID 19292, heap
  khoảng 373–399 MB. Đây là kiểm tra nhanh luồng data, không phải nghiệm thu ổn định dài hạn.

Đây là sửa hai nguồn xử lý thừa đã đo được, chưa phải chứng minh loại hết giật hoặc đảm
bảo trần CPU toàn máy. Các mẫu OS có tải ứng dụng khác thay đổi; không dùng chúng để
khẳng định phần trăm cải thiện do riêng bản sửa. API hash/merge và các Chrome renderer
vẫn là những phần cần profile tiếp nếu triệu chứng còn. Không tăng tần suất request,
không nới freshness và không thêm reload cứng.

Artifact chỉ chứa số đo/hình dạng ở `.run/cpu-lag-2026-09-09/`: `profile-result.json`,
`bench-result.json`, `bench-web-result.json`, `os-after.json`, `os-final.json`, `live-check.json`.
Raw catalog/profile/provider URL/token không được ghi trong các artifact này.
