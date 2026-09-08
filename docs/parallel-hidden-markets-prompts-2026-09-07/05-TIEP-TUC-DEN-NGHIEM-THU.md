# Điều chỉnh trách nhiệm — tiếp tục công việc đang có

Bản này sửa phân công của vòng song song ngày 2026-09-07. Không mở lại nhiệm vụ, không bỏ patch đã viết. Việc cập nhật file này không tự gửi tin hay đánh thức những cuộc hội thoại đã dừng; mỗi phiên cần thực sự nhận chỉ dẫn đọc lại.

## Kết quả phải đạt và người làm

Mỗi worker BTI/SBOBET/CMD/IM chịu trách nhiệm sàn của mình xuyên suốt: xác minh nguồn thật và toàn bộ roster/detail/nhóm ẩn; hoàn thiện request/subscription/refresh; nối collector vào đường ingest/catalog/revision đã có; kiểm chứng đủ và đúng kèo, giá/line/status tiếp tục cập nhật qua cơ chế 3 giây hiện hành; xử lý stale, mất kết nối, đổi phiên và phục hồi để sàn tiếp tục hoạt động. Không dồn điều tra endpoint, viết callback, nối collector hoặc đo live về SABA.

LOCAL_READY chỉ là mốc review code. Test giả lập không thay thế bằng chứng nguồn thật; module chỉ nhận callback từ caller nhưng chưa có caller thực tế vẫn là phần chưa hoàn thiện. Worker tiếp tục sửa sau review/tích hợp và tự thực hiện nghiệm thu đúng nguồn được phân công.

Trong checkout riêng, worker được viết cả patch nối tối thiểu và test ở tệp chung. Tách diff đó khỏi patch provider để người tích hợp review và ghép có kiểm soát. Không áp dụng vào cây đang chạy, không ghi đè sửa đổi của người khác. Không đổi cơ chế realtime, cadence, cấu hình triển khai chung hoặc sửa sàn khác để mở rộng phạm vi.

## Điều tra nguồn và chạy song song

Đọc HANDOFF.md và RUNTIME-LEDGER.md tại thư mục tuyệt đối:
F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07

Dùng ngay grant còn hiệu lực cho đúng nguồn/tab/build/epoch và đúng thao tác. Điều tra request/detail/subscription phải được đề nghị sớm, độc lập với cửa sổ nghiệm thu sau triển khai. Worker tự nêu câu hỏi, thao tác và phương tiện truy cập cần dùng trong STATUS.md của chính mình. Nếu read-only không đủ để xác minh request, mô tả chính xác probe/mở nhóm/subscription cần thực hiện; không tự bịa endpoint hoặc chuyển câu hỏi đó cho SABA giải quyết thay.

Chủ runtime xác nhận khả năng truy cập và phân công theo nguồn. Các phép đọc nguồn riêng có thể cùng thực hiện nếu kênh truy cập hiện có cho phép và không tranh debugger/controller hay đổi trạng thái chung. Chỉ xếp lịch tuần tự cho thao tác thực sự xung đột. Không lấy việc SABA chưa xong làm điều kiện chặn tất cả điều tra sàn khác.

Bản này không tự cấp quyền tab, debugger, điều hướng, startup, capture filter, build hay restart; quyền vận hành thực tế vẫn lấy từ ledger của chủ runtime. Không copy phiên đăng nhập hoặc dựng thêm runtime gắn vào Chrome đang dùng chung.

## Tích hợp và vận hành chung

Phiên đã soạn các prompt này nhận việc review và chuẩn bị gói tích hợp tách biệt, dùng baseline/hash rõ ràng; không phải phiên SABA và không tự nhận quyền cây tích hợp hay runtime. Worker vẫn sửa mọi lỗi riêng sàn được review phát hiện, kể cả lỗi wiring. Review không được biến thành chuyển toàn bộ phần còn thiếu sang người review.

SABA tiếp tục nhiệm vụ SABA. Theo ledger hiện tại, SABA vẫn là chủ duy nhất của cây chạy và build/restart. Phần cần SABA phối hợp là phân công quyền truy cập nguồn, xác nhận mốc mã hiện hành và cửa sổ áp dụng/triển khai an toàn của gói đã chuẩn bị. Không yêu cầu SABA tự điều tra hoặc hoàn thiện bốn sàn. Nếu chuyển quyền cây tích hợp/runtime cho phiên khác, phải có xác nhận bàn giao cụ thể của chủ hiện tại; file này không phải xác nhận đó.

Không build/restart trong cửa sổ đo đang được bảo vệ. Sau triển khai công bố build/epoch; từng worker đo sàn mình và tiếp tục sửa nếu chưa đạt. Không buộc đợi đủ bốn gói mới review, cũng không ghép gói chưa rõ request/authority chỉ vì đã pass test.

## Điều kiện nghiệm thu

- Có mẫu số roster/detail/native thật, đối chiếu các nhóm ẩn và giải trình phần không ánh xạ/loại trừ; đúng trận, hiệp, line, cửa, giá và trạng thái.
- Kèo ẩn mới tiếp tục nhận biến động thật sau lần lấy đầu, đi qua cơ chế realtime 3 giây đã triển khai; không chỉ chứng minh timer chạy hoặc làm mới timestamp cache. Đo các chặng có bằng chứng và báo thiếu/sai/độ trễ thật.
- Có đường phục hồi và kiểm chứng mất kết nối/đổi phiên/response trễ trong phạm vi được cấp; không quảng bá dữ liệu cũ thành mới, không cần thao tác tay liên tục để tiếp tục thu.
- Báo riêng thời lượng vận hành thực tế đã quan sát, lỗi và trạng thái phục hồi. Mục tiêu vận hành liên tục 24/7 vẫn giữ nguyên; một cửa sổ 10–15 phút không phải bằng chứng đã chạy đủ 24 giờ.
- Chỉ ghi DONE khi các tiêu chí chức năng và nghiệm thu đã đạt; mọi giới hạn vận hành dài hạn còn lại phải nêu đúng. Giữ WAITING với rào cản và bước tiếp tục cụ thể khi thật sự thiếu quyền/dữ liệu, không đổi thành hoàn tất.

## Hai tin nhắn ngắn để tiếp tục phiên đang có

Gửi worker cần tiếp tục (dùng cùng nội dung, không mở tab mới):

> Tiếp tục sàn đang phụ trách từ code hiện có. Đọc F:\0. PROJECT\tool-chenh\docs\parallel-hidden-markets-prompts-2026-09-07\05-TIEP-TUC-DEN-NGHIEM-THU.md và ledger runtime hiện hành. LOCAL_READY chưa xong nhiệm vụ. Tự hoàn thiện nguồn thật, collector/wiring trong checkout riêng, cập nhật kèo ẩn qua realtime 3 giây và phục hồi vận hành; dùng grant đúng sàn còn hiệu lực, ghi chính xác thao tác cần cấp nếu thiếu. Không chuyển phần triển khai còn lại cho SABA, không restart chung.

Chỉ dẫn cập nhật cho phiên SABA để thống nhất phân công, không yêu cầu làm lại:

> Tiếp tục SABA, giữ nguyên công việc và các cửa sổ đã cấp. Đọc F:\0. PROJECT\tool-chenh\docs\parallel-hidden-markets-prompts-2026-09-07\05-TIEP-TUC-DEN-NGHIEM-THU.md. Bốn worker tự hoàn thiện cả nguồn thật, wiring, nghiệm thu và sửa lỗi sàn mình; phiên soạn prompt nhận review/chuẩn bị gói tích hợp riêng. Bạn chỉ phối hợp quyền nguồn, mốc mã và triển khai chung theo ledger, không nhận làm thay bốn sàn. Đây chưa phải bàn giao quyền runtime; không cần dừng hay làm lại SABA.
