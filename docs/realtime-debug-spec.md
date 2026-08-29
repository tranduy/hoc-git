# Lấy dữ liệu realtime cho từng sàn — cách làm

Viết ngày 2026-08-29, sau khi sửa dứt điểm CMD và APSPORT bằng đúng quy trình này.
Mọi con số trong đây là số đo thật, không phải ước lượng.

---

## 1. Triệu chứng cần chữa

> Kèo đã ẩn, đã đổi giá, hoặc đã đổi hệ số ở sàn — nhưng danh mục vẫn giữ giá cũ.

Đây **không phải** lỗi "mất kết nối". Nguồn vẫn gắn, khung vẫn về, `decoded` vẫn
tăng. Chỉ là **giá không đổi**. Đó là lý do nó khó thấy: mọi đèn đều xanh.

Giá cũ hiện ra như giá hiện tại là cách chế ra chênh lệch ảo. Hôm nay có ba vé
"lãi" 16,46% / 55,60% / 15,66% đều sinh từ đúng chuyện này. Thà báo hỏng còn hơn
báo sai.

---

## 2. Mô-típ lỗi — tìm cái này trước

Cả ba lỗi sửa hôm nay đều **cùng một hình dạng**:

> **Một tín hiệu "không có hàng" bị đọc thành "lỗi", rồi vứt luôn cả thứ đi kèm.**

| sàn | tín hiệu bị đọc nhầm | hậu quả |
|---|---|---|
| CMD | `-999` (mã khoá kèo) — `finiteOdd` từ chối vì `\|x\| > 1` | **cả lô delta bị vứt**, mọi trận khác trong cùng phản hồi đứng giá |
| APSPORT | `state = "Suspended"` — bản ghi bị coi là không đọc được | khung bị vứt, **bản ghi cũ ở lại** với giá đã rút |
| APSPORT | template lệch thế hệ — coi như "chưa sẵn sàng" | thoát im lặng **vĩnh viễn**, cả vòng đời tab chỉ một lần roster |

Ba biến thể của cùng một sai lầm. Khi gặp "sàn đứng giá", **tìm mô-típ này trước
khi tìm lỗi giao thức.**

Hai biến thể phụ hay gặp:

- **Đòi đủ mới chịu phát** — một danh sách "mong đợi" chỉ phát khi có đủ mọi phần
  tử. Thiếu một là không phát gì. (`proofReady` của APSPORT dựa vào lượt quét DOM
  mà danh sách ảo hoá không bao giờ dựng đủ.)
- **Một dòng hỏng vứt cả lô** — vòng lặp `if (outcome === "INVALID") return []`.

---

## 3. Quy trình — làm đúng thứ tự này

### Bước 0. Đo trước, đừng đoán

```bash
npx tsx .run/do-live-som.mts
```

In ra, **chỉ tính trận đang đá**, số cửa cược đổi `rawOdds` trong 30 giây.

Kèo sớm ít nhảy nên **phải tách trận đang đá ra**, nếu không sẽ kết luận sai.
Sàn không có trận live thì **không đo được** — đừng ghi 0% rồi bảo nó hỏng.

Ngưỡng đọc:
- **> 20%** — realtime tốt
- **0% mà có ≥10 trận đang đá** — hỏng, đi tiếp bước 1

### Bước 1. Hỏi đường ống, đừng mò code

```bash
curl -s http://127.0.0.1:4310/api/diag/pipeline
```

Đọc theo thứ tự, dừng ở chặng hỏng đầu tiên:

| chặng | ý nghĩa khi hỏng |
|---|---|
| `HOP1_TAB` | **không có tab**. Extension chưa gắn được debugger. Xem mục 5 |
| `HOP3_ENVELOPE` | khung không về. Xem `byTransport`, `wsAttach` |
| `HOP4_ADAPTER` | khung về mà không giải mã. **Đây là chỗ hay hỏng nhất** |
| `HOP6_FEED` | giải mã được nhưng feed không nhận. Xem `baselineAgeMs` |
| `HOP7_CATALOG` | danh mục có nhưng bị đánh STALE |

### Bước 2. Bắt mọi lối thoát câm phải khai tên

**Đây là bước quan trọng nhất, và là thứ làm cả ba lỗi hôm nay tìm được.**

Trước khi đặt tên, APSPORT chỉ nói *"bỏ qua 1.554 khung"* — không lý do, không
cách nào truy. Sau khi đặt tên, nguyên nhân hiện ra ngay dòng đầu.

Trong adapter, mọi `return []` / `return null` trần đều phải đổi thành:

```ts
return this.#ignore("ten-ly-do-ngan-gon");
```

Và mọi chỗ từ chối nội dung:

```ts
return noteRefusal(`ly-do-${...}`);
```

Rồi đọc lại:

```
HOP4_ADAPTER.ignoredEndpoints   →  /ignored/<ly-do>   (adapter tự bỏ)
                                   /route-<ly-do><đường dẫn>  (bộ định tuyến từ chối)
HOP4_ADAPTER.contentRefusals    →  vì sao khung không phải bản ghi bóng đá
```

**Bẫy đã mắc:** đừng gộp hai điều kiện khác nhau vào một nhãn. Có lần tôi viết
`if (a === null || !b.has(x)) return ignore("khong-co-trong-roster")` — hai
nguyên nhân cần hai cách sửa ngược nhau, mà chỉ có một tên. Tách ra.

**Nhớ kèm số đếm khi con số quyết định cách sửa:**

```ts
return this.#ignore(`socket-not-in-roster-of-${state.rosterEventIds.size}`);
```

Roster rỗng và roster đầy mà không khớp là hai lỗi khác hẳn nhau.

### Bước 3. Đo tốc độ tăng, không đọc số tuyệt đối

Số tích luỹ nói dối — dư âm lúc khởi động lẫn vào. Chụp hai lần cách 45 giây rồi
lấy hiệu:

```
proof-not-ready  +0 / 45 giây   → đã hết, chỉ là dư âm
proof-not-ready  +18 / 45 giây  → vẫn đang xảy ra
```

### Bước 4. Sửa — và luôn viết test hỏng trên code cũ

Test không hỏng trên code cũ là test không chứng minh gì. Luôn kiểm:

```bash
git stash push -q <file sửa>
npx vitest run <file test>     # phải HỎNG
git stash pop -q
npx vitest run <file test>     # phải XANH
```

### Bước 5. Đo lại bằng chính bước 0

Và với sàn hay "về một lần rồi thôi", phải theo dõi **nhiều phút**:

```bash
# xem baselineAgeMs co lap lai khong, hay chi giam mot lan roi tang mai
```

---

## 4. Thước đo — đọc kỹ mục này trước khi kết luận sàn nào đạt

Realtime không phải "giá có nhúc nhích". Realtime là hai điều, và phải đo riêng:

**A. Kèo đã đóng phải bị GỠ khỏi danh mục.**
Không phải để lại với giá cũ. Một kèo đã rút mà còn nằm đó là một dòng chênh lệch
hoàn toàn bịa. Đây là tiêu chí **quan trọng nhất**.

**B. Giá hiển thị phải đúng bằng giá đang treo ở sàn.**
Không phải "gần đúng", không phải "mới cách đây vài chục giây".

```bash
# A. Keo dong co bi go khong  <-- PHEP DO CHINH
npx tsx .run/do-go-keo.mts 60000

# B. Gia hien thi co dung gia that khong: doc lich su nguoi dung bam kiem tra
#    %LOCALAPPDATA%	ool-chenh\logsealtime-ticket-checks.jsonl

# C. Duong ong hong o chang nao
curl -s http://127.0.0.1:4310/api/diag/pipeline

# D. Phep thu khoi: nguon co dung hinh hoan toan khong
npx tsx .run/do-live-som.mts
```

### Đọc kết quả A

`do-go-keo.mts` đếm trên **trận đang đá**, trong 60 giây:

| cột | ý nghĩa | ngưỡng |
|---|---|---|
| `GO` | cửa cược biến mất khỏi danh mục | **phải > 0** |
| `dong-con-nam` | đã chuyển SUSPENDED nhưng còn đó | chấp nhận được |
| `giu nguyen` | cùng giá, cùng trạng thái | > 85% là đáng ngờ |

**`GO` = 0 trên hàng nghìn cửa đang đá là hỏng, không cần bằng chứng gì thêm.**
Một sàn live luôn đóng cửa liên tục — mỗi bàn thắng, mỗi thẻ đỏ, mỗi lần treo để
chỉnh giá. Đo 2026-08-29: APSPORT gỡ 40,4%, BTI 7,3%, CMD 4,8%, SABA **0,0%**.

### Đọc kết quả B

Mỗi lần bấm "Kiểm tra giá thật" ghi `verificationStatus`:

- `MISMATCH` → **luôn là tool sai.** Giá trong danh mục khác giá trên sàn.
- `NOT_FOUND` → **phải đối chiếu với phép đo A trước khi kết luận.**
  Sàn có `GO` > 0 thì `NOT_FOUND` thường là đầu đọc không thấy dòng đó trên màn hình.
  Sàn có `GO` = 0 thì `NOT_FOUND` là **kèo đã đóng mà danh mục vẫn giữ** — đúng
  cái lỗi đang đi tìm.

### Vì sao KHÔNG lấy "% giá đổi" làm tiêu chí đạt

`do-live-som.mts` chỉ là **phép thử khói**. Nó có hai điểm mù cố hữu:

1. Nó bỏ qua mọi cửa cược **biến mất** (`if (p === undefined) continue`), nên nó
   không hề đo việc gỡ kèo.
2. 58% đổi giá vẫn có thể đi kèm 42% đứng im sai.

Dùng nó để bắt nguồn đứng hình **hoàn toàn**, rồi chuyển sang A và B.

---

## 5. Khi `HOP1_TAB` báo không có tab

Extension không gắn được `chrome.debugger`. Theo thứ tự:

1. **Kiểm tra DevTools (F12) có đang mở trên tab đó không.** Chrome chỉ cho **một
   client gỡ lỗi trên mỗi tab** — DevTools mở là extension bị chặn hoàn toàn.
   Code đã ghi: *"A DevTools-owned target is not ours to reclaim."*
2. Bấm `Reload` cạnh tên sàn trên bảng.
3. Reload extension ở `chrome://extensions`.

**Vì lý do (1), tuyệt đối không dùng Playwright hay CDP gắn vào tab nhà cái để gỡ
lỗi** — làm vậy là đá extension ra, tự tạo đúng lỗi đang đi tìm.

---

## 6. Ranh giới không được vượt

- **Chỉ đọc.** Không bao giờ đặt cược.
- **Không navigate/reload tab nhà cái** như một phần của deploy. Người dùng tự làm.
- **Chẩn đoán chỉ ghi hình dạng** — tên trường, tên loại, **số đếm**. Không ghi
  giá trị, đích, header, token.
- **Không nới ngưỡng để làm đẹp số.** Nâng cadence cho sàn "trông" khoẻ hơn là
  nâng luôn cửa sổ tươi — giá cũ hiện thành giá hiện tại.
- `sảnh.md` chứa URL sảnh thật, trong `.gitignore`, **không commit**. Token trong
  URL là bí mật.

---

## 7. Bẫy đã mắc — đừng lặp lại

1. **Đo một khoảnh khắc rồi kết luận.** Đã nhiều lần báo "5/6 sàn chạy" đúng lúc
   chúng đang lên. Số thật qua 6 giờ khác hẳn.
2. **Đo ngay sau khi deploy.** Restart làm mọi sàn tụt. Chờ ít nhất 3 phút.
3. **Không tách trận đang đá.** Kèo sớm ít nhảy; gộp vào là kết luận sai.
4. **Đọc số tích luỹ thay vì tốc độ tăng.** Dư âm khởi động lẫn vào.
5. **Tin phép chuẩn hoá của mình thay vì của code.** Từng dùng hàm gấp chữ riêng
   rồi kết luận sai về ghép trận.
6. **`tr -d '\000'` khi xem file.** Kho này dùng byte NUL làm dấu phân cách khoá.
   Xoá nó khi hiển thị là đọc nhầm code thành lỗi. Đã mắc một lần.
7. **Sửa xong quên chạy `tsc`.** `vitest` xanh không có nghĩa là kiểu đúng.
8. **Deploy mà quên `npm run build`.** Script deploy **không tự dựng API**.

---

## 8. Trạng thái từng sàn (2026-08-29)

| sàn | cách lấy | tình trạng | còn lại |
|---|---|---|---|
| **CMD** | HTTP `DataOdds.ashx` + delta | ✅ 26–79% | dấu line FH_AH sai ở vài trận hiếm (2/732 hàng) |
| **BTI** | HTTP list + detail | ✅ 24–67% | cửa "đòi đủ mới phát" ở `bti-http-adapter.ts:113` chưa xác minh |
| **APSPORT** | HTTP roster/detail + socket | ✅ 20–59% | đã sửa dứt điểm, đo lại cuối ngày vẫn 58,7% |
| **SABA** | socket + DOM overlay | ⚠ 2,6–21% | thấp hơn hẳn CMD/BTI, **cần soi tiếp** |
| **SBOBET** | socket.io | ❓ chưa có trận live để đo | |
| **IM** | HTTP `GetSE` / `GetSEDelta` | ❓ chưa có trận live để đo | |

---

## 9. Quy trình chuẩn cho từng sàn

Làm **lần lượt từng sàn**, không gộp. Với mỗi sàn:

1. Chờ sàn có ≥10 trận đang đá. Không có thì **bỏ qua, ghi rõ "chưa đo được"** —
   đừng đoán.
2. Chạy `do-live-som.mts`. Ghi lại % giá đổi.
3. Nếu < 20%: chạy `/api/diag/pipeline`, tìm chặng hỏng đầu.
4. Nếu `HOP4_ADAPTER` có nhiều `ignored`: **đặt tên mọi lối thoát câm** trong
   adapter của sàn đó rồi build + deploy + đọc lại.
5. Đọc tên lý do, tìm mô-típ ở mục 2.
6. Sửa. Viết test. **Kiểm test hỏng trên code cũ.**
7. Build, deploy, chờ 3 phút, đo lại bằng bước 2.
8. Nếu là sửa trong `apps/chrome-extension` — **phải build extension riêng và
   nhờ người dùng reload extension**, API restart không đủ.

Chỉ chuyển sang sàn tiếp theo khi sàn hiện tại **đo được ≥20% và giữ ổn định qua
ít nhất 5 lần đo cách nhau 40 giây**.
