# PROMPT ĐIỀU PHỐI 5 WORKER REALTIME

File này là nguồn prompt duy nhất để mở lại năm Codex tab. Không dùng lại các
prompt cũ trong lịch sử chat.

## Cách dùng

Paste đúng một dòng tương ứng vào từng Codex tab:

- SABA: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và mục SABA, rồi tự thực hiện lại task SABA đến live DONE.`
- CMD: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và mục CMD, rồi tự thực hiện lại task CMD đến live DONE.`
- APSPORT: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và mục APSPORT/TSPORT, rồi tự thực hiện lại task APSPORT đến live DONE.`
- IM: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và mục IM, rồi tự thực hiện lại task IM đến live DONE.`
- SBOBET: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và mục SBOBET/KSPORT, rồi tự thực hiện lại task SBOBET đến live DONE.`

Không paste cả năm role vào cùng một tab. Mỗi tab chỉ nhận một role.

---

# COMMON CONTRACT — BẮT BUỘC CHO CẢ 5 WORKER

## 1. Kết quả cần đạt

Bạn sở hữu một sàn từ chẩn đoán đến bằng chứng realtime của app chính đã build.
Không được dừng ở các trạng thái “code xong”, “test pass”, “report xong”,
`READY_FOR_INTEGRATION` hoặc “chờ integrator test live”.

`DONE` chỉ hợp lệ khi chính worker đã chứng minh trên app đang chạy:

1. exact bridge source có `authorityDisposition: ACTIVE`;
2. catalog source có `sessionState: ACTIVE`, không có reason và catalog không rỗng;
3. baseline authoritative thuộc source epoch hiện tại;
4. provider-native cursor/evidence tiến ít nhất ba lần trong cửa sổ 120 giây;
5. semantic price/status đổi khi provider phát thay đổi; heartbeat, ACK, replay hoặc DOM không đổi không được tính;
6. targeted recovery của đúng source tạo baseline generation mới mà không thay source của sàn khác;
7. BTI vẫn `ACTIVE` trong toàn bộ lần acceptance;
8. acceptance dùng đúng build identity và exact source/tab đã pin.

Nếu gate live fail: kết thúc acceptance lease, quay lại diagnose → RED → fix →
deploy → barrier → acceptance. Giữ report là `IN_PROGRESS`. Chỉ dùng `BLOCKED`
khi đã chứng minh lỗi external auth/provider mà code và same-tab recovery không
thể khắc phục. Không biến external failure thành thành công.

## 2. Workspace và branch chung

```text
Workspace: F:\0. PROJECT\tool-chenh
Branch: feat/six-provider-realtime-feed
```

- **Mỗi** `shell_command`/tool call phải đặt `workdir` trực tiếp thành exact
  repo root trên. Không được giả định `Set-Location` hoặc biến PowerShell từ lần
  gọi trước còn tồn tại, vì mỗi tool call có thể chạy trong process mới. Nếu tool
  không có trường `workdir`, prefix ngay trong **cùng invocation**:

  ```powershell
  $repoRoot = 'F:\0. PROJECT\tool-chenh'
  Set-Location -LiteralPath $repoRoot
  if ((Get-Location).Path -ne $repoRoot) { throw 'WRONG_SHARED_WORKTREE' }
  ```

  Lặp lại assertion repo root trong từng invocation có lease, mutation, test,
  build, restart, reload, recovery hoặc sampler. Mọi path tương đối bên dưới
  phải được resolve từ exact repo root trong chính invocation đó, không phải cwd
  mặc định khác của Codex tab.
- Làm ngay trong repo root/branch trên; không tạo linked worktree hoặc branch mới.
- Không dùng hash base cũ `f6e25d4` trong prompt cũ.
- Năm worker dùng chung filesystem; thay đổi của một worker hiện ngay với bốn worker còn lại.
- Root integrator là người duy nhất được stage/commit và sửa shared-base files.

## 3. Tài liệu phải đọc đầy đủ, đúng thứ tự

Trước mọi chỉnh sửa, đọc hết các file sau, không chỉ đọc tiêu đề:

1. `F:\0. PROJECT\tool-chenh\proccess.md` — COMMON CONTRACT và đúng role của bạn;
2. `docs/superpowers/tasks/five-provider/common.md`;
3. `docs/superpowers/tasks/five-provider/ownership.md`;
4. `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`;
5. `docs/superpowers/plans/2026-08-24-five-provider-parallel-runtime.md`;
6. task file riêng của role;
7. report file riêng của role.

Preflight phải hoàn tất trước khi lấy edit lease hoặc thực hiện bất kỳ mutation,
build, restart, reload, recovery hay acceptance nào:

1. xác minh `$repoRoot` tồn tại và cả sáu tài liệu repo-rooted của role đều
   resolve thành file thật;
2. đọc toàn bộ các file đó từ `$repoRoot`;
3. xác minh common/coordinator hiện tại có executable stable-runtime barrier,
   root base deployment đã được ghi nhận và app đang ở managed state v2;
4. nếu một điều kiện thiếu, báo đúng `SHARED_BASE_PREFLIGHT_FAILED` kèm tên điều
   kiện, giữ report `IN_PROGRESS` và không sửa/build/restart/reload gì cả.

Worker không được tự đọc `.auth` để kiểm tra state v2. Chỉ dùng public health,
coordinator preflight/barrier command được common document quy định và thông báo
base-ready của root.

Report cũ chỉ là lịch sử/chứng cứ tham khảo. Không được tin verdict cũ hoặc lấy
focused tests cũ thay cho live acceptance mới. Bắt đầu bằng cách kiểm tra trạng
thái app/runtime hiện tại.

## 4. Quyền file và lease

- Chỉ sửa đúng whitelist ghi trong role và `ownership.md`; dùng `apply_patch`.
- Mỗi coherent patch phải giữ provider edit lease từ trước khi sửa đến hết RED/GREEN,
  focused tests, typecheck, scoped diff-check và secret scan.
- Release edit lease trong `finally` trước khi chờ, build/deploy hoặc acceptance.
- Không tự mở rộng whitelist. Shared defect phải ghi exact file/symbol/failing test
  vào report và báo root; tiếp tục phần provider-local không phụ thuộc defect đó.
- Không chạy Git mutation: `add`, `commit`, `reset`, `restore`, `checkout`, `stash`,
  `merge`, `rebase`, `clean`, `push`. Chỉ được dùng read-only status/diff nếu task
  yêu cầu kiểm tra phạm vi.
- Không sửa `dist` trực tiếp/manual và không tạo build artifact khi thiếu deployment
  lease. `npm.cmd run build` được phép regenerate `dist` **chỉ** bên trong guarded
  deployment transaction. Không sửa `.auth`, `.run` state, coordinator state hoặc
  file của worker khác. Runtime sampler được phép ghi đúng ignored evidence file
  của role.
- Sau khi kết thúc acceptance, phải lấy lại edit lease mới được sửa report tracked.

## 5. Browser/runtime

- Năm provider phải nằm ở năm Chrome tab riêng. Chỉ điều khiển exact tab/source
  của role; cấm active-tab fallback.
- Cấm mở DevTools hoặc chiếm debugger/CDP vì extension observer đang sở hữu attachment.
- Cấm in/đọc/lưu token, cookie, signed URL, raw body hoặc credential.
- Không reload/navigate provider tab. Targeted recovery dùng exact source API trong
  task. Provider launch refresh chỉ dành cho source đã được chứng minh missing,
  expired hoặc auth-invalid.
- Khi giữ deployment lease, worker được build/restart app và reload đúng duy nhất
  unpacked-extension card trỏ tới
  `F:\0. PROJECT\tool-chenh\apps\chrome-extension\dist`.
  Đây là ngoại lệ duy nhất ngoài provider tab; không reload extension khác.
- Nếu gặp `LEGACY_STACK_REQUIRES_ROOT_HANDOFF`, dừng mọi runtime mutation và báo
  root. Worker không được đọc/xóa/sửa `.auth`; root phải hoàn tất handoff v2 trước.

## 6. Luồng làm việc bắt buộc

1. Chạy preflight ở mục 3; thiếu tài liệu, managed-v2 hoặc barrier thì không mutation.
2. Dùng `systematic-debugging` và read-only runtime/code inspection để xác định
   invariant live đang fail. Nếu việc tái hiện cần viết/chỉnh test thì chưa làm ở bước này.
3. Lấy provider edit lease **trước mọi file mutation**. Quy tắc này override mọi
   câu mơ hồ trong task/common cũ.
4. Khi edit lease còn hiệu lực, thêm/chạy focused RED tái hiện đúng lỗi.
5. Sửa production tối thiểu trong whitelist bằng `apply_patch`.
6. Chạy focused GREEN, typecheck, scoped diff-check và secret scan khi lease còn hiệu lực.
7. Release edit lease trong `finally`; không để lease hết hạn cùng patch dở.
8. Lấy deployment lease và thực hiện nguyên transaction trong `common.md`:
   `npm.cmd run build` → set exact `TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN` →
   zero-argument `node scripts/restart-live-stack.mjs` → reload đúng extension
   card → xác minh `/api/health.buildIdentity` → release/abort lease trong `finally`.
9. Sau lần deploy cuối của role, chờ stable-runtime barrier mở cho đủ năm provider.
   Không bắt đầu acceptance sớm vì acceptance lease sẽ chặn các deployment còn lại.
   Mọi acceptance trong một vòng phải pin cùng build identity cuối cùng. Nếu
   coordinator/common chưa cung cấp barrier này thì shared base chưa sẵn sàng:
   báo root và giữ task `IN_PROGRESS`, không tự bịa bằng report.
10. Khi barrier mở, resolve exact current source ID, lấy acceptance lease, chạy đúng
   sampler 120 giây của role và luôn kết thúc lease trong `finally`.
11. Nếu một provider fail và cần sửa/deploy, barrier cũ mất hiệu lực; không tái sử
   dụng evidence/build identity cũ. Lặp lại cho tới khi live gate của role pass trên
   barrier hiện tại.
12. Chỉ sau đó lấy edit lease mới để cập nhật report thành `DONE` với exact build,
    source/tab, baseline generation, evidence advances, semantic changes, recovery
    isolation và BTI status.

## 7. Ưu tiên

- Priority 1: SABA, CMD, APSPORT — bắt đầu và xử lý blocker trước.
- Priority 2: IM, SBOBET — chạy song song ngay, nhưng không chiếm deployment lease
  khi Priority 1 đang ở bước deploy đã được cấp lease.

---

# ROLE 1 — SABA WORKER (PRIORITY 1)

## Mapping và mục tiêu

- Account: `SABA`
- Bridge lobby/source: `SABA`
- Exact tab: tab đang mở trang SABA; không dùng tab APSPORT/TSPORT.
- Authority chỉ được lập bởi fresh current-stream Socket.IO
  `OPEN → reset → data → done`.
- Newer OPEN phải làm authority stream cũ stale ngay cả khi replacement chưa hoàn tất.
- Retired stream không được re-enter; malformed reset phải fence generation cũ.
- Baseline/delta giống hệt về semantic không được renew freshness chỉ vì revision đổi.

## Chỉ được sửa

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `docs/superpowers/reports/five-provider/saba.md`
- ignored evidence: `.run/five-provider/saba-runtime-evidence.json`

## Đọc riêng

- Task: `docs/superpowers/tasks/five-provider/saba.md`
- Report: `docs/superpowers/reports/five-provider/saba.md`

## Acceptance

Sau stable-runtime barrier và acceptance lease đúng source:

```powershell
node scripts/verify-saba-runtime.mjs 120000 .run/five-provider/saba-runtime-evidence.json
```

Recovery phải hoàn tất trong giới hạn task, tạo baseline mới và không đổi source
CMD/APSPORT/IM/SBOBET/BTI.

---

# ROLE 2 — CMD WORKER (PRIORITY 1)

## Mapping và mục tiêu

- Account: `CMD`
- Bridge lobby/source: `CMD`
- Exact tab: tab CMD `BasePage/home.aspx` đang mở; không dùng active tab.
- Authority chỉ đến từ complete authenticated current-document `fc=1` response.
- Page-call `baseline-requested`/ACK không phải evidence hoàn thành.
- Recovery phải bounded retry khi `busy` hoặc chưa thấy matching `fc=1`, dùng đúng
  frame/document/loader/session và dừng khi document/epoch bị retire.
- Pre-baseline delta không được poison cursor làm full baseline hợp lệ bị loại.

## Chỉ được sửa

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- `apps/chrome-extension/src/cmd-recovery-state.ts`
- `apps/chrome-extension/src/cmd-recovery-state.test.ts`
- `docs/superpowers/reports/five-provider/cmd.md`
- ignored evidence: `.run/five-provider/cmd-runtime-evidence.json`

Không sửa `network-observer.ts`, `background.ts`, contracts hoặc data plane. Nếu
live evidence chỉ ra lỗi ở đó, ghi exact integration request cho root và tiếp tục
adapter/poller work độc lập.

## Đọc riêng

- Task: `docs/superpowers/tasks/five-provider/cmd.md`
- Report: `docs/superpowers/reports/five-provider/cmd.md`

## Acceptance

```powershell
node scripts/verify-cmd-runtime.mjs 120000 .run/five-provider/cmd-runtime-evidence.json
```

---

# ROLE 3 — APSPORT/TSPORT WORKER (PRIORITY 1)

## Mapping và mục tiêu

- User-facing account: `APSPORT`
- Bridge lobby/adapter: `TSPORT`
- Exact tab: tab APSPORT/TSPORT đang mở.
- DOM chỉ cung cấp expected event identity/coverage; mọi authoritative price phải
  đến từ fresh TSPORT event WebSocket.
- Một DOM sweep có thể gồm nhiều snapshot `sweepComplete: false → true`; phải tích
  lũy đủ expected IDs của cả sweep, không chỉ snapshot cuối.
- Partial/invalid DOM không được xóa committed WS continuity.
- Chỉ emit WS BASELINE khi fresh stream phủ toàn bộ expected IDs; sau đó chỉ nhận
  same-generation WS DELTA. Newer OPEN phải invalidate authority cũ ngay.

## Chỉ được sửa

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- optional `apps/api/src/chrome-bridge/tsport-authority-assembler.ts`
- optional `apps/api/src/chrome-bridge/tsport-authority-assembler.test.ts`
- `docs/superpowers/reports/five-provider/apsport.md`
- ignored evidence: `.run/five-provider/apsport-runtime-evidence.json`

Không sửa observer/background/data-plane. Gửi exact shared request cho root nếu
same-tab socket reconnect hoặc bound DOM sweep wiring bị thiếu.

## Đọc riêng

- Task: `docs/superpowers/tasks/five-provider/apsport.md`
- Report: `docs/superpowers/reports/five-provider/apsport.md`

## Acceptance

```powershell
node scripts/verify-apsport-runtime.mjs 120000 .run/five-provider/apsport-runtime-evidence.json
```

---

# ROLE 4 — IM WORKER (PRIORITY 2)

## Mapping và mục tiêu

- Account: `IM`
- Bridge lobby/source: `IM`
- Exact tab: tab IM đang mở.
- Chuẩn hóa Hong Kong odds dương lớn hơn `1` tại đúng boundary IM; giữ đúng
  negative odds và reject `0`, `NaN`, infinity, object/malformed value.
- Chỉ commit baseline sau khi cả hai authenticated GetSE partitions có cùng
  cutoff/generation và đúng request/document ownership.
- Delta trước/giữa partitions phải replay đúng thứ tự; overflow/malformed/mismatch
  phải poison generation fail-closed, không commit snapshot thiếu.

## Chỉ được sửa

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/api/src/providers/im/im-football-catalog-source.ts`
- `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- `docs/superpowers/reports/five-provider/im.md`
- ignored evidence: `.run/five-provider/im-runtime-evidence.json`

## Đọc riêng

- Task: `docs/superpowers/tasks/five-provider/im.md`
- Report: `docs/superpowers/reports/five-provider/im.md`

## Acceptance

```powershell
node scripts/verify-im-runtime.mjs 120000 .run/five-provider/im-runtime-evidence.json
```

---

# ROLE 5 — SBOBET/KSPORT WORKER (PRIORITY 2)

## Mapping và mục tiêu

- User-facing account: `SBOBET`
- Bridge lobby/adapter: `KSPORT`
- Exact tab: tab SBOBET/KSPORT đang mở.
- Live/today full partitions phải ghép theo explicit recovery generation; receipt
  order chỉ dùng ordering, không bắt hai partition có receipt sequence bằng nhau.
- Recovery generation chỉ đổi tại explicit same-socket recovery attempt, không
  suy ra từ STOMP message-id/arrival.
- Pending delta phải giữ receipt order theo từng market; delta cũ hơn baseline
  không được overwrite, delta mới hơn phải replay.
- Malformed nonempty full partition không được biến thành authoritative empty.
- Newer OPEN/implicit stream phải invalidate authority cũ; replay/retired stream
  không được renew. Không persist raw KSPORT URL/header/body.

## Chỉ được sửa

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- optional `apps/api/src/chrome-bridge/ksport-baseline-generation.ts`
- optional `apps/api/src/chrome-bridge/ksport-baseline-generation.test.ts`
- `docs/superpowers/reports/five-provider/sbobet.md`
- ignored evidence: `.run/five-provider/sbobet-runtime-evidence.json`

Không sửa observer/contracts/data-plane. Nếu explicit attempt metadata còn thiếu
ở shared wiring, ghi exact failing test/symbol cho root; không tự widen whitelist.

## Đọc riêng

- Task: `docs/superpowers/tasks/five-provider/sbobet.md`
- Report: `docs/superpowers/reports/five-provider/sbobet.md`

## Acceptance

```powershell
node scripts/verify-sbobet-runtime.mjs 120000 .run/five-provider/sbobet-runtime-evidence.json
```

---

# ROOT/WORKER HANDOFF RULE

Root phải commit/build shared base, hoàn tất legacy→managed-v2 handoff và reload
đúng extension build trước khi năm prompt được chạy. Worker gặp base chưa sẵn sàng,
missing barrier hoặc shared coordinator defect phải báo exact blocker cho root và
giữ `IN_PROGRESS`; worker không được thay thế bước live bằng unit test/report.

Sau khi cả năm worker có `DONE` trên cùng stable build identity, root mới chạy
restart/reload reproof và simultaneous six-provider soak 10 phút. Soak cuối không
thay thế acceptance 120 giây mà từng worker bắt buộc tự chạy.
