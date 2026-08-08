# Thiết kế hệ thống so sánh odds và thực thi arbitrage Football + LoL

Ngày: 2026-08-09  
Trạng thái: Chờ người dùng duyệt spec  
Phạm vi ban đầu: SABA/Estorb và Techplay/InPlayMatrix

## 1. Mục tiêu

Xây dựng ứng dụng desktop/web cục bộ có giao diện tiếng Việt để:

1. Thu thập càng nhiều event và market càng tốt từ hai hệ thống SABA và InPlayMatrix.
2. Phân tách hoàn toàn hai category `FOOTBALL` và `LOL`.
3. Chỉ so sánh odds khi event và market đã qua mapping nghiêm ngặt, trạng thái `VERIFIED`.
4. Chuẩn hóa odds và phí, tìm tổ hợp hai cửa có lợi nhuận dương thực sự.
5. Xếp hạng cơ hội theo lợi nhuận sau chi phí, độ mới của giá, thanh khoản và rủi ro thực thi.
6. Tính số tiền hai chân sao cho payout mục tiêu cân bằng sau làm tròn và giới hạn cược.
7. Chỉ cho phép thực thi khi cả hai adapter hỗ trợ đầy đủ preflight và xác nhận kết quả đặt cược.
8. Lưu audit trail cho dữ liệu nguồn, mapping, quyết định, request và kết quả từng chân.

Hệ thống ưu tiên không cược nhầm hơn số lượng tín hiệu. Event hoặc market không chắc chắn phải bị loại, không được suy đoán để tăng coverage.

## 2. Giới hạn bảo đảm

Hai sàn độc lập không cung cấp giao dịch atomic xuyên sàn. Không thể bảo đảm toán học rằng hai request đặt cược luôn cùng được chấp nhận: một sàn có thể đổi odds, suspend market, giảm limit hoặc hết phiên sau khi preflight.

Vì vậy hệ thống áp dụng các bảo đảm có thể kiểm chứng sau:

- Không tạo tín hiệu từ mapping khác event, khác scope, khác market, khác line hoặc khác settlement đã biết.
- Không gửi cược nếu bất kỳ điều kiện bắt buộc nào chưa đạt.
- Không báo `HEDGED` nếu chưa có xác nhận thành công từ cả hai sàn.
- Không báo lợi nhuận chắc chắn dựa trên odds chỉ đang hiển thị ở giao diện.
- Một chân thành công và chân còn lại thất bại phải chuyển ngay sang `UNHEDGED`, khóa tự động gửi thêm và cảnh báo mức cao nhất.
- Không tự động chase odds hoặc tự chọn một market gần giống để cứu chân cược.

## 3. Nguồn dữ liệu đã xác định

### 3.1 SABA

- Esports/LoL: frontend Estorb sử dụng Socket.IO/Engine.IO và subscribe odds theo điều kiện/event.
- Football: trang SABA Sports được bootstrap từ launch URL của phiên, tải `/Sports/`, Socket.IO và một odds server riêng.
- Host và session URL có thể thay đổi theo lần đăng nhập. Adapter phải bootstrap từ trang launch, không hard-code session URL.
- Dữ liệu odds được xử lý từ WebSocket frame/patch; DOM chỉ dùng để kiểm tra chéo và thao tác giao diện khi cần.

### 3.2 InPlayMatrix/Techplay

- LoL: `imesports.techplay.com`; trận đơn dùng REST API và polling mặc định khoảng 5 giây.
- Football: `imsports.techplay.com`; dùng full snapshot và delta API, gồm các họ endpoint event/selection delta. Chu kỳ live quan sát được khoảng 5–10 giây tùy view.
- Request có session/token và có thể có timestamp/hash chống gọi thẳng. MVP bắt network response trong browser đã đăng nhập; chỉ chuyển sang direct API khi protocol được kiểm thử ổn định.
- Không truy cập domain trader hoặc tăng tần suất vượt luồng mà tài khoản người chơi được cấp.

## 4. Phương án kỹ thuật

Chọn kiến trúc hybrid:

- Browser worker giữ phiên đăng nhập, token và các cơ chế hash của từng sàn.
- SABA adapter đọc WebSocket frames trực tiếp; có thể nâng cấp thành Socket.IO client riêng sau khi fixture protocol ổn định.
- InPlayMatrix adapter bắt XHR/fetch response và delta trong browser; có thể nâng cấp từng endpoint thành HTTP client riêng.
- Hot path normalize, mapping và tính arbitrage chạy trong bộ nhớ, không chờ database.
- PostgreSQL lưu cấu hình, canonical mapping và audit; Redis chỉ bổ sung nếu đo tải cho thấy cần queue/pub-sub liên tiến trình.
- Backend dùng TypeScript/Node.js để tương thích tốt với browser automation, Socket.IO và protocol JavaScript hiện có.
- Frontend dùng React + TypeScript; backend đẩy snapshot/tín hiệu qua WebSocket nội bộ.

Không dùng OCR/screenshot hoặc đọc text DOM làm nguồn odds chính.

## 5. Kiến trúc module

```text
Session Manager
  ├─ SABA browser/session
  └─ IM browser/session
          │
Provider Adapters
  ├─ saba-football
  ├─ saba-lol
  ├─ im-football
  └─ im-lol
          │ RawProviderEvent / RawQuote
          ▼
Normalizers
  ├─ football-normalizer
  └─ lol-normalizer
          │ Canonical candidates
          ▼
Strict Mapping Engine
          │ VERIFIED only
          ▼
Quote Book + Freshness Engine
          ▼
Arbitrage + Stake Optimizer
          ▼
Opportunity UI / Execution Gate
          ▼
Two-Leg Executor + Reconciler
          ▼
Audit Store + Alerts
```

Mỗi module có interface rõ ràng và test fixture riêng. Adapter mới cho sàn khác không được đưa logic riêng của sàn vào mapping engine.

## 6. Category và market hỗ trợ

### 6.1 Football

Giai đoạn đầu hỗ trợ các market thanh khoản cao, dễ xác minh settlement:

1. Full-time 1X2: ba cửa, chỉ tính arbitrage khi lấy được đủ ba best odds hoặc một cấu trúc hedge tương đương đã chứng minh.
2. Full-time Asian Handicap hai cửa: cùng line và cùng quy tắc push.
3. Full-time Total Goals Over/Under: cùng line, cùng treatment cho extra time.
4. First-half 1X2.
5. First-half Asian Handicap.
6. First-half Total Goals.

Không trộn full time với hiệp một, regular time với including extra time, main event với corners/cards/player props.

### 6.2 LoL

Giai đoạn đầu hỗ trợ:

1. Series/Match Winner.
2. Map Winner cho đúng `MAP_N`.
3. Map Total Kills Over/Under cho cùng map và line.
4. Map Kill Handicap cho cùng map và line.
5. Map Duration Over/Under cho cùng map, line và settlement.

First Blood, First Dragon, First Baron và props khác được ingest để hiển thị coverage nhưng chưa được thực thi tự động cho đến khi settlement mapping và fixture test đầy đủ.

### 6.3 Chính sách chọn market

Opportunity engine không cố định chỉ một loại cược. Nó xếp hạng toàn bộ market đã được phép theo:

1. `net_margin` sau phí, FX và làm tròn stake.
2. `execution_confidence`.
3. Độ mới của hai quote.
4. Min/max stake khả dụng và balance.
5. Lịch sử reject/suspend của market.

Chỉ market có `execution_confidence = HIGH` mới được mở execution gate. Không đánh hai market khác tên hoặc khác scope chỉ vì payout nhìn cân.

## 7. Canonical event và market

### 7.1 Event chung

```text
canonical_event_id
category
competition_id
season_stage
start_at_utc
participant_a_id
participant_b_id
provider_events[]
mapping_status
mapping_evidence
```

### 7.2 Football event key

```text
football | competition | season_stage | kickoff_utc |
home_team | away_team | event_scope
```

`event_scope` phân biệt regular match, extra time, corners, cards và các child event khác.

### 7.3 LoL event key

```text
lol | tournament | season_stage | start_at_utc |
team_a | team_b | best_of
```

### 7.4 Market key

```text
canonical_event_id | period_or_map_scope | market_type |
normalized_line | settlement_profile | selection
```

Odds format không nằm trong identity; odds phải được normalize sang Decimal trước khi tính.

## 8. Strict mapping engine

### 8.1 Trạng thái

- `VERIFIED`: tất cả hard gate đạt và không có mâu thuẫn.
- `REVIEW_REQUIRED`: có candidate nhưng thiếu bằng chứng bắt buộc.
- `REJECTED`: có mâu thuẫn hoặc market không tương thích.

Chỉ `VERIFIED` đi vào quote book dùng cho arbitrage.

### 8.2 Football hard gates

- Category đúng Football, không phải virtual/esoccer.
- Competition, season/stage tương thích.
- Home/away teams khớp qua canonical alias.
- Kickoff UTC nằm trong tolerance cấu hình; rematch cùng ngày phải có thêm ID/round evidence.
- Pre-match/live status tương thích.
- Khi live: period, score, clock state và child-event scope tương thích.
- Market type, period, line và selection tương thích.
- Settlement profile tương thích.

### 8.3 LoL hard gates

Áp dụng đầy đủ hướng dẫn trong `LOL_Odds_Compare_Exact_Mapping_Guide.docx`:

- LoL PC, không phải Wild Rift/ARAM/virtual.
- Tournament, season/split/stage khớp.
- Team alias khớp.
- Start UTC và BO format khớp.
- SERIES hoặc đúng MAP_N.
- Market type, line và selection khớp.
- Khi live: map number, series score và state đủ tương thích.
- Remake/disconnect/surrender settlement tương thích.

### 8.4 Mở rộng coverage an toàn

- Alias mới do người dùng duyệt được version hóa và lưu audit.
- Candidate mapping từ fuzzy text chỉ dùng để gợi ý review, không tự thành `VERIFIED`.
- Mapping đã verified được tái sử dụng qua provider event ID trong cùng event lifecycle.
- Nếu provider thay ID, time, participant hoặc scope, mapping phải được xác minh lại.

## 9. Quote, freshness và odds normalization

Mỗi quote lưu:

```text
provider
provider_event_id
provider_market_id
provider_selection_id
raw_odds
raw_format
decimal_odds
effective_decimal
line
status
source_timestamp
received_monotonic_ns
sequence_or_delta_id
```

Freshness TTL được tính riêng theo nguồn và loại luồng:

- WebSocket quote: TTL ngắn, dựa trên heartbeat và lịch sử update.
- Polling/delta quote: TTL thích nghi theo chu kỳ thực tế của endpoint.
- Quote cũ, out-of-order, sequence gap hoặc market suspend bị loại ngay.

Nếu không có timestamp từ server, hệ thống dùng monotonic receive time và đánh confidence thấp hơn. Không dùng đồng hồ UI làm căn cứ duy nhất.

Hỗ trợ Decimal, Hong Kong và American. Mọi phép tính sử dụng `effective_decimal` sau fee/FX model đã cấu hình cho từng sàn.

## 10. Arbitrage và stake optimizer

Với N outcomes:

```text
S = sum(1 / effective_decimal_i)
net_margin = 1 / S - 1
```

Opportunity chỉ hợp lệ nếu:

- `S < 1` sau phí, FX và rounding.
- `net_margin >= configured_min_net_margin`.
- Tất cả quotes fresh và market open.
- Mapping và settlement đều `VERIFIED`.
- Balance, minimum stake và maximum stake đủ.
- Sau khi làm tròn theo bước tiền của từng sàn, payout tệ nhất vẫn dương trên ngưỡng an toàn.

Stake optimizer giải bài toán max-min payout với các ràng buộc:

```text
min_stake_i <= stake_i <= max_stake_i
stake_i % stake_step_i = 0
sum(stake_i converted to base currency) <= bankroll_limit
```

Kết quả phải hiển thị stake từng chân, payout từng outcome, lợi nhuận tệ nhất, ROI, phí và FX assumptions.

## 11. Execution gate và state machine

### 11.1 Chế độ

1. `OBSERVE`: chỉ ingest và hiển thị.
2. `PAPER`: mô phỏng quyết định và kết quả theo quote thực.
3. `ASSISTED`: điền sẵn hai vé; người dùng xác nhận.
4. `AUTO`: chỉ bật khi adapter đó đã vượt contract test, dry-run và paper-run.

Mặc định hệ thống khởi động ở `OBSERVE` và không thể chuyển thẳng sang `AUTO` nếu thiếu các khóa an toàn.

### 11.2 Preflight bắt buộc

- Phiên cả hai sàn còn hợp lệ.
- Cùng canonical event/market/line/settlement đã verified.
- Hai market open.
- Odds hiện tại đáp ứng policy chấp nhận thay đổi.
- Lấy được min/max stake hiện tại.
- Balance đủ.
- Stake sau rounding vẫn sinh lợi nhuận tệ nhất trên ngưỡng.
- Không có execution khác trên cùng market.
- Opportunity chưa hết TTL.

### 11.3 State machine

```text
DETECTED
→ PREFLIGHTING
→ ARMED
→ SUBMITTING_BOTH
→ BOTH_CONFIRMED → HEDGED
                ↘ ONE_CONFIRMED → UNHEDGED
                ↘ BOTH_REJECTED → REJECTED
                ↘ UNKNOWN → RECONCILING
```

Hai chân được gửi gần đồng thời sau preflight. Kết quả dựa trên bet ID/receipt từ server, không dựa trên toast giao diện.

Không tự retry request đặt cược khi chưa biết request đầu đã thành công hay chưa. `UNKNOWN` bắt buộc reconcile bet history trước mọi hành động khác.

## 12. Giao diện người dùng

### 12.1 Navigation

- Dashboard
- Football
- LoL
- Opportunities
- Mappings cần duyệt
- Executions
- Sessions & Providers
- Settings

### 12.2 Dashboard

Hiển thị:

- Trạng thái kết nối bốn adapter.
- Số event/market ingest theo category.
- Số mapping VERIFIED/REVIEW_REQUIRED/REJECTED.
- Độ trễ và tuổi quote từng nguồn.
- Opportunity đang sống.
- Execution gần nhất và cảnh báo `UNHEDGED` nổi bật.

### 12.3 Football và LoL

Mỗi category có bảng riêng, filter theo live/pre-match, competition/tournament, market, margin và confidence. Một hàng event mở ra các market cùng canonical key, hiển thị song song hai sàn.

Màu sắc không được là tín hiệu duy nhất; mọi badge có text/icon. Quote thay đổi có animation ngắn nhưng không làm đổi vị trí hàng gây bấm nhầm.

### 12.4 Opportunity card

Phải hiển thị trước khi cho phép arm:

- Event và market chuẩn.
- Scope: full time/first half/series/map N.
- Line và settlement profile.
- Odds gốc, odds Decimal và effective odds của từng sàn.
- Tuổi quote và timestamp.
- Stake từng chân.
- Worst-case payout/profit/ROI.
- Min/max stake và balance check.
- Mapping evidence và execution confidence.

Nút thực thi bị disable kèm lý do rõ ràng nếu bất kỳ hard gate nào không đạt.

## 13. Bảo mật và session

- Không lưu token/session trong URL, log hoặc database dạng plaintext.
- Credential/session secret dùng OS credential store hoặc secret store cục bộ.
- Log phải redaction token, cookie, account ID và bet payload nhạy cảm.
- Browser profile tách theo provider.
- Không commit credential hoặc captured production payload chứa thông tin cá nhân.
- Tự động khóa execution khi session thay đổi bất thường, clock drift lớn hoặc parser nhận schema chưa biết.

## 14. Error handling

- Connection loss: đánh stale toàn bộ quotes nguồn đó và đóng execution gate.
- Sequence gap/delta mismatch: yêu cầu full snapshot trước khi dùng lại.
- Parser/schema drift: quarantine payload và cảnh báo; không fallback sang đoán DOM.
- Clock drift: không so freshness cho đến khi đồng bộ lại.
- Mapping conflict: hạ về `REVIEW_REQUIRED` hoặc `REJECTED`.
- Market suspended: xóa opportunity ngay.
- Partial execution: chuyển `UNHEDGED`, cảnh báo âm thanh/UI và yêu cầu reconcile.
- Database lỗi: hot path có thể tiếp tục observe trong memory nhưng execution bị khóa vì không tạo được audit bền vững.

## 15. Testing

### 15.1 Unit tests

- Odds conversion và effective odds.
- Canonical alias normalization.
- Football/LoL event keys.
- Market/scope/line mapping.
- N-outcome arbitrage math.
- Stake optimization với rounding, min/max và FX.
- Freshness, sequence và state transitions.

### 15.2 Fixture/contract tests

- Recorded WebSocket frames của SABA Football/LoL đã redaction.
- Recorded XHR full/delta payload của IM Football/LoL đã redaction.
- Schema drift và unknown field handling.
- Token expiration/session refresh không làm ghi lộ secret.

### 15.3 Property tests

- Stake optimizer không bao giờ báo lợi nhuận dương nếu một outcome payout âm sau rounding.
- Hoán đổi thứ tự team/selection không đổi canonical event nhưng phải đổi selection đúng cách.
- Khác line/scope/period/map không bao giờ tạo mapping VERIFIED.

### 15.4 Integration tests

- Full snapshot + delta → quote book chính xác.
- Hai provider event → VERIFIED canonical event.
- Opportunity xuất hiện, biến mất khi stale/suspend.
- Preflight fail ở bất kỳ gate nào → không có submit.
- Một/both/unknown execution result → đúng state và audit.

### 15.5 Paper-run gate

AUTO chỉ được mở cho từng provider pair/market type sau khi:

- Chạy đủ số lượng event cấu hình trong PAPER mode.
- Không có false VERIFIED mapping trong tập review.
- Parser không có unknown critical schema.
- Mô phỏng rounding/limit/price-change không tạo false-profit.
- Reconciliation khớp toàn bộ simulated receipts.

## 16. Tiêu chí nghiệm thu

- UI có hai category Football và LoL riêng biệt.
- Thu thập toàn bộ event có thể truy cập từ bốn adapter, có pagination/lazy-load coverage.
- Không event `REVIEW_REQUIRED` hoặc `REJECTED` nào đi vào arbitrage calculator.
- Các market phase 1 được hiển thị cùng mapping evidence, line, scope và rules profile.
- Opportunity chỉ hiện khi worst-case net profit sau phí/FX/rounding vượt ngưỡng.
- Không thể arm hoặc submit khi một preflight gate fail.
- `HEDGED` chỉ xuất hiện khi có receipt cả hai chân.
- Mọi execution có audit trail và không làm lộ session secret.
- Contract, unit, property và integration tests của phase hiện tại đều pass.

## 17. Thứ tự triển khai

1. Khởi tạo monorepo, shared types và test harness.
2. Canonical model, normalizers và strict mapping engine.
3. Odds/arbitrage/stake optimizer.
4. Session manager và bốn read-only adapters.
5. Quote book, freshness và realtime backend channel.
6. UI Dashboard, Football, LoL, Opportunities và Mapping Review.
7. Audit, alerts và PAPER execution engine.
8. Assisted execution adapters.
9. Contract-test và paper-run gate.
10. AUTO execution chỉ cho provider/market đã đạt gate; credentials và bet-specific fields do người dùng cung cấp ở giai đoạn này.

## 18. Ngoài phạm vi phase đầu

- Tự động bỏ qua hoặc vượt CAPTCHA/anti-bot.
- Dùng domain trader không được tài khoản cấp quyền.
- Tự động chọn market gần giống khi market chuẩn không tồn tại.
- Tự động chase giá hoặc martingale sau partial execution.
- Cam kết lợi nhuận tuyệt đối hoặc cam kết hai sàn luôn cùng nhận lệnh.
- Hỗ trợ sàn mới mà chưa có adapter, settlement profile và contract fixtures.
