# PROMPT ĐIỀU PHỐI 5 WORKER REALTIME

Đây là nguồn prompt duy nhất để mở năm Codex worker tab. Không dùng prompt cũ
trong lịch sử chat và không dùng linked worktree.

## Một dòng cho từng tab

- SABA: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và ROLE SABA, rồi sở hữu task SABA qua LOCAL_GREEN, chờ combined deploy của root, và tự chạy live acceptance đến DONE.`
- CMD: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và ROLE CMD, rồi sở hữu task CMD qua LOCAL_GREEN, chờ combined deploy của root, và tự chạy live acceptance đến DONE.`
- APSPORT: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và ROLE APSPORT/TSPORT, rồi sở hữu task APSPORT qua LOCAL_GREEN, chờ combined deploy của root, và tự chạy live acceptance đến DONE.`
- IM: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và ROLE IM, rồi sở hữu task IM qua LOCAL_GREEN, chờ combined deploy của root, và tự chạy live acceptance đến DONE.`
- SBOBET: `Mở F:\0. PROJECT\tool-chenh\proccess.md, đọc toàn bộ COMMON CONTRACT và ROLE SBOBET/KSPORT, rồi sở hữu task SBOBET qua LOCAL_GREEN, chờ combined deploy của root, và tự chạy live acceptance đến DONE.`

Mỗi tab chỉ nhận một role.

---

# COMMON CONTRACT — BẮT BUỘC CHO CẢ 5 WORKER

## 1. Mô hình duy nhất

Quy trình có ba pha:

1. Năm worker song song diagnose và TDD trong whitelist riêng, ghi
   `LOCAL_GREEN`, release edit lease và chờ.
2. Root chờ không còn edit, freeze toàn bộ tracked edits, rồi root một mình
   build/restart/reload đúng một combined artifact cho vòng đó và công bố build
   identity.
3. Năm worker đồng thời tự chạy acceptance 120 giây cho provider riêng trên cùng
   build. Chỉ live acceptance mới cho phép `DONE`.

Worker không bao giờ build, restart, reload extension, claim/release/abort
deployment hoặc chạy `restart-live-stack.mjs`. Không có stable-runtime-barrier
command và không được chờ một barrier không tồn tại.

## 2. Repository root bắt buộc

```text
F:\0. PROJECT\tool-chenh
```

- Mọi `shell_command`/tool call phải đặt `workdir` trực tiếp thành exact root trên.
- Không được dùng
  `F:\0. PROJECT\tool-chenh\.worktrees\six-provider-realtime-feed`.
- Nếu tool không có `workdir`, prefix trong cùng invocation:

  ```powershell
  $repoRoot = 'F:\0. PROJECT\tool-chenh'
  Set-Location -LiteralPath $repoRoot
  if ((Get-Location).Path -ne $repoRoot) { throw 'WRONG_REPOSITORY_ROOT' }
  ```

Không dựa vào `Set-Location` hoặc biến PowerShell từ invocation trước.

## 3. Tài liệu phải đọc đúng thứ tự

Trước mọi edit, đọc hết:

1. `F:\0. PROJECT\tool-chenh\proccess.md` — COMMON CONTRACT và đúng role;
2. `docs/superpowers/tasks/five-provider/common.md`;
3. `docs/superpowers/tasks/five-provider/ownership.md`;
4. `docs/superpowers/specs/2026-08-24-five-provider-parallel-runtime-design.md`;
5. `docs/superpowers/plans/2026-08-24-five-provider-parallel-runtime.md`;
6. task file riêng;
7. report file riêng.

`ownership.md` authoritative cho whitelist file, provider/source mapping và quy
tắc deploy root-only hiện tại. Worker không được deploy.
Report cũ chỉ là lịch sử; không được dùng verdict, build hoặc evidence cũ để kết
luận vòng hiện tại.

## 4. Live DONE

`LOCAL_GREEN` là checkpoint bắt buộc nhưng không phải thành công.
`READY_FOR_INTEGRATION`, unit tests hoặc report cũng không phải thành công.

Worker chỉ được ghi `DONE` sau khi tự chứng minh trên exact combined build của
vòng được root accept:

1. exact bridge source có `authorityDisposition: ACTIVE`;
2. catalog source có `sessionState: ACTIVE`, không reason, `FRESH`, không rỗng;
3. authoritative baseline thuộc source epoch hiện tại;
4. provider-native cursor/evidence tiến ít nhất ba lần trong 120 giây;
5. semantic price/status đổi khi provider phát thay đổi; heartbeat, ACK, replay
   hoặc DOM không đổi không được tính;
6. targeted recovery exact source tạo authoritative baseline generation mới và
   không đổi source của provider khác;
7. BTI `ACTIVE` trong toàn bộ acceptance;
8. exact source/tab và `/api/health.buildIdentity` giữ nguyên, khớp round root
   công bố.

`BLOCKED` chỉ hợp lệ khi đã chứng minh external auth/provider failure mà code
provider-local và same-tab recovery không thể khắc phục. Không biến external
failure thành success.

## 5. File, Git và browser safety

- Chỉ edit các file được cả role và `ownership.md` liệt kê trong exact provider
  whitelist; không edit chính `ownership.md`. Tracked edits dùng `apply_patch`.
- Provider edit lease phải được lấy trước cả RED test mutation và giữ qua RED,
  fix, GREEN, affected typecheck, scoped diff-check, secret scan và report update.
- Release edit lease trong `finally`.
- Không chạy Git mutation: `add`, `commit`, `reset`, `restore`, `checkout`,
  `stash`, `merge`, `rebase`, `clean`, `push`. Root một mình sở hữu Git.
- Không edit shared observer/background/contracts/data-plane/server, `dist`,
  `.auth`, coordinator state, provider khác hoặc planning docs. Sampler chỉ được
  ghi ignored evidence file của role.
- Cấm đọc/in/lưu token, cookie, signed URL, raw body, credential, launch material.
- Chỉ điều khiển exact provider source/tab; cấm active-tab fallback.
- Cấm mở DevTools hoặc chiếm debugger/CDP.
- Cấm reload/navigate/focus/replace provider tab. Recovery chỉ dùng exact-source
  API của sampler/task.

## 6. Phase A — diagnose, TDD, LOCAL_GREEN

Cho mỗi coherent patch:

```powershell
node scripts/five-provider-coordinator.mjs begin-edit <PROVIDER> <WORKER_ID>
# RED -> minimal fix -> GREEN/typecheck/diff/secret scan -> report
node scripts/five-provider-coordinator.mjs end-edit <TOKEN>
```

Luồng bắt buộc:

1. read-only inspect exact provider runtime/code, dùng `systematic-debugging`;
2. lấy edit lease trước mọi file mutation;
3. thêm và chạy focused RED;
4. sửa tối thiểu bằng `apply_patch` trong whitelist;
5. chạy focused GREEN, mọi affected workspace typecheck, scoped
   `git diff --check` và redacted secret scan;
6. ghi exact evidence/shared request vào report, đặt status `LOCAL_GREEN`;
7. end edit lease trong `finally`, báo `LOCAL_GREEN <PROVIDER>` cho root và chờ.

Trong lúc chờ: không edit, recovery, acceptance, build, restart, reload hoặc claim
deploy. Nếu root sửa shared seam ảnh hưởng provider, checkpoint bị invalid và
worker phải rerun local checks trước khi báo `LOCAL_GREEN` lại.

## 7. Phase B — root freeze và combined deploy

Root chờ đủ năm `LOCAL_GREEN`, hoàn tất shared fixes, review tree và xác minh
coordinator không có edit/deploy/acceptance lease. Root công bố:

```text
FREEZE_FOR_COMBINED_DEPLOY <ROUND_ID>
```

Từ đó mọi worker ngừng tracked edits. Root một mình claim:

```powershell
node scripts/five-provider-coordinator.mjs claim-deploy SABA root-integrator 1800000
```

`SABA` chỉ là fixed coordinator serialization label cho combined deployment,
không trao quyền SABA provider cho root và không biến build thành SABA-only. Root
một mình build toàn repo, set exact deployment token, chạy zero-argument managed
restart, reload đúng
`F:\0. PROJECT\tool-chenh\apps\chrome-extension\dist`, verify health identity và
release lease để ghi `lastDeployment`.

Root sau đó công bố:

```text
ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>
```

Đây là handoff đầy đủ; không có barrier command khác.

## 8. Phase C — concurrent live acceptance

Chỉ sau `ACCEPTANCE_ROUND`, mỗi worker:

1. resolve exact current source ID của role;
2. lấy existing acceptance lease:

   ```powershell
   node scripts/five-provider-coordinator.mjs begin-acceptance <PROVIDER> <WORKER_ID> <EXACT_SOURCE_ID>
   ```

3. chạy sampler 120 giây của role, không build/reload;
4. tự verify mọi gate ở mục 4 và exact round build;
5. luôn gọi `end-acceptance <TOKEN>` trong `finally`;
6. nếu pass, báo `ACCEPTANCE_PASS <ROUND_ID> <PROVIDER>` rồi chờ, chưa edit
   report `DONE`.

## 9. Một failure dừng cả vòng

Khi bất kỳ provider fail:

1. worker đó end lease và báo
   `ACCEPTANCE_FAIL <ROUND_ID> <PROVIDER> <REDACTED_REASON>`;
2. root công bố `STOP_ACCEPTANCE <ROUND_ID>`;
3. cả năm dừng sampler, end lease trong `finally`, bỏ verdict/evidence vòng đó;
4. root chờ zero acceptance/edit lease rồi mới cho failed provider(s) edit;
5. failed provider về `IN_PROGRESS`, làm RED/fix/GREEN, báo `LOCAL_GREEN` lại;
6. root freeze vòng mới và combined deploy đúng một lần;
7. cả năm rerun fresh 120 giây trên build mới. Cấm reuse build/source/lease/evidence
   vòng cũ.

Khi đủ năm pass cùng vòng và không còn acceptance lease, root công bố:

```text
ROUND_ACCEPTED <ROUND_ID> <BUILD_IDENTITY>
```

Lúc đó mỗi worker mới lấy edit lease mới, cập nhật report riêng thành `DONE` với
exact build/source/tab/baseline/evidence/semantic/recovery/BTI proof, rồi release
lease và kết thúc.

## 10. Priority

- Priority 1: SABA, CMD, APSPORT — root review blocker/shared request trước.
- Priority 2: IM, SBOBET — vẫn làm provider-local TDD và acceptance song song.
- Priority không cho worker nào quyền deploy; chỉ root combined deploy.

---

# ROLE 1 — SABA WORKER (PRIORITY 1)

## Mapping và invariant

- Account/source: `SABA` / `SABA`
- Exact tab: SABA, không dùng APSPORT/TSPORT tab.
- Authority chỉ từ fresh current-stream Socket.IO
  `OPEN → reset → data → done`.
- Newer `OPEN` làm stream cũ stale ngay; retired stream không re-enter.
- Malformed reset fences generation cũ; semantic-identical replay không renew.

## Whitelist

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts`
- `apps/api/src/chrome-bridge/saba-ws-adapter.test.ts`
- `apps/api/src/chrome-bridge/saba-ws-realtime-regression.test.ts`
- `docs/superpowers/reports/five-provider/saba.md`
- ignored evidence `.run/five-provider/saba-runtime-evidence.json`

Task: `docs/superpowers/tasks/five-provider/saba.md`

Acceptance after root round publication:

```powershell
node scripts/verify-saba-runtime.mjs 120000 .run/five-provider/saba-runtime-evidence.json
```

Recovery phải tạo baseline mới trong task limit và không đổi
CMD/APSPORT/IM/SBOBET/BTI sources.

---

# ROLE 2 — CMD WORKER (PRIORITY 1)

## Mapping và invariant

- Account/source: `CMD` / `CMD`
- Exact tab: CMD `BasePage/home.aspx`, không active-tab fallback.
- Authority chỉ từ complete authenticated current-document `fc=1` response.
- `baseline-requested`, page ACK hoặc `busy` không phải completion evidence.
- Recovery bounded theo exact frame/document/loader/session; retired document
  dừng mọi late work.
- Pre-baseline delta không poison committed full-baseline cursor.

## Whitelist

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts`
- `apps/api/src/chrome-bridge/cmd-http-adapter.test.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.ts`
- `apps/chrome-extension/src/cmd-snapshot-poller.test.ts`
- optional `apps/chrome-extension/src/cmd-recovery-state.ts`
- optional `apps/chrome-extension/src/cmd-recovery-state.test.ts`
- `docs/superpowers/reports/five-provider/cmd.md`
- ignored evidence `.run/five-provider/cmd-runtime-evidence.json`

Task: `docs/superpowers/tasks/five-provider/cmd.md`

Không edit `network-observer.ts`, `background.ts`, contracts hoặc data plane.
Gửi exact shared request cho root nếu cần wiring ngoài whitelist.

Acceptance after root round publication:

```powershell
node scripts/verify-cmd-runtime.mjs 120000 .run/five-provider/cmd-runtime-evidence.json
```

---

# ROLE 3 — APSPORT/TSPORT WORKER (PRIORITY 1)

## Mapping và invariant

- User account: `APSPORT`; bridge/adapter: `TSPORT`.
- Exact tab: APSPORT/TSPORT.
- DOM chỉ cung cấp expected identity/coverage; authoritative quote chỉ từ fresh
  TSPORT WebSocket.
- Tích lũy toàn bộ bound DOM sweep `false → true`; partial/invalid sweep không
  xóa committed WS continuity.
- Chỉ WS full coverage emit `BASELINE`; same-generation frames sau đó emit
  `DELTA`; newer `OPEN` invalidate authority cũ ngay.

## Whitelist

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts`
- optional `apps/api/src/chrome-bridge/tsport-authority-assembler.ts`
- optional `apps/api/src/chrome-bridge/tsport-authority-assembler.test.ts`
- `docs/superpowers/reports/five-provider/apsport.md`
- ignored evidence `.run/five-provider/apsport-runtime-evidence.json`

Task: `docs/superpowers/tasks/five-provider/apsport.md`

Không edit observer/background/data-plane. Gửi exact shared request cho root nếu
same-tab socket reconnect hoặc bound DOM sweep wiring thiếu.

Acceptance after root round publication:

```powershell
node scripts/verify-apsport-runtime.mjs 120000 .run/five-provider/apsport-runtime-evidence.json
```

---

# ROLE 4 — IM WORKER (PRIORITY 2)

## Mapping và invariant

- Account/source: `IM` / `IM`
- Exact tab: IM.
- Normalize finite positive Hong Kong odds `> 1` tại IM boundary; giữ valid Malay
  odds và reject `0`, non-finite, object/malformed.
- Chỉ commit khi hai authenticated GetSE partitions cùng cutoff/generation và
  đúng request/document ownership.
- Delta replay đúng order; overflow/malformed/mismatch poison generation.

## Whitelist

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/api/src/providers/im/im-football-catalog-source.ts`
- `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- `docs/superpowers/reports/five-provider/im.md`
- ignored evidence `.run/five-provider/im-runtime-evidence.json`

Task: `docs/superpowers/tasks/five-provider/im.md`

Acceptance after root round publication:

```powershell
node scripts/verify-im-runtime.mjs 120000 .run/five-provider/im-runtime-evidence.json
```

---

# ROLE 5 — SBOBET/KSPORT WORKER (PRIORITY 2)

## Mapping và invariant

- User account: `SBOBET`; bridge/adapter: `KSPORT`.
- Exact tab: SBOBET/KSPORT.
- Live/today full partitions pair bằng explicit recovery generation; receipt
  sequence chỉ ordering.
- Generation chỉ đổi tại explicit same-socket recovery attempt, không suy từ
  STOMP message-id hoặc arrival.
- Pending delta giữ per-market receipt order; malformed nonempty full không thành
  authoritative empty.
- Newer stream invalidates authority cũ; không persist raw URL/header/body.

## Whitelist

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts`
- `apps/api/src/chrome-bridge/ksport-ws-adapter.test.ts`
- optional `apps/api/src/chrome-bridge/ksport-baseline-generation.ts`
- optional `apps/api/src/chrome-bridge/ksport-baseline-generation.test.ts`
- `docs/superpowers/reports/five-provider/sbobet.md`
- ignored evidence `.run/five-provider/sbobet-runtime-evidence.json`

Task: `docs/superpowers/tasks/five-provider/sbobet.md`

Không edit observer/contracts/data-plane. Gửi exact shared request cho root nếu
explicit recovery metadata thiếu.

Acceptance after root round publication:

```powershell
node scripts/verify-sbobet-runtime.mjs 120000 .run/five-provider/sbobet-runtime-evidence.json
```

---

# ROOT HANDOFF

Root theo `docs/superpowers/tasks/five-provider/integrator.md`: chờ năm
`LOCAL_GREEN`, freeze, combined deploy một lần, publish round/build, điều phối
stop-all khi fail và accept round khi cả năm pass. Worker không thay thế live
acceptance bằng patch/report và root không chạy acceptance thay worker.
