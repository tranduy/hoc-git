# Bảng trạng thái — mỗi dòng một số, mỗi số một lệnh tự kiểm

Checkbox trong `docs/superpowers/plans/*.md` **không phải thước đo**: nhiều plan ghi
`0/67` trong khi mã đã chạy đủ. Không ai cập nhật chúng. File này thay thế, và chỉ
nhận một dòng là XONG khi có **số đo được** kèm **lệnh tái lập**.

Cập nhật lần cuối: 2026-09-15. Nhánh `feat/realtime-hardening`.

## Lệnh đo chính

```bash
npx tsx scripts/measure-cross-book-rows.ts
```

Số quan trọng nhất nó in ra: `ROWS ACROSS BOOKS` và khối `by edge`.

```bash
curl -s http://127.0.0.1:4310/api/diag/pipeline
curl -s http://127.0.0.1:4310/api/catalog/sources
curl -s http://127.0.0.1:4310/api/sessions
```

> **Đừng đo trong 10 phút sau deploy.** Restart làm mọi sàn tụt về 0.

---

## XONG — có số, đã kiểm trên bản chạy thật

| # | Việc | Số đo được | Kiểm bằng |
|---|---|---|---|
| 1 | Đo được bảng ghép ngoài trình duyệt | **15.257** dòng / 740 trận | `measure-cross-book-rows.ts` |
| 2 | Chặn sàn chết khỏi ghép (IM cũ 55,7 giờ) | kèo dương **80 → 13** | khối `by edge` |
| 3 | Phiên quá hạn phải tự khai | **6/6** sàn báo `reason=EXPIRED` | `/api/catalog/sources` |
| 4 | Feed sống không được bảo lãnh cho phiên chết | `overlayStatuses` giữ `EXPIRED` | `/api/catalog/sources` |
| 5 | Tách một mã từ chối gộp ba vấn đề | preflight trả `CATALOG_SOURCE_SECRET_UNAVAILABLE` | `POST /api/preflight/provider` |
| 6 | Thôi báo lịch 03:00 không tồn tại | `scheduledHour` **3 → null** | `/api/maintenance` |
| 7 | Đường gia hạn chỉ-phiên (Task 5 của plan 2026-08-17) | chạy, fail-closed, ghi journal | `%LOCALAPPDATA%/tool-chenh/maintenance/events.jsonl` |
| 8 | CMD: đếm phủ sóng theo **trận**, không theo **event id** | `partialWanted` **68 → 0** | `CMD_NATIVE[...]` trong `/api/diag/pipeline` |
| 9 | Chặn giá in-play lệch đồng hồ (hai lớp) | kèo dương **10 → 3**, cao nhất **66,25% → 0,31%**, in-play dương **0** | khối `by edge` + `positive rows by phase` |
| 10 | APSPORT: kèo in-play của cùng một trận lệch nhau ~50.000 sequence | p50 **49.680** so với **0** ở CMD/SBOBET/BTI, **74** ở SABA | `coherentLiveQuotes` |

## ĐANG CHẠY — đã giao nhưng **chưa** chứng minh hết

| # | Việc | Tình trạng thật |
|---|---|---|
| 11 | SABA: set ảnh chụp DOM bị xé | Mới **đặt tên** cửa (`DOM_SET_TORN_<LOADER\|GENERATION\|PROBE>_AT_n_OF_m`), **chưa sửa gốc**. Thử nâng ba cửa ra ngoài vòng lặp → hỏng một bảo đảm an toàn có chủ ý, đã hoàn nguyên. Chưa lần nào kích hoạt kể từ khi nạp lại. |

## CHƯA LÀM — có bằng chứng dẫn đường, không cần mò

| # | Việc | Bằng chứng | Giá trị |
|---|---|---|---|
| 12 | `FT_HALF_FULL_RESULT` dùng chung tên selection `HOME_AWAY` | 324 quote, trung vị **46,9**, tất cả > 2,0 | **Chưa kiểm** có đường nào ghép nhầm nó với `DRAW` của 1X2 không |
| 13 | CMD: 26 trận không có kèo More | 26/652, khớp sàn khác 26/26, trung bình 2,5 dòng so với 12,6 | ≈ **170/15.408 dòng (1,1%)** — nhỏ |

## CHẶN — không sửa được bằng mã

| # | Việc | Vì sao |
|---|---|---|
| 14 | **0 lệnh đặt được** | 61 phiên, **0 dùng được**. `ExecutionLegAdapter` chỉ có `dryRun`. |
| 15 | Gia hạn phiên FABET | Cần đăng nhập — tôi không làm. Và mọi egress đều hỏng: `FABET_AUTH_PROXY_URL` chưa đặt, `FABET_LOCAL_WARP_AUTH` chưa đặt (dù `warp-cli` đã cài). Một biến môi trường. |
| 16 | Chứng minh giá hiển thị đặt được | Hệ thống **chỉ đọc**. Giới hạn thiết kế, vĩnh viễn. |

## KHÔNG PHẢI CỦA TÔI

| # | Việc | Ghi chú |
|---|---|---|
| 17 | 9 test đỏ / 4 file (`replay-harness` ×6, `sbobet-*` ×3) | Stash mã của tôi chạy lại vẫn đỏ y hệt. Việc đang dở của phiên song song. |
| 18 | `wip/apsport-supplement-2026-09-14` (`3fbb508`), 4 nhánh `worker/*-hidden-20260907`, 2 worktree | Của phiên khác. Không gộp, không xoá. |

## TRẦN NHÀ CÁI — đã chứng minh, đừng đào lại

| Việc | Số |
|---|---|
| CMD: trận ngoài 72h bị chính sách PASSIVE loại | **392** (cố ý) |
| SABA: More mở ra rỗng | 52/52 |
| SABA: giải góc trong feed | 0 |
| IM | Anh bảo bỏ |

---

## Điều đã nói sai trong phiên 2026-09-15, giữ lại để đừng lặp

- **"Lịch 03:00 bị xoá nhầm"** — sai, gỡ **có chủ ý**, lý do ghi ngay tại chỗ gọi.
- **"CMD walk đứng im"** — sai, `started:0` là ảnh chụp tức thời, `due:1`.
- **"16 chữ số thập phân = giá bịa"** — sai, 931/942 quote APSPORT đều vậy.
- **"Ô chứa quote của line khác"** — sai, `candidates=1`, line khớp hết.
- **"APSPORT live còn sàn khác prematch"** — sai, `rows split on phase: 0`.
- **"4 quote `HOME_AWAY` của APSPORT sai"** — sai quy mô. Là **nửa số trận đang đá**
  của APSPORT lệch sequence nội bộ; 4 quote chỉ là phần nhô lên trên mặt nước.
- **"SABA gấp 2,6 lần là nhờ bản vá"** — sai, do extension nạp lại, không phải mã tôi sửa.
- Không thấy log `[fabet-auth]` **không chứng minh được gì**: child stderr đi `stdio: "inherit"`, không vào file.
