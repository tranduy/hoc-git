# Realtime Recovery — điều phối

Mục tiêu cuối: **6 sàn cung cấp odds realtime liên tục 24/7, giá đổi trên sàn thì
tool đổi theo trong SLA, không cần người can thiệp.**

## Vì sao lần này khác lần trước

Tuần trước năm worker viết ra hàng nghìn dòng state machine, đạt 2555/2555 test
xanh và 6/6 workspace typecheck xanh — trong khi sản phẩm chạy **0/6**. Nguyên
nhân không phải năng lực:

1. **Test là mô phỏng khép kín.** Mọi test nạp envelope viết tay, nên chúng không
   thể đỏ khi envelope thật không bao giờ tới.
2. **Không có thước đo.** Pipeline 8 chặng, mỗi chặng nhiều nhánh fail-closed,
   không có cách nào biết nó chết ở chặng nào. Ai cũng phải đoán.
3. **Whitelist tạo deadlock.** Ba trên năm provider bị chặn ở các file shared mà
   chính họ không được phép sửa, chờ một "root" là phiên chat sẽ reset.
4. **Cổng nghiệm thu đo sai thứ.** PASS dựa trên cờ `LIVE`/`ACTIVE`/`FRESH`, và
   `quoteChanges` được ghi lại rồi bỏ qua — nên "pass" không chứng minh giá chạy.

Lần này ba thứ đổi: **có ground truth đo thật từ provider** (`00-EVIDENCE.md`),
**có thước đo 8 chặng** (BASE Task B1), và **nghiệm thu bắt buộc phải thấy giá
đổi thật** (BASE Task B5).

## Cách chạy hiện hành (chốt 2026-08-25 21:15)

**6 worker chạy song song, mỗi worker đi hết đường của provider mình**: diag → fix →
test → tự build → tự restart → tự nghiệm thu → `PROVISIONAL_ACCEPTANCE` →
`READY_FOR_24H_SOAK`. Không worker nào chờ Opus, không worker nào chờ worker khác.

Chỉ một điểm nối tiếp: **build + restart** dùng chung một stack nên phải xếp hàng qua
deployment lease sẵn có. Bận thì chờ 60 giây thử lại, tối đa 10 lần. Worker không sửa
code thì không cần deploy.

Chống giẫm chân: mỗi worker ghi `buildIdentity` từ `/api/health` trước và sau cửa sổ
nghiệm thu. Nếu `buildIdentity` đổi giữa chừng (worker khác vừa deploy) thì **làm lại
cửa sổ 10 phút**, không tính kết quả cũ.

Chủ sở hữu file shared: **tab SBOBET** giữ `network-observer.ts`, `background.ts`,
`tab-registry.ts`, `server.ts`. Năm tab kia cấm đụng.

## Thứ tự cũ theo giai đoạn (tham khảo)

```
Giai đoạn 1   1 tab Codex làm BASE
              ↓
              Opus review → ghi BASE_APPROVED
              ↓
Giai đoạn 2   6 tab Codex song song, mỗi tab 1 provider
              mỗi tab: INVESTIGATED → LOCAL_GREEN → dừng
              ↓
              Opus review từng provider → deploy gộp 1 lần
              ↓
Giai đoạn 3   6 tab chạy nghiệm thu đồng thời trên cùng build
              mỗi tab tự chứng minh PROVISIONAL_ACCEPTANCE
              ↓
              Opus review toàn bộ → soak 24 giờ
              ↓
              READY_FOR_24H_SOAK → (sau 24h) → DONE
```

**Không mở tab provider nào trước khi có `BASE_APPROVED`.** Nếu mở sớm, các worker
lại rơi vào cảnh đoán mò như tuần trước.

## Tài liệu

| File | Nội dung |
|---|---|
| `00-EVIDENCE.md` | Ground truth đo thật từ 6 provider. **Đọc trước tiên.** |
| `01-BASE.md` | 6 task hạ tầng + định nghĩa nghiệm thu dùng chung |
| `PROVIDER-CMD.md` | HTTP ~30 s, policy quá chặt |
| `PROVIDER-IM.md` | HTTP, provider **không tự cập nhật** — mong manh nhất |
| `PROVIDER-BTI.md` | HTTP ~15 s có gap 30 s, đồng thời là guard hồi quy |
| `PROVIDER-SABA.md` | Socket.IO khỏe mạnh, schema field động |
| `PROVIDER-SBOBET.md` | STOMP/SockJS trong OOPIF, hai socket, full snapshot lặp |
| `PROVIDER-APSPORT.md` | WS 6 socket theo môn, authority kẹt `CANDIDATE` |

---

## Prompt cho tab BASE

```text
Mở F:\0. PROJECT\tool-chenh. Đọc theo đúng thứ tự và đọc hết:
1. docs/superpowers/plans/2026-08-25-realtime/00-EVIDENCE.md
2. docs/superpowers/plans/2026-08-25-realtime/01-BASE.md

Bạn là phiên BASE duy nhất. Làm lần lượt Task B1 đến B6 trong 01-BASE.md, theo
đúng thứ tự, không nhảy cóc, không làm thêm việc ngoài sáu task đó.

Ràng buộc cứng:
- Không sửa bất kỳ file *-ws-adapter.ts hoặc *-http-adapter.ts nào.
- Không build, không restart stack, không reload extension, không chạy lệnh Git
  thay đổi trạng thái.
- Không reload/điều hướng/đóng tab provider.
- Không log token, cookie, launch URL, header auth hay raw body provider.
- Mỗi task phải có bằng chứng chạy thật dán vào report. Cấm dán output bịa.

Sau mỗi task, dừng lại và ghi kết quả vào
docs/superpowers/reports/realtime/base.md theo mẫu:
  TASK <id> <DONE|BLOCKED> — <bằng chứng cụ thể>

Khi xong cả sáu, ghi BASE_READY_FOR_REVIEW rồi dừng. Không tự tuyên bố hoàn thành.
```

## Giao thức đồng bộ một-lần (fix → deploy → nghiệm thu)

Sáu tab chạy song song, **không** cần người điều phối giữa chừng.

1. **Mốc build.** Ngay khi bắt đầu, mỗi tab ghi lại `buildIdentity` hiện tại:

   ```powershell
   curl.exe -s http://127.0.0.1:4310/api/health
   ```

2. **Chỉ tab SBOBET được build + restart.** Nó sở hữu file shared
   (`network-observer.ts`, `background.ts`, `tab-registry.ts`, `server.ts`). Xong thì
   ghi `.run/realtime/DEPLOYED.json` gồm `buildIdentity` mới + thời điểm.

3. **Năm tab kia chờ có giới hạn.** Sau khi xong phần whitelist của mình, poll
   `/api/health` mỗi 60 giây, tối đa 45 phút. `buildIdentity` đổi → vào nghiệm thu.
   Hết 45 phút mà không đổi → vẫn nghiệm thu trên build hiện tại và ghi rõ điều đó.

4. **Nghiệm thu giống nhau cho cả sáu**, xem `01-BASE.md` mục
   `PROVISIONAL_ACCEPTANCE`. Không tab nào được ghi `DONE`.

## Prompt cho 6 tab provider

Thay `<X>` / `<x>` bằng một trong: `CMD`/`cmd`, `IM`/`im`, `BTI`/`bti`,
`SABA`/`saba`, `SBOBET`/`sbobet`, `APSPORT`/`apsport`.

**Chrome user + extension + stack đã mở sẵn.** Worker **cấm**
`scripts/recon-provider-realtime.mjs`. **Cấm hỏi user** khi `firstFailingHop: null`.

```text
Mở F:\0. PROJECT\tool-chenh. KHÔNG worktree.

BẮT BUỘC LÀM THEO PLAN 100%. Không bịa task, không thêm bước, không "cải tiến",
không đổi kiến trúc, không brainstorming, không diễn giải lại spec.
CẤM dùng skill using-superpowers / executing-plans / brainstorming / using-git-worktrees.
CẤM hỏi user chọn hướng / chờ chỉ thị. Tự quyết theo nhánh A/B/C/D bên dưới.
PROVIDER-<X>.md + 01-BASE.md là luật. Mâu thuẫn với plan thì ghi BLOCKED rồi DỪNG,
không tự quyết ngoài plan.

Đọc hết, đúng thứ tự:
1. docs/superpowers/plans/2026-08-25-realtime/00-EVIDENCE.md
2. docs/superpowers/plans/2026-08-25-realtime/01-BASE.md
3. docs/superpowers/plans/2026-08-25-realtime/PROVIDER-<X>.md

Bạn chỉ sở hữu <X>. Chỉ sửa file trong whitelist của PROVIDER-<X>.md.
Report duy nhất: docs/superpowers/reports/realtime/<x>.md

Làm đúng thứ tự:
0. GATE 0 — curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources
   Rỗng hoặc không có source lobby mình → ghi BLOCKED_ENV + output, DỪNG NGAY.
   CÓ lobby mình (kể cả CANDIDATE) → đi tiếp. HOP1_TAB null lúc này là bẫy
   telemetry đã biết (diag chỉ thấy slot ACTIVE) — KHÔNG phải BLOCKED_ENV.
1. INVESTIGATED — CẤM scripts/recon-provider-realtime.mjs (spawn Chrome → duplicate).
   Dùng 00-EVIDENCE.md + capture có sẵn
   %LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\.
   Chỉ record-capture.mjs nếu CDP http://127.0.0.1:9333 đã sẵn (attach, không launch).
   Không CDP → bỏ capture mới, ghi INVESTIGATED từ evidence rồi sang bước 2.
2. node scripts/diag-pipeline.mjs <X> <duration> — ghi FULL vào report.
3. Áp nhánh quyết định A/B/C/D/E (bắt buộc, CẤM hỏi user):
   A) Ghi firstFailingHop + HOP8.quoteChanges + authority + baseline age +
      recovery/forcedUnlocks (nếu có). Cấm bịa số.
   B) Nếu quoteChanges=0 / baseline không làm mới / authority kẹt CANDIDATE|NONE /
      recovery storm → 1 giả thuyết trong PROVIDER-<X>.md → 1 RED → 1 fix whitelist →
      test focused + typecheck → đo lại live HOP8.
      CẤM dùng replay làm cổng: mọi capture hiện có đều NETWORK_BODY_INCOMPLETE
      nên semanticChanges luôn 0 (khiếm khuyết BASE B3, không phải lỗi provider).
   C) Chặng hỏng thật null + HOP8.quoteChanges60s > 0 ở >= 3 lần đo cách nhau
      >= 60 giây → LOCAL_GREEN <X> — NO_CODE_CHANGE kèm sampleChange, DỪNG.
      CẤM bịa RED, CẤM sửa code cho có.
   D) sources RỖNG + byTransport toàn 0 + lastEnvelopeAgeMs hàng trăm giây
      → BLOCKED_ENV (môi trường), DỪNG. Chỉ dùng khi GATE 0 rỗng.
   E) Chặng hỏng nằm ngoài whitelist → SHARED_REQUEST: file + lý do + hop,
      DỪNG chờ Opus. CẤM tự sửa file shared, CẤM RED giả trong whitelist.

Khác biệt số bước giữa prompt và PROVIDER-<X>.md KHÔNG phải mâu thuẫn.
Prompt thắng. CẤM ghi BLOCKED chỉ vì thứ tự bước.

CẤM: build, restart, reload extension, Git commit/push, sửa ngoài whitelist,
reload/navigate/đóng tab sàn, log token/cookie/URL, spawn Chrome/Playwright, ghi DONE.
Cờ LIVE/ACTIVE/FRESH ≠ thành công. Chỉ HOP8 giá đổi thật mới là bằng chứng.
Cấm dán output bịa.
```

Duration / assert theo provider: CMD `120` / `3` · IM `180` / plan · BTI `300` / plan ·
SABA `180` / `5` · SBOBET `180` / `5` · APSPORT `180` / `10`.

---

## Vai trò của Opus

- Duyệt BASE trước khi mở worker.
- Xử lý mọi yêu cầu shared (file ngoài whitelist) — đây là chỗ tuần trước bị
  deadlock, lần này phải giải quyết ngay khi có yêu cầu.
- Thực hiện toàn bộ build / restart / reload extension. Worker không bao giờ làm.
- Duyệt bằng chứng của từng provider trước khi cho vào vòng nghiệm thu chung.
- Duyệt SLA mà mỗi worker đề xuất — bác bỏ mọi SLA đặt rộng để che lỗi.
- Ghi `DONE` sau soak 24 giờ. Không ai khác được ghi.

## Ba câu hỏi Opus dùng để bác bỏ một báo cáo

Bất kỳ báo cáo nào không trả lời được cả ba đều bị trả lại:

1. `firstFailingHop` **trước** khi sửa là gì, và bằng chứng nào chứng minh?
2. Test RED có đỏ vì lý do đúng không, hay đỏ vì import/fixture sai?
3. Sau khi sửa, `HOP8.quoteChanges60s` là bao nhiêu trên **runtime thật**, và giá
   trước/sau của một selection cụ thể là gì?
