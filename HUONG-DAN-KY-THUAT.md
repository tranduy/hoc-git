# Tool Chênh — Hướng dẫn kỹ thuật

Hệ thống theo dõi tỷ lệ cược thời gian thực trên nhiều sàn, phát hiện lúc hai sàn
lệch giá đủ để đặt cân hai cửa và có lãi ở mọi kết quả.

---

## 1. Nguyên lý: ăn ké đường ống của trình duyệt

Điểm mấu chốt: **không tự đăng nhập, không gọi API của sàn**. Người dùng tự mở
Chrome và đăng nhập; hệ thống đọc lại đúng những gói tin mà trình duyệt đã nhận.

```
Người dùng tự login sàn trên Chrome
        │   Chrome chạy kèm --remote-debugging-port=9222
        ▼
Node kết nối localhost:9222  (Chrome DevTools Protocol)
        │   Network.enable, rồi nghe:
        │     • Network.webSocketFrameReceived      ← sàn đẩy qua WebSocket
        │     • Network.responseReceived + loadingFinished + getResponseBody
        │                                           ← sàn trả qua XHR/fetch
        ▼
Adapter riêng từng sàn  →  quote đã chuẩn hóa
        ▼
Ghép trận  →  so tỷ lệ  →  phát hiện lệch giá  →  hiển thị + ghi log
```

Vì sao chọn cách này:

- **Độ trễ bằng đúng độ trễ người dùng thấy** — không phải hỏi lại server.
- **Không cần token, không giả mạo phiên**, không chạm CAPTCHA hay anti-bot.
- **Không phụ thuộc endpoint** — sàn đổi URL/domain vẫn chạy, miễn giao diện còn hoạt động.

Giới hạn: phải giữ Chrome mở, mỗi sàn một tab.

---

## 2. Khởi động

```bash
# 1) Chrome kèm cổng debug + profile riêng (profile giữ đăng nhập cho lần sau)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-odds-profile"

# 2) Trong cửa sổ đó: đăng nhập từng sàn, mở màn BÓNG ĐÁ TRỰC TIẾP, mỗi sàn một tab

# 3) Chạy hệ thống
npm run dev          # giao diện tại http://localhost:3399
npm run cli          # bản terminal, không cần trình duyệt
npm run replay       # phát lại capture đã lưu, không cần Chrome
```

Collector **tự dò tab theo domain** mỗi 5 giây — mở thêm tab sàn là nó tự bám,
không cần khởi động lại.

Biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CDP_PORT` | 9222 | cổng debug của Chrome |
| `BASE_STAKE` | 100000 | tiền cược gốc, đặt ở chân odds thấp hơn |
| `MIN_ROI_BEST` | 1 | bỏ qua kèo mà ROI tốt nhất dưới ngưỡng này (%) |
| `QUOTE_TTL` | 20 | quote cũ hơn (giây) thì không dùng để tạo tín hiệu |
| `QUOTE_MAX_AGE` | 45 | quote không được sàn nhắc lại quá lâu thì xóa khỏi bộ nhớ |

---

## 3. Cấu trúc mã

```
lib/cdp.js         kết nối CDP, nghe network, giữ tab "sống"
lib/adapters.js    mỗi sàn một adapter: payload thô -> quote chuẩn hóa
lib/core.js        quote book, chuẩn hóa tên, ghép trận, tính tiền/lợi nhuận
lib/collector.js   singleton điều phối, ảnh chụp trạng thái mỗi giây
app/               Next.js: SSE + giao diện tiếng Việt
recon.js           công cụ ghi lại traffic một sàn để giải mã schema
diag.js            xem một tab đang gọi những gì
diag-line.js       ĐO độ khớp line giữa các sàn — công cụ kiểm chứng quan trọng nhất
verify.js          đối chiếu lãi/ROI đã lưu với tính lại từ rate
test-replay.js     chạy adapter trên capture, không cần Chrome
```

Dữ liệu **nằm hoàn toàn trong RAM**, không dùng cơ sở dữ liệu. Chỉ `signals.jsonl`
ghi xuống đĩa (mỗi dòng một sự kiện phát/thu hồi) và được nạp lại khi khởi động,
nên thống kê không mất qua các lần restart.

---

## 4. Giữ cho dữ liệu chảy

Đây là phần tốn công nhất và ít ai lường trước.

**Vấn đề:** Chrome bóp timer của tab ở nền → sàn ngừng polling → dữ liệu đứng im.
Đo thực tế: một sàn không gọi API odds nào trong suốt 20 giây khi tab ở nền.

**Ba lớp xử lý, đều qua CDP, đều không đụng vào phiếu cược:**

1. **Chống bóp tab nền**
   ```js
   Emulation.setFocusEmulationEnabled  { enabled: true }
   Page.setWebLifecycleState           { state: 'active' }
   ```
   Trang nghĩ mình đang được nhìn nên tiếp tục cập nhật.
   *Tác động đo được: một sàn nhảy từ 126 lên 1012 trận.*

2. **Tự cuộn** khung danh sách mỗi 5 giây (xuống rồi lên).
   Lưu ý: có trang **không cuộn ở cấp `document`** — danh sách nằm trong khung con.
   Phải tìm mọi phần tử có `scrollHeight - clientHeight > 200` rồi cuộn chúng.

3. **Tự mở nhóm giải bị thu gọn.** Có sàn mặc định thu gọn phần lớn giải nên trận
   bên trong không render → không có kèo. Cần lưu ý:
   - Handler nằm ở **hàng tiêu đề giải**, không phải ở icon mũi tên.
   - Nhận biết đang mở bằng class chứa `ArrowExpanded`.
   - Click hàng loạt trong một lượt chỉ ăn được vài cái vì trang vẽ lại DOM →
     phải cài **vòng lặp chạy ngay trong trang**, mở từng giải cách nhau 400ms.
   - Chỉ **mở**, không bao giờ đóng. Click bằng `element.click()` đúng phần tử,
     **không click theo tọa độ** để không thể chạm nhầm ô odds.

---

## 5. Chuẩn hóa dữ liệu

Mọi sàn quy về một dạng khóa duy nhất:

```
`${AH|OU}_${FT|HT}|${line}`      ví dụ  "AH_FT|0.25"  "OU_HT|2.5"
```

- `line` **có dấu**, **dương = chủ nhà chấp** (thống nhất cho mọi sàn).
- `d1` = cửa chủ / Tài, `d2` = cửa khách / Xỉu, đều là **Decimal odds**.
- Odds Malay quy đổi: dương `m` → `1+m`; âm `m` → `1 + 1/|m|`.
- Mỗi quote lưu thêm `disp` / `disp2` = **chuỗi line đúng như sàn đó viết**
  (`-0/0.5`, `+1`, `2.5/3`) để người dùng tìm được trên phiếu cược.

Ký hiệu kiểu Á: `0/0.5` = `0-0.5` = **0.25** (vé chẻ đôi: nửa kèo 0, nửa kèo 0.5).

---

## 6. Ghép trận — điều kiện bắt buộc

Hai trận chỉ được coi là một khi **đồng thời**:

1. **Tên đội khớp** sau khi bỏ dấu, tách token.
   Token chung chung (`u19`, `u21`, `women`, `res`, `city`, `united`…)
   **không được tính là bằng chứng nhận dạng** — chỉ dùng để bắt buộc khớp hạng/giới.
   *Không có luật này, `Baltika U19 vs Shinnik U19` từng bị ghép với
   `Spartak Moscow U19 vs CSKA Moscow U19` chỉ vì cùng chứa `u19`.*
2. **Giờ bắt đầu** lệch không quá 90 phút.
3. **Cùng trạng thái** — một bên live, bên kia chưa đá thì cấm ghép.
4. **Tỉ số không mâu thuẫn** — khác tỉ số nghĩa là một sàn chưa cập nhật bàn thắng,
   odds hai bên đang tính trên hai bối cảnh khác nhau.

---

## 7. Tính lợi nhuận

Điều kiện có lãi khi đặt cân hai cửa đối nghịch ở hai sàn:

```
1/d1 + 1/d2 < 1
```

Chia tiền: đặt `BASE_STAKE` ở chân **odds thấp hơn**, chân kia `= base × d1/d2`
để hai cửa trả về xấp xỉ bằng nhau.

**Bắt buộc liệt kê MỌI kết quả thanh toán**, không chỉ hai cửa thắng/thua:

| Loại line | Các kết quả |
|---|---|
| `±0.5`, `±1.5` | 2 kết quả — sạch |
| `0`, `±1`, `±2` (nguyên) | 3 kết quả — **hòa đúng line thì hoàn cả hai vé, lãi 0** |
| `±0.25`, `±0.75` (lẻ ¼) | 4 kết quả — có "thắng nửa / hoàn nửa" |

Lấy **giá trị nhỏ nhất** trong tất cả làm lợi nhuận xấu nhất. Bỏ bước này thì một
kèo line 0 với Σ=0.77 sẽ báo "lãi 60.000đ" trong khi thực tế hòa là **huề vốn**.

---

## 8. Điều kiện thu hồi tín hiệu

Tín hiệu bị rút ngay khi mất bất kỳ điều kiện nào, kèm **lý do bằng chữ**:

- `giá đổi, hết chênh lệch` — một sàn vừa chỉnh giá
- `kèo biến mất khỏi sàn hoặc bị khóa`
- `dữ liệu quá hạn (sàn ngừng cập nhật)` — quá `QUOTE_TTL`
- `lợi nhuận tụt dưới ngưỡng`

Không có bộ nhớ đệm tín hiệu: toàn bộ được **tính lại từ đầu mỗi giây**.

---

## 9. Sáu cái bẫy đã gặp

Mỗi cái đều từng sinh ra "cơ hội" trông rất thật nhưng không tồn tại. Ai làm lại
hệ thống tương tự gần như chắc chắn sẽ gặp:

| # | Bẫy | Triệu chứng | Cách xử lý |
|---|---|---|---|
| 1 | **Dấu chấp ngược** | sàn A lưu line dương tuyệt đối + ký tự bên chấp, sàn B lưu line có dấu | quy tất cả về một hệ: dương = chủ chấp |
| 2 | **Sàn chào cả hai hướng chấp** | cùng line 0.25 có hai dòng odds khác hẳn nhau | ghép **chủ@L với khách@(−L)**, không gom theo line rồi lấy hai phần tử đầu |
| 3 | **Ghép nhầm trận** | hai trận khác nhau cùng chứa `u19` | token chung chung không phải bằng chứng; hạng/giới phải khớp tuyệt đối |
| 4 | **Bỏ qua push/void** | line nguyên báo lãi to, thực tế hòa là huề vốn | liệt kê mọi kết quả rồi lấy min |
| 5 | **Kèo cũ không bị xóa** | trận có bàn thắng, sàn dời thang line, line cũ vẫn nằm trong bộ nhớ với giá cũ | sàn gửi lại toàn bảng thì **thay nguyên bộ kèo**; kèo không có trong lần gửi là đã bị gỡ |
| 6 | **Trộn luồng live và pre-match** | cùng một trận có ở cả hai luồng, giá trước trận đè lên giá đang đá | không cho luồng "hôm nay" ghi đè trận đang live |

---

## 10. Cách kiểm chứng adapter

Đây là phần quan trọng nhất khi thêm sàn mới. **Không tin mắt, phải đo.**

```bash
node diag-line.js
```

So odds của **cùng một line** giữa các sàn:

- Chênh lệch trung vị **1–3%** → ánh xạ line và dấu chấp **đúng**
- **30–100%** → sai ở đâu đó, chưa được dùng

Đây là kiểm chứng độc lập rất mạnh: nhiều sàn không hẹn mà cùng ra một con số thì
khả năng cả nhóm cùng sai là rất thấp. Trong quá trình làm, chỉ số này đi từ
**125% xuống 1.4%** sau khi vá đủ sáu cái bẫy ở trên.

Hai công cụ bổ trợ:

```bash
node verify.js       # lãi/ROI đã lưu có khớp với tính lại từ rate không
node test-replay.js  # chạy adapter trên capture cũ, không cần Chrome
```

---

## 11. Thêm một sàn mới

1. **Ghi lại traffic** khi sàn đang có trận live:
   ```bash
   node recon.js --label <tên> --match <domain> --seconds 90
   ```
   File tự che token/cookie/session. Sàn nào chỉ đẩy delta thì **bật recon trước
   rồi F5** để bắt được bảng danh mục ban đầu.

2. **Giải mã schema** từ file capture — tìm: id trận, tên hai đội, trạng thái,
   tỉ số, loại market, phạm vi hiệp/trận, line, hai cửa, định dạng odds.

3. **Viết adapter** trong `lib/adapters.js`, đổ ra khóa chuẩn ở mục 5.

4. **Kiểm chứng** bằng `diag-line.js` — chưa xuống dưới ~10% thì chưa dùng được.

Cảnh báo: có sàn **đổi mã field theo từng phiên** (id trận hôm nay là field 1,
hôm qua là field 2). Với loại đó phải đọc bảng khai báo schema mà server gửi kèm,
không được hard-code số thứ tự.

---

## 12. Ranh giới

- **Chỉ đọc.** Không tự đăng nhập, không đặt cược, không click vào ô odds.
  Thao tác duy nhất trên trang là cuộn và mở nhóm giải trong danh sách.
- **Không hard-code** token, launch URL, hay endpoint động — mọi thứ đến từ phiên
  đăng nhập thật của người dùng.
- **Không lưu secret.** Công cụ recon tự che token/cookie/session trước khi ghi file.
- **Phát hiện thì real-time được, thực thi thì không đảm bảo.** Hai sàn độc lập
  không có giao dịch nguyên tử: giữa hai lần đặt, odds có thể đổi, kèo có thể khóa.
  Hệ thống chỉ giảm rủi ro (dữ liệu mới nhất, đặt chân dễ mất trước), không loại bỏ được.
