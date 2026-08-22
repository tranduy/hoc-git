# Top 25 exact two-book tickets

## Mục tiêu

Màn hình Football luôn ưu tiên tối đa 25 vé có ROI tốt nhất từ toàn bộ vé đối nghịch chính xác đang quan sát được. Danh sách xếp theo vé, không xếp theo trận, nên một trận có thể có nhiều vé hợp lệ.

## Phạm vi dữ liệu

- Chỉ nhận vé có đúng hai kết quả đối nghịch, cùng trận, cùng market, cùng line và thuộc hai sàn khác nhau.
- Không tạo dữ liệu giả, không đưa vé một sàn vào bảng xếp hạng và không nới lỏng điều kiện mapping.
- Bao gồm cả ROI dương, bằng không và âm; ROI giảm dần quyết định thứ tự.
- Tối đa 25 vé. Nếu nguồn thật có dưới 25 cặp chính xác thì chỉ hiển thị số có thật.
- Bộ lọc Live/Pre-match và các sàn được chọn vẫn áp dụng trước khi xếp hạng.

## Giao diện

- Mỗi dòng đại diện cho một vé, hiển thị trận, market/line, đúng hai sàn, odds, ROI và lợi nhuận cân bằng.
- Click dòng vẫn ghim chi tiết trận ở cột phải và làm nổi đúng vé được chọn.
- Màu ROI giữ quy ước hiện tại; danh sách không được thêm hàng chờ ghép để đủ số lượng giả tạo.

## Luồng xử lý

1. Tạo các `RankedTicket` hợp lệ cho từng sự kiện đã map.
2. Làm phẳng vé của mọi sự kiện đang hiển thị.
3. Loại trùng theo event key và ticket key.
4. Sắp xếp theo ROI, worst-case profit, biến động giá và khóa ổn định.
5. Lấy 25 vé đầu và render.

## Kiểm thử

- Nhiều vé của cùng một trận đều có thể lọt top 25.
- Danh sách được sắp ROI giảm dần và giới hạn đúng 25.
- Không có vé một sàn hoặc vé không có plan.
- Click một vé ghim đúng trận và đúng vé.
- Test web, typecheck, production build và kiểm tra local trước khi deploy.

