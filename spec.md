# Đặc tả sản phẩm — Tool Chênh

## 1. Tổng quan

Tool Chênh là hệ thống theo dõi tỷ lệ cược theo thời gian thực giữa nhiều sàn, dùng để phát hiện các vé cược hai cửa có chênh lệch giá đủ lớn để chia tiền vào hai kết quả đối nghịch và tạo lợi nhuận dương trong trường hợp xấu nhất.

Sản phẩm phục vụ hai nhóm độc lập:

- Bóng đá.
- League of Legends (LoL).

Các sàn mục tiêu chính là CMD, SABA, SBOBET, APSPORT và BTI. Kiến trúc phải cho phép bổ sung IM hoặc sàn khác mà không thay đổi logic cốt lõi.

### Liên kết các sàn mục tiêu

| Sàn | Liên kết tham chiếu |
|---|---|
| CMD / CMD368 | [https://www.cmdbet.com/](https://www.cmdbet.com/) |
| SABA Sports | [https://www.sabasportsb2b.com/en-US](https://www.sabasportsb2b.com/en-US) |
| SBOBET | [https://www.sbobet.com/](https://www.sbobet.com/) |
| APSPORT / AP Gaming | [https://www.theapgaming.com/](https://www.theapgaming.com/) |
| BTI Sports | [https://www.btisports.co/index_en.aspx](https://www.btisports.co/index_en.aspx) |

Các link trên là trang tham chiếu công khai của từng nhà cung cấp. URL sportsbook thực tế dùng để đọc dữ liệu có thể là launch URL động do Fabet hoặc cổng tài khoản trả về sau khi đăng nhập. Hệ thống phải lấy URL đó từ phiên hợp lệ của người dùng, không hard-code hostname động, token hoặc launch URL vào mã nguồn và tài liệu.

Mục tiêu ưu tiên cao nhất là **không ghép nhầm trận, nhầm kèo hoặc nhầm điều kiện thanh toán**. Hệ thống phải bỏ qua cơ hội không đủ bằng chứng thay vì suy đoán để tăng số lượng tín hiệu.

## 2. Giá trị chính của sản phẩm

Hệ thống phải giúp người dùng:

1. Xem giá hiện tại của cùng một vé cược trên nhiều sàn trong một màn hình.
2. Nhận biết ngay khi một sàn đổi giá nhưng các sàn còn lại chưa đổi.
3. Xác định liệu hai cửa đối nghịch ở hai sàn khác nhau có tạo lợi nhuận thực sau khi tính tiền cược, làm tròn, phí và giới hạn tài khoản hay không.
4. Biết chính xác cần đặt bao nhiêu tiền ở từng sàn và lợi nhuận/lỗ của từng kết quả.
5. Chỉ nhận cảnh báo khi cơ hội đã vượt qua toàn bộ điều kiện an toàn.
6. Có thể kiểm tra lại toàn bộ dữ liệu, quyết định và kết quả của mỗi lần theo dõi hoặc đặt cược.

## 3. Phạm vi nghiệp vụ

### 3.1 Bóng đá

Chỉ so sánh các thị trường đúng hai kết quả, ví dụ:

- Asian Handicap: HOME/AWAY với cùng line.
- Over/Under: OVER/UNDER với cùng line.

Phải phân biệt rõ:

- Trước trận và trực tiếp.
- Toàn trận và hiệp một.
- Trận chính và các phạm vi phụ như phạt góc, thẻ hoặc hiệp phụ.
- Các line khác nhau, kể cả khi chỉ lệch một phần tư bàn.

Kèo 1X2 ba cửa không thuộc chiến lược cân hai bên của sản phẩm và không được dùng để tạo tín hiệu chênh lệch.

### 3.2 League of Legends

Chỉ so sánh các thị trường hai kết quả đã xác minh cùng quy tắc thanh toán, ưu tiên:

- Series/Match Winner.
- Map Winner cho đúng số map.
- Handicap cho cùng map và cùng line.
- Total Kills hoặc Map Duration Over/Under cho cùng map và cùng line.

Phải phân biệt LoL PC với Wild Rift, giải ảo hoặc loại game khác; đồng thời phân biệt series với từng map và đúng trạng thái của trận.

## 4. Thu thập dữ liệu

Mỗi sàn được kết nối bằng tài khoản, phiên đăng nhập, token hoặc launch URL hợp lệ do người dùng cung cấp.

Thứ tự ưu tiên nguồn dữ liệu:

1. API hoặc WebSocket trực tiếp của sàn.
2. Network response trong browser đã đăng nhập.
3. DOM/browser chỉ dùng làm phương án dự phòng hoặc để đối chiếu.

Mỗi quote phải lưu đủ thông tin để truy vết:

- Sàn và ID gốc của event, market, selection.
- Loại thị trường, phạm vi hiệp/trận/map và line.
- Cửa cược gốc và cửa cược sau chuẩn hóa.
- Odds gốc, định dạng odds và Decimal odds đã quy đổi.
- Trạng thái OPEN/SUSPENDED.
- Thời điểm nguồn phát giá và thời điểm hệ thống nhận giá.
- Sequence/delta ID nếu nguồn cung cấp.

Quote mới phải được xử lý ngay khi nhận được. Không chờ gom theo cửa sổ nhiều phút mới tìm chênh lệch.

Khi mất kết nối, thiếu delta, sai sequence, schema không xác định hoặc dữ liệu quá cũ, nguồn liên quan phải bị đánh dấu không khả dụng và không được dùng để tạo tín hiệu.

## 5. Chuẩn hóa và ghép dữ liệu

### 5.1 Ghép trận

Hai event chỉ được coi là cùng một trận khi có đủ bằng chứng phù hợp:

- Cùng môn/category.
- Đội hoặc tuyển thủ đã được chuẩn hóa và đối chiếu đúng.
- Cùng giải đấu và giai đoạn nếu có dữ liệu.
- Thời gian bắt đầu nằm trong sai số cho phép.
- Cùng trạng thái trước trận/trực tiếp.
- Với trận live: hiệp/map, tỷ số và trạng thái trận không mâu thuẫn.

Tên viết tắt, Unicode, tiền tố như FC/SC/CLB và thứ tự đội đảo có thể được chuẩn hóa, nhưng việc đảo đội phải đồng thời quy đổi đúng HOME/AWAY, TEAM_A/TEAM_B và dấu handicap.

### 5.2 Ghép vé cược

Hai market chỉ được đặt cạnh nhau để tính chênh lệch khi đồng thời khớp:

- Canonical event.
- Loại market.
- Phạm vi toàn trận/hiệp/map.
- Exact line.
- Hai selection đối nghịch chính xác.
- Quy tắc thanh toán, gồm push/void, hiệp phụ, remake, surrender hoặc điều kiện đặc thù khác.

Không được tự điền trường còn thiếu, ghép line gần giống hoặc coi hai market tên giống nhau là tương đương khi chưa xác minh settlement.

Mapping phải có ba trạng thái:

- `VERIFIED`: đủ bằng chứng, được phép đi vào bộ tính chênh lệch.
- `REVIEW_REQUIRED`: có khả năng trùng nhưng thiếu bằng chứng, chỉ hiển thị để kiểm tra.
- `REJECTED`: có mâu thuẫn, không được so sánh.

## 6. Theo dõi biến động giá

Hệ thống duy trì quote book thời gian thực cho mọi sàn người dùng đã chọn và luôn hiển thị giá hiện tại của cùng một vé, kể cả khi chưa có lợi nhuận.

Mỗi thay đổi phải được phát hiện theo snapshot/delta kế tiếp và hiển thị tối thiểu:

- Trận và vé cược.
- Sàn vừa thay đổi.
- Cửa cược.
- Giá cũ và giá mới.
- Độ dịch chuyển.
- Thời điểm thay đổi.
- Độ trễ quan sát được so với các sàn còn lại.

Biến động giá chỉ là thông tin quan sát. Nó không tự động trở thành tín hiệu có thể cược nếu chưa đạt các điều kiện mapping, freshness, tài khoản và lợi nhuận.

## 7. Tính tiền và lợi nhuận

Mọi phép tính phải dùng số thập phân chính xác, không dùng số thực nhị phân theo cách có thể gây sai tiền.

Mặc định:

- Base stake: 100.000 VND.
- Base stake được đặt ở leg có odds thấp hơn.
- Ngưỡng cảnh báo: worst-case profit tối thiểu 20.000 VND.

Người dùng có thể cấu hình lại các giá trị này.

Hệ thống tính stake của leg đối ứng dựa trên:

- Odds hiện tại của hai cửa.
- Bước tiền cược của từng sàn.
- Min/max stake.
- Số dư khả dụng.
- Phí, hoa hồng và tỷ giá nếu có.
- Giới hạn bankroll do người dùng đặt.

Sau khi làm tròn theo bước tiền thực tế, kết quả phải hiển thị:

- Số tiền đặt ở từng leg.
- Tổng vốn sử dụng.
- Payout và lợi nhuận/lỗ nếu cửa thứ nhất thắng.
- Payout và lợi nhuận/lỗ nếu cửa thứ hai thắng.
- Worst-case profit.
- ROI.
- Các giả định về phí và tỷ giá.

Chỉ được coi là cơ hội có lợi nhuận khi cả hai kết quả đều dương sau toàn bộ chi phí và làm tròn.

## 8. Điều kiện tạo tín hiệu

Một cơ hội chỉ được đánh dấu màu xanh và phát toast trong 10 giây khi toàn bộ điều kiện sau đạt:

1. Hai leg nằm ở hai sàn khác nhau.
2. Cùng event và cùng vé cược hai cửa đã được mapping `VERIFIED`.
3. Settlement của hai bên đã được xác minh tương đương.
4. Cả hai market và selection đang `OPEN`.
5. Cả hai quote còn mới theo TTL của từng nguồn.
6. Cả hai tài khoản còn phiên hợp lệ, đủ số dư và chấp nhận mức cược.
7. Stake tuân thủ min/max/step của từng sàn.
8. Sau phí, tỷ giá và làm tròn, cả hai kết quả đều có lợi nhuận dương.
9. Worst-case profit đạt ngưỡng cấu hình; mặc định là 20.000 VND với base stake 100.000 VND.

Nếu bất kỳ điều kiện nào mất hiệu lực, tín hiệu phải được thu hồi ngay. Không dùng riêng màu sắc để truyền đạt trạng thái; luôn có nhãn hoặc lý do bằng chữ.

## 9. Kiểm tra trước khi đặt cược

Trước mỗi lần đặt, hệ thống phải kiểm tra lại gần như đồng thời ở cả hai sàn:

- Session/token.
- Canonical event, market, line và selection.
- Trạng thái market và khóa cược.
- Odds hiện tại và mức trượt giá cho phép.
- Min/max/step stake.
- Số dư.
- Lợi nhuận tệ nhất sau khi dùng dữ liệu vừa kiểm tra.
- Cơ hội chưa hết hạn và chưa có lần thực thi khác trên cùng market.

Chỉ khi cả hai preflight đều đạt, hệ thống mới được chuyển sang trạng thái sẵn sàng. Nếu một bên không chắc chắn hoặc lỗi, không gửi leg nào.

## 10. Thực thi hai leg

Các chế độ vận hành:

- `OBSERVE`: chỉ theo dõi và hiển thị.
- `PAPER`: mô phỏng bằng dữ liệu thật, không gửi cược.
- `ASSISTED`: chuẩn bị hai leg và yêu cầu người dùng xác nhận.
- `AUTO`: chỉ được bật cho cặp sàn/market đã vượt toàn bộ kiểm thử an toàn.

Hệ thống mặc định khởi động ở `OBSERVE`. Mọi lần thử bằng tiền thật phải có xác nhận rõ ràng của người dùng.

Khi được phép thực thi, hai request phải được gửi gần đồng thời, có idempotency, timeout và giới hạn trượt giá. Thành công phải dựa trên bet ID/receipt hoặc lịch sử cược từ sàn, không dựa vào toast trên giao diện.

Trạng thái thực thi tối thiểu:

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

Không được báo `HEDGED` trước khi cả hai leg có xác nhận. Nếu chỉ một leg thành công, hệ thống phải chuyển ngay sang `UNHEDGED`, phát cảnh báo mức cao nhất, khóa gửi thêm tự động và yêu cầu đối soát. Không tự chase odds, tự chọn kèo gần giống hoặc retry khi chưa biết request trước đã thành công hay chưa.

## 11. Giao diện

Giao diện tiếng Việt, tối thiểu gồm:

- Màn Bóng đá và LoL tách riêng.
- Bộ chọn sàn cần theo dõi.
- Trạng thái kết nối/session và độ mới dữ liệu của từng sàn.
- Danh sách trận, live/countdown và các sàn đang có trận đó.
- Bảng giá cùng hàng cho từng exact shared ticket.
- Chi tiết trận, mapping evidence và lịch sử biến động giá.
- Kế hoạch stake và lợi nhuận của cả hai kết quả.
- Danh sách cơ hội đang còn hiệu lực.
- Cảnh báo nổi bật cho dữ liệu stale, nguồn lỗi và trạng thái `UNHEDGED`.

Event chỉ có ở một sàn vẫn được hiển thị để quan sát. Event đã ghép nhưng chưa có exact shared ticket cũng được hiển thị, nhưng không được tính chênh lệch hoặc tạo tín hiệu.

Mọi nút đặt cược phải bị vô hiệu hóa kèm lý do cụ thể khi còn thiếu bất kỳ hard gate nào.

## 12. Nhật ký và khả năng truy vết

Hệ thống phải ghi audit log cho:

- Thời điểm nhận snapshot/quote.
- Thay đổi odds và trạng thái OPEN/SUSPENDED.
- Sequence gap, reconnect và lỗi schema.
- Bằng chứng và kết quả mapping.
- Kế hoạch stake và lý do tạo/thu hồi tín hiệu.
- Kết quả từng bước preflight.
- Request ID, bet ID/receipt và kết quả của từng leg.
- Các lần đối soát và sự cố partial execution.

Log không được chứa password, token, cookie, launch URL, secret hoặc payload nhạy cảm ở dạng đọc được.

## 13. Bảo mật và nguyên tắc fail-closed

- Credential và session secret phải được mã hóa bằng kho bí mật của hệ điều hành hoặc cơ chế tương đương.
- Browser profile phải tách theo tài khoản/provider khi cần.
- Không hard-code hoặc commit credential và production token.
- Khi session hết hạn, nguồn mất kết nối, quote stale, schema thay đổi, mapping mâu thuẫn hoặc không tạo được audit bền vững, execution gate phải đóng.
- Không tự vượt CAPTCHA, anti-bot hoặc truy cập quyền mà tài khoản người dùng không được cấp.

## 14. Giới hạn bắt buộc phải hiểu

Hai sàn độc lập không cung cấp giao dịch hai leg nguyên tử. Giữa hai request, odds có thể đổi, market có thể khóa, limit có thể giảm hoặc session có thể hết hạn. Vì vậy sản phẩm không được tuyên bố bảo đảm 100% cả hai leg luôn được nhận hoặc lợi nhuận luôn chắc chắn.

Hệ thống chỉ có thể giảm rủi ro bằng cách:

- Dùng dữ liệu mới nhất có thể.
- Mapping và settlement nghiêm ngặt.
- Preflight hai bên sát thời điểm đặt.
- Gửi hai leg gần đồng thời.
- Giới hạn trượt giá.
- Fail-closed khi không chắc chắn.
- Phát hiện và xử lý rõ ràng trường hợp chỉ một leg được nhận.

## 15. Ngoài phạm vi

- Kèo ba cửa dùng cho chiến lược cân hai bên.
- Tự ghép market gần giống, khác line, khác hiệp/map hoặc khác settlement.
- Tự động chase giá, martingale hoặc đặt thêm kèo để cứu một leg.
- Cam kết lợi nhuận tuyệt đối.
- Bỏ qua hạn chế truy cập, CAPTCHA hoặc cơ chế bảo vệ của sàn.
- Hỗ trợ một sàn mới trước khi có adapter, mapping rules, settlement profile và kiểm thử tương ứng.

## 16. Tiêu chí nghiệm thu sản phẩm

Sản phẩm được coi là đáp ứng mục tiêu khi:

1. Football và LoL được tách thành hai luồng dữ liệu và giao diện độc lập.
2. Năm sàn mục tiêu có thể cung cấp event, market, quote, trạng thái và thông tin tài khoản cần thiết bằng dữ liệu thật.
3. Không có mapping chưa xác minh nào đi vào bộ tính chênh lệch.
4. Giá mới được xử lý ngay và biến động lệch nhịp giữa các sàn được phát hiện theo lần cập nhật kế tiếp.
5. Stake plan phản ánh đúng odds, rounding, min/max/step, balance, fee và FX thực tế.
6. Tín hiệu chỉ xuất hiện khi cả hai kết quả đạt ngưỡng lợi nhuận tệ nhất đã cấu hình.
7. Một preflight gate thất bại đồng nghĩa không có leg nào được gửi.
8. `HEDGED` chỉ xuất hiện khi có xác nhận thành công của cả hai leg.
9. Partial execution được phát hiện, cảnh báo và đối soát mà không tự tạo thêm rủi ro.
10. Toàn bộ luồng dữ liệu, mapping, quyết định và thực thi có audit trail, không làm lộ secret.
