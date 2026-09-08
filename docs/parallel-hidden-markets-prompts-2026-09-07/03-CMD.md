Bạn phụ trách DUY NHẤT sàn CMD trong dự án tool-chenh. Đây là yêu cầu thực hiện, không chỉ lập kế hoạch. Mục tiêu là hoàn thành thu thập toàn bộ kèo bóng đá prematch sàn cung cấp, gồm kèo ẩn, đồng thời duy trì cập nhật giá thực theo nhịp 3 giây khi có thay đổi. Không chờ SABA hoàn thành toàn bộ nhiệm vụ mới làm phần độc lập.

ĐIỀU CHỈNH PHÂN CÔNG: Đọc thêm bản hiện hành tại F:\0. PROJECT\tool-chenh\docs\parallel-hidden-markets-prompts-2026-09-07\05-TIEP-TUC-DEN-NGHIEM-THU.md. LOCAL_READY chỉ là mốc trung gian; worker vẫn chịu trách nhiệm hoàn thiện sàn đến nghiệm thu thực tế. Bản điều chỉnh thay các giới hạn cũ về sửa tệp chung trong checkout riêng; không tự thay quyền runtime trong ledger.

BỐI CẢNH VÀ QUYỀN LÀM VIỆC
- Repo đang chạy: F:\0. PROJECT\tool-chenh. SABA đang sửa dở; AP đã có nghiệm thu coverage. Cây mã có nhiều thay đổi chưa commit ở cả tệp riêng và tệp chung.
- Bốn worker là BTI, SBOBET, CMD, IM. Tạm thời phiên SABA là đầu mối duy nhất giữ cây tích hợp và môi trường chạy, cho đến khi có bàn giao rõ ràng. Không tự coi mình là integrator.
- Đọc tài liệu nhiệm vụ hiện hành: docs/superpowers/specs/2026-09-06-complete-binary-prematch-market-coverage-design.md và plan cùng tên. Báo cáo cũ là bằng chứng lịch sử, không phải nghiệm thu bản hiện tại.
- Prompt này là phân công mới cho vòng song song; quy trình cũ của các đợt trước không được tự đổi vai trò hoặc cho worker quyền triển khai chung.

TÁCH MÃ VÀ PHỐI HỢP
1. Đọc bảng bàn giao tại F:\0. PROJECT\tool-chenh\.run\parallel-hidden-markets-2026-09-07\HANDOFF.md nếu có. Bảng phải ghi baseline, thư mục worker, integrator và đường dẫn ledger runtime chung.
2. Chỉ sửa trong checkout/snapshot riêng dành cho CMD, xuất phát từ baseline nhất quán đã công bố, gồm các sửa đổi chưa commit cần thiết. Không tự dùng HEAD cũ rồi coi đó là mã hiện tại; không stash/reset/checkout/commit hộ cây đang chạy. Không chuyển cuộc hội thoại SABA hoặc di chuyển thay đổi của nó.
3. Nếu chưa có baseline/handoff, tiếp tục điều tra chỉ đọc, xác định phạm vi và dữ liệu cần thiết; báo thiếu baseline. Chưa sửa cây chung hay tự dựng baseline từ các tệp đang thay đổi không nhất quán.
4. Phạm vi tệp riêng được nêu ở cuối prompt. Không sửa tệp chung trong cây đang chạy. Trong checkout riêng, được sửa điểm nối và test ở tệp chung cần thiết cho sàn mình, kể cả network-observer.ts; xuất diff riêng để review/ghép, không đổi nền realtime/config/manifest hay làm lại provider khác. Với phần dùng chung AP/SABA, kèm regression liên quan.
5. Worker tự hoàn thiện module cmd, callback/request/subscription thực tế, điểm nối collector và test đường đi vào catalog/revision trong checkout riêng. Bàn giao patch chạy được và bằng chứng, không chỉ mô tả rồi chuyển phần triển khai còn thiếu cho SABA. Người tích hợp chịu trách nhiệm review, giải quyết giao thoa và áp dụng patch đã review; lỗi/nghi vấn riêng sàn trả về đúng worker sửa.
6. Build/test chỉ dùng cây riêng, output riêng, không liên kết dist có thể ghi ngược cây đang chạy. Giới hạn test khoảng 1–2 worker mỗi phiên, tránh chạy cả monorepo liên tục khi các phiên khác cũng kiểm thử.
7. Worker không build vào dist đang phục vụ, không chạy start:live/restart/handoff, không reload extension, không đổi capture filter chung, không dừng tiến trình chung. Không dùng ledger riêng của worktree để tự nhận quyền triển khai.
8. Điều tra nguồn thật là việc đầu của worker, không đợi ghép code xong mới đề nghị. Đọc RUNTIME-LEDGER.md hiện hành để dùng ngay cửa sổ còn hiệu lực của đúng sàn. Nếu thiếu, ghi vào STATUS.md của mình nguồn/tab, thao tác cụ thể, phương tiện truy cập hiện có, câu hỏi cần xác minh và khoảng đo đề nghị; phân biệt điều tra nguồn với nghiệm thu bản đã triển khai. Không tự chiếm debugger, điều hướng/reload/đăng nhập lại, mở runtime mới hoặc mở rộng quyền đã cấp. Khi chờ, tiếp tục phân tích dữ liệu đã được phép đọc và công việc độc lập. Không đặt cược; không ghi credential hoặc raw launch token vào báo cáo.
9. Chỉ ghi gói bàn giao của mình vào thư mục trao đổi riêng do integrator công bố. Không chỉnh báo cáo/trạng thái của worker khác.

GIỮ NGUYÊN CƠ CHẾ REALTIME 3 GIÂY ĐÃ TRIỂN KHAI
- Người dùng xác nhận phần realtime 3 giây đã được triển khai ở phiên trước. Nhiệm vụ hiện tại là hoàn thiện coverage và đưa kèo ẩn vào cơ chế đó, không xây lại realtime hoặc mở một dự án nghiệm thu lại toàn bộ hệ thống.
- Luồng hiện có: ChromeCatalogDataPlane -> CatalogRevisionStore -> WebSocket /api/realtime -> CatalogRevisionCoordinator -> catalog/UI/comparisonWorker. Đọc apps/api/src/server.ts, apps/api/src/realtime/opportunity-ws.ts, apps/web/src/api/client.ts, apps/web/src/catalog/catalog-revision-coordinator.ts và apps/web/src/pages/live-catalog-page.tsx để hiểu điểm nối; đây là tệp chung chỉ đọc đối với worker.
- Trang hiện đặt minimumPublishIntervalMs: 3_000 và fallbackMs: 3_000. Giữ nguyên cấu hình, publication/revision, WebSocket, coalescing, chống request trùng, retry/reconnect/fallback và cách chỉ cập nhật khi dữ liệu thay đổi. Không dựng pipeline, socket hay timer song song để thay thế.
- Cấu hình 3.000 ms điều tiết công bố/cập nhật phía ứng dụng. Không diễn giải thành mọi provider phải phát socket hoặc quét toàn bộ detail đúng mỗi 3 giây; không tự thay yêu cầu “giữ nhịp 3 giây như hiện tại” bằng một SLA mới áp lên mọi request và mọi điểm đo.
- Giữ transport nguồn đúng như hiện có: socket push/subscription hoặc HTTP có xác thực tùy provider. Khi có thay đổi giá/line/status, kèo ẩn phải đi qua cùng đường ingest, revision và cập nhật hiện hành bằng đúng identity.
- Luồng detail phục vụ discovery/coverage không được chặn luồng giá chính, làm chậm cập nhật đang hoạt động, xoá detail-only vì main feed không chứa nó, hay ghi đè giá mới bằng detail cũ.
- Nghiệm thu là kiểm tra hồi quy và mở rộng: kèo cũ vẫn cập nhật như baseline, kèo ẩn mới cũng nhận thay đổi thật sau lần tải đầu và xuất hiện qua nhịp cập nhật hiện có. Không coi “tải đủ một lần” là đã hoàn tất nếu kèo ẩn không tiếp tục nhận giá.
- Đo riêng độ trễ nhận dữ liệu nguồn, ingest, API và UI khi có bằng chứng; giữ số đo thật và nêu giới hạn. Không dùng observedAt mới cho cache cũ, replay response cũ như giá mới, nới TTL để che stale hoặc chỉ nhìn timer giao diện để tuyên bố mọi giá đều mới.
- Nếu tìm thấy kèo ẩn chưa được subscription/refresh hoặc chưa tham gia revision hiện hành, sửa phần provider tối thiểu trong phạm vi; phần chung gửi integrator cùng regression. Không tự sửa cadence/recovery/core realtime, không làm lại phần đã xong, không chặn việc độc lập chỉ để audit lại sáu sàn.
- Không hạ yêu cầu chính xác/realtime để đạt coverage. Nếu kèo mới chưa đạt mức cập nhật người dùng yêu cầu, báo rõ identity/điểm đứt/độ trễ và phần còn thiếu, chưa ghi DONE. Tuân thủ single-flight, cancellation, timeout/backoff hiện có; không tạo bão request để ép số đo.

ĐỦ KÈO VÀ ĐÚNG DỮ LIỆU
- Đối chiếu roster hiện tại -> từng detail/nhóm ẩn -> native market/selection -> catalog công bố. Có mẫu số thật và liệt kê phần còn thiếu.
- Mọi kèo sàn trả phải được chuẩn hoá, loại có lý do, hoặc giữ dưới dạng chưa ánh xạ. Không âm thầm bỏ nhóm lạ; không đoán tương đương chỉ từ nhãn dịch.
- Giữ đúng trận, đội, thống kê bàn/góc/thẻ, hiệp, line, cửa và cách thanh toán. Kèo ba cửa, không tương đương hoặc có hoàn tiền vẫn được ghi nhận nhưng không ép vào so sánh nhị phân không hoàn tiền.
- Xử lý xoá/đóng/đổi line bằng bằng chứng có thẩm quyền; shallow roster không xoá detail-only; giá mới của main feed không bị detail cũ ghi đè.
- Kiểm tra huỷ generation cũ, reconnect, phản hồi trễ/sai thứ tự, prematch chuyển live, chi tiết rỗng hợp lệ và lỗi request. Không quảng bá dữ liệu cũ thành fresh sau phục hồi.

CÁCH LÀM VÀ BÀN GIAO
- Bắt đầu bằng kiểm tra code hiện có; không viết lại collector đã có khi chưa tìm nguyên nhân thiếu kèo/giá.
- Thông báo phát hiện sớm, phạm vi tệp, giả thuyết, điểm chờ tích hợp và dự trù sau vòng điều tra đầu. Không chạy vòng sửa-thử vô hạn mà không có bằng chứng mới.
- Viết regression có ý nghĩa cho lỗi xác định; chạy test/typecheck cần thiết trong cây riêng. Trách nhiệm kéo dài qua điều tra nguồn, sửa code, hoàn thiện điểm nối, hỗ trợ tích hợp, đo live và sửa lỗi còn lại đến khi nghiệm thu sàn; giữ phần đã làm, không khởi động lại nhiệm vụ từ đầu.
- Bàn giao từng mốc: baseline ID, diff provider và diff phần chung tách riêng, test/kết quả thực, bằng chứng nguồn và việc chưa đạt. LOCAL_READY chỉ xác nhận một gói code/test sẵn sàng review, không kết thúc trách nhiệm. WAITING_INTEGRATION/WAITING_LIVE phải có yêu cầu cụ thể, người xử lý và điều kiện tiếp tục. Kiểm tra ledger ở mốc bàn giao và khi được tiếp tục; không lặp test hay polling liên tục để chờ. Nếu không còn thao tác được phép, báo đang bị chặn và cách mở chặn, không báo hoàn tất và không hứa tự đánh thức tab đã dừng.
- Chỉ ghi DONE sau nghiệm thu trên build integrator công bố: coverage có mẫu số, native rows được giải trình đầy đủ, giá/line/status khớp, kèo cũ giữ hành vi realtime đã có và kèo ẩn mới tham gia cùng luồng cập nhật 3 giây; AP/SABA không bị hồi quy do thay đổi. Báo độ trễ thực và so với baseline; không gộp chu kỳ nguồn, chu kỳ quét detail và nhịp publish UI thành một số để kết luận sai.
- Với khoảng đo ổn định, ưu tiên 10–15 phút có cập nhật giá thật và đủ nhóm kèo đã thu; đây là bằng chứng giới hạn theo cửa sổ đo, không phải cam kết 24/24. Không lặp lại toàn bộ vòng đo nếu không có thay đổi hay câu hỏi mới.
- Nếu build/source epoch đổi giữa chừng, phân tách cửa sổ bằng chứng và nghiệm thu lại phần liên quan; không trộn mẫu của các bản.
- Thiếu phiên đăng nhập hoặc quyền nghiệm thu live không ngăn phần phân tích/code/test độc lập; báo rào cản cụ thể, không bịa kết quả.

PHẦN RIÊNG CMD
- Lobby CMD; account catalog-source:CMD:FOOTBALL. Xác minh đúng nguồn/tab trước kiểm tra live.
- Kiểm tra toàn bộ prematch roster, các control/nhóm chi tiết ẩn, pseudo-event góc/thẻ và liên kết trận gốc. Sweep phải có bằng chứng hoàn tất thật, không dựa trên trang đang thấy.
- Đọc cmd-dom-snapshot, đường HTTP/DOM adapter và dữ liệu giá hiện tại. DOM mới render không tự chứng minh giá nguồn mới.
- Chứng minh full sweep không làm chậm cập nhật giá; các mảnh snapshot chỉ ghép cùng generation; dữ liệu từ view hẹp không xoá nhóm chưa duyệt; market removal chỉ từ partition có thẩm quyền.
- Nếu mở control gây thay đổi trang/nguồn đang dùng, đề nghị cửa sổ kiểm tra đúng tab qua integrator. Không thao tác tab SABA/AP.
- packages/adapters/src/cmd/cmd-normalizer.ts có normalizeObservedFootballCatalog và observeNativeCmdMarkets đang được SABA sử dụng. Đây là tệp chung thực tế: gửi đề nghị/patch tối thiểu cho integrator cùng regression SABA, không tự coi là tệp riêng chỉ vì tên cmd.

PHẠM VI TỆP RIÊNG
- apps/api/src/providers/cmd/cmd-browser-manager.ts
- apps/api/src/providers/cmd/cmd-catalog-source.ts
- apps/api/src/providers/cmd/cmd-observed-catalog.ts
- apps/api/src/chrome-bridge/cmd-http-adapter.ts
- apps/api/src/chrome-bridge/cmd-dom-adapter.ts
- apps/chrome-extension/src/cmd-dom-snapshot.ts
- apps/chrome-extension/src/cmd-snapshot-poller.ts
- apps/chrome-extension/src/cmd-snapshot-chunker.ts
- Test tương ứng, fixture đã loại dữ liệu nhạy cảm và báo cáo cmd riêng trong checkout.
- Module collector/discovery/refresh mới có tiền tố cmd- trong apps/chrome-extension/src nếu cần; tự hoàn thiện điểm nối ở tệp chung trong checkout riêng và xuất patch riêng để review/ghép.
