# Prompt giao cho Codex

Dán nguyên khối dưới đây. Nó tự chứa, không cần giải thích thêm.

---

```
Nhiệm vụ: làm cho dữ liệu giá của 6 sàn thật sự realtime.

Triệu chứng: kèo đã ẩn, đã đổi giá, hoặc đã đổi hệ số ở sàn, nhưng danh mục vẫn
giữ giá cũ. Nguồn vẫn gắn, khung vẫn về, mọi đèn đều xanh — chỉ là giá không đổi.
Giá cũ hiện ra như giá hiện tại là cách chế ra chênh lệch ảo, nên đây là lỗi
nghiêm trọng nhất trong hệ thống.

ĐỌC TRƯỚC KHI LÀM BẤT CỨ GÌ:
  docs/realtime-debug-spec.md   — quy trình, mô-típ lỗi, các phép đo, bẫy đã mắc
  docs/SESSION-STATE.md         — trạng thái hiện tại và lịch sử đã sửa
  CLAUDE.md                     — ràng buộc không được vi phạm

Làm LẦN LƯỢT TỪNG SÀN theo thứ tự: SABA → SBOBET → IM → BTI → CMD → APSPORT.
(SABA trước vì đang thấp nhất; CMD và APSPORT vừa sửa xong, chỉ cần xác minh.)

Với mỗi sàn, theo đúng mục 9 của spec:

 1. Chờ sàn có ít nhất 10 trận đang đá. Không có thì GHI RÕ "chưa đo được" và
    chuyển sàn khác — tuyệt đối không đoán, không ghi 0% rồi bảo nó hỏng.

 2. npx tsx .run/do-live-som.mts
    Ghi lại % cửa cược đổi giá trong 30 giây, CHỈ TÍNH TRẬN ĐANG ĐÁ.
    ≥20% là đạt. Đạt thì sang sàn tiếp theo.

 3. Chưa đạt: curl -s http://127.0.0.1:4310/api/diag/pipeline
    Tìm chặng hỏng đầu tiên.

 4. Nếu HOP4_ADAPTER có nhiều "ignored": ĐẶT TÊN CHO MỌI LỐI THOÁT CÂM trong
    adapter của sàn đó. Đây là bước quan trọng nhất — mọi `return []` và
    `return null` trần phải thành `this.#ignore("ly-do")` hoặc
    `noteRefusal("ly-do")`. Kèm SỐ ĐẾM khi con số quyết định cách sửa.
    Rồi build, deploy, đọc lại `ignoredEndpoints` và `contentRefusals`.

 5. Đọc tên lý do, đối chiếu mô-típ ở mục 2 của spec:
    "một tín hiệu KHÔNG CÓ HÀNG bị đọc thành LỖI, rồi vứt luôn cả thứ đi kèm".
    Ba biến thể: mã sentinel bị bộ đọc giá từ chối; trạng thái khoá bị coi là
    không đọc được; một dòng hỏng vứt cả lô.

 6. Sửa. Viết test. BẮT BUỘC kiểm test hỏng trên code cũ:
       git stash push -q <file sua>
       npx vitest run <file test>     # phải HỎNG
       git stash pop -q
       npx vitest run <file test>     # phải XANH
    Test không hỏng trên code cũ là test không chứng minh gì.

 7. npx tsc --noEmit -p apps/api   (vitest xanh KHÔNG có nghĩa là kiểu đúng)
    npm run build                  (script deploy KHÔNG tự dựng API)
    Deploy, chờ ÍT NHẤT 3 PHÚT, đo lại bằng bước 2.

 8. Sửa trong apps/chrome-extension thì phải build extension riêng
    (cd apps/chrome-extension && node scripts/build.mjs) và NHỜ NGƯỜI DÙNG
    RELOAD EXTENSION ở chrome://extensions. Restart API không đủ.

 9. Chỉ sang sàn tiếp theo khi sàn hiện tại đạt ≥20% VÀ giữ ổn định qua ít nhất
    5 lần đo cách nhau 40 giây. Có sàn hỏng kiểu "về một lần rồi thôi" — đo một
    lần rồi kết luận là sai.

RANH GIỚI KHÔNG ĐƯỢC VƯỢT:
  - Chỉ đọc. Không bao giờ đặt cược.
  - Không navigate/reload tab nhà cái. Người dùng tự làm.
  - KHÔNG dùng Playwright hay CDP gắn vào tab nhà cái. Chrome chỉ cho một client
    gỡ lỗi mỗi tab — làm vậy là đá extension ra và tự tạo đúng lỗi đang tìm.
  - Chẩn đoán chỉ ghi HÌNH DẠNG: tên trường, tên loại, số đếm. Không ghi giá trị,
    đích, header, token.
  - Không nới ngưỡng để làm đẹp số. Nâng cadence là nâng luôn cửa sổ tươi, tức
    cho giá cũ hiện thành giá hiện tại.
  - sảnh.md trong .gitignore, không commit. Token trong URL là bí mật.

BÁO CÁO: mỗi sàn ghi rõ % giá đổi TRƯỚC và SAU, kèm số đo thật. Không viết
"đã cải thiện" mà không có số. Sàn nào chưa đo được thì nói thẳng là chưa đo
được, đừng đoán.
```

---

## Ghi chú cho người giao việc

**Vì sao thứ tự là SABA trước:** đo 2026-08-29 cho thấy SABA chỉ 2,6–21% trong
khi CMD/BTI 24–79% trên cùng khung thời gian. Nó có 50 trận đang đá nên đo được
ngay, và là sàn nhiều trận nhất.

**Vì sao bắt đặt tên lối thoát trước khi sửa:** ba lỗi sửa trong ngày 2026-08-29
đều chỉ tìm được sau bước này. Trước đó APSPORT chỉ nói "bỏ qua 1.554 khung",
không lý do. Sau khi đặt tên, nguyên nhân hiện ra ngay dòng đầu tiên của báo cáo.

**Vì sao bắt kiểm test hỏng trên code cũ:** trong phiên 2026-08-29 có hai lần
test mới xanh cả trước lẫn sau khi sửa — tức không chứng minh gì. Bước kiểm này
bắt được cả hai.

**Vì sao cấm Playwright vào tab nhà cái:** APSPORT mất tab suốt một buổi vì
`chrome.debugger` không gắn được. Chrome chỉ cho một client gỡ lỗi mỗi tab. Gắn
công cụ ngoài vào là tái tạo đúng sự cố.
