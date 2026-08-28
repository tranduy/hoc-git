# tool-chenh

Hệ thống phát hiện chênh lệch giá giữa nhiều nhà cái, thời gian thực. Extension Chrome
quan sát các tab đã đăng nhập qua `chrome.debugger` (chỉ đọc, không bao giờ đặt cược),
API giải mã và dựng danh mục, web so sánh giữa các sàn.

## Đọc trước khi làm

**`docs/SESSION-STATE.md`** — trạng thái hiện tại của 6 sàn, việc còn lại theo thứ tự,
cách đo, và những cái bẫy đã mắc. Đọc file đó thay vì dò lại từ đầu.

`docs/apsport-handoff-codex.md` — riêng APSPORT.

## Nguyên tắc không được vi phạm

- **Chỉ đọc.** Không đặt cược, không navigate/reload tab nhà cái như một phần của deploy.
- **Chẩn đoán chỉ ghi hình dạng** — tên trường, tên loại, số đếm. Không ghi giá trị,
  đích, header, token.
- **Không nới ngưỡng để làm đẹp số.** Giá cũ hiện ra như giá hiện tại là cách chế ra
  chênh lệch ảo. Thà báo hỏng còn hơn báo sai.
- `sảnh.md` chứa URL sảnh thật — trong `.gitignore`, không commit.

## Đo, đừng đoán

```bash
curl -s http://127.0.0.1:4310/api/diag/pipeline
```

Mọi cửa thất bại im lặng đều khai tên: `ignoredEndpoints` (`/route-…`, `/ignored/…`),
`contentRefusals`, `catalogShape`, `snapshotRejections`.

`.run/realtime/stability.jsonl` — soak liên tục theo từng sàn.

**Đừng đo trong 10 phút sau một lần deploy.** Restart làm mọi sàn tụt.

## Thước đo

Số **dòng ghép chéo giữa các sàn**, không phải số trận của một sàn.
