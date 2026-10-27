# HƯỚNG DẪN SỬ DỤNG PHẦN MỀM ZALO SYNC
**Dành cho Cán bộ Nhân viên & Ban Điều Hành Dự Án**

---

## 1. Giới thiệu chung & Mục đích sử dụng

**Zalo Sync** là phần mềm chuyên dụng được đóng gói dành cho cán bộ nhân viên, ban chỉ đạo và các ban điều hành công trường.

* **Mục đích:** Tự động thu thập, sao lưu toàn bộ tin nhắn, tài liệu, hình ảnh, báo cáo thi công từ các nhóm Zalo công việc về máy tính cá nhân. Dữ liệu này giúp lưu trữ lịch sử báo cáo công trường và phục vụ kết nối trực tiếp với các mô hình AI tự động hóa hỗ trợ công việc.
* **Bảo mật tuyệt đối:** Ứng dụng **chỉ đọc** dữ liệu Zalo trên chính máy tính của bạn, không gửi thông tin tài khoản, mật khẩu hay dữ liệu ra ngoài Internet.
* **Tiện lợi tối đa:** Đóng gói trong **1 file duy nhất (`ZaloSync.exe`)**, không cần cài đặt phần mềm phụ trợ (không cần Node.js, không cần quyền Quản trị viên/Administrator).

---

## 2. Chuẩn bị trước khi sử dụng

1. **Đăng nhập Zalo PC:** Máy tính của bạn cần có phần mềm Zalo máy tính (Zalo PC) và đã đăng nhập tài khoản Zalo cá nhân ít nhất một lần.
2. *(Mẹo tải tin nhắn cũ):* Zalo PC mặc định chỉ lưu dữ liệu gần đây. Nếu bạn muốn sao lưu dữ liệu cũ từ các tháng trước, hãy mở Zalo PC, bấm vào nhóm cần lấy và **cuộn chuột lên trên** một vài trang để Zalo tải tin nhắn và tài liệu về máy trước khi bắt đầu.

---

## 3. Khởi động phần mềm

* **Cách 1 (Mở trực tiếp):** Bấm đúp chuột vào file `ZaloSync.exe`.
  *(Lưu ý: Lần đầu tiên khởi chạy, phần mềm sẽ mất khoảng 3–5 giây để tự động giải nén môi trường hoạt động).*
* **Cách 2 (Tạo lối tắt ra màn hình):** Bấm đúp vào file `CaiDat (tuy chon).bat`. Phần mềm sẽ tự động tạo biểu tượng **Zalo Sync** ngoài màn hình Desktop để bạn mở nhanh trong các lần sau.
* **Nâng cấp từ bản cũ:** Nếu máy đã dùng bản cũ, hãy thoát hẳn bản cũ (chuột phải biểu tượng ở khay hệ thống → **Thoát hẳn**) rồi mở bản mới. Cấu hình, các nhóm đã chọn, tiến độ đồng bộ và lịch chạy tự động được tự chuyển sang; thư mục mặc định trong Documents được đổi theo tên mới (`Documents\ZaloSync`), thư mục bạn tự chọn giữ nguyên. Có thể xoá file exe và lối tắt của bản cũ.

---

## 4. Thiết lập ban đầu (Chỉ thực hiện 1 lần duy nhất)

Khi mở ứng dụng lần đầu tiên, giao diện cấu hình nhanh (Wizard) sẽ hướng dẫn bạn qua 4 bước đơn giản:

### Bước 1: Phát hiện tài khoản Zalo trên máy
Hệ thống tự động quét và nhận diện tài khoản Zalo đang hoạt động trên máy tính của bạn (kèm theo mã UID và số lượng nhóm/hội thoại).
* Nhấp chuột chọn dòng tài khoản của bạn.
* Bấm nút màu cam **Tiếp tục →** ở góc dưới bên phải.

![Bước 1 — Phát hiện Zalo trên máy](step1-860x640.png)

---

### Bước 2: Tự động dò khóa giải mã
Cơ sở dữ liệu Zalo được mã hóa bảo vệ trên máy. Zalo Sync đã tích hợp sẵn công nghệ tự động trích xuất và xác minh khóa hoàn toàn tự động.
* Bạn **không cần tìm kiếm hay nhập bất kỳ mật mã nào**.
* Khi màn hình hiện dòng thông báo xanh: `✓ Đã tự dò được khóa và xác minh thành công.`
* Bấm **Tiếp tục →**.

![Bước 2 — Khóa giải mã tự động](step2-860x640.png)

---

### Bước 3: Chọn nhóm dự án cần đồng bộ
Ứng dụng sẽ liệt kê danh sách các nhóm Zalo mà tài khoản của bạn tham gia (các nhóm công trường, ban điều hành, phòng ban mà bạn tham gia).
* Bạn có thể bấm nút **"Chọn tất cả"** hoặc bỏ chọn và tích vào các nhóm dự án bạn trực tiếp theo dõi.
* Bấm **Tiếp tục →**.

![Bước 3 — Chọn nhóm cần đồng bộ](step3-860x640.png)

---

### Bước 4: Đặt nơi lưu & Giờ chạy tự động
* **Tên dự án:** Mặc định là `Zalo Sync — dữ liệu nhóm công trường` (có thể giữ nguyên).
* **Thư mục lưu dữ liệu:** Mặc định lưu tại thư mục `Documents\ZaloSync\data` của máy. Bạn có thể bấm nút **"Chọn..."** nếu muốn đổi sang ổ D: hoặc E:.
* **Giờ chạy tự động hằng ngày:** Khuyến nghị đặt lúc **`04:15 AM`** (sáng sớm). Đây là thời điểm máy ít hoạt động, phần mềm sẽ tự động thu thập trọn vẹn dữ liệu của ngày hôm trước mà không làm ảnh hưởng đến công việc của bạn.
* Bấm nút cam **✔ Hoàn tất & lưu**.

![Bước 4 — Nơi lưu & lịch chạy](step4-860x640.png)

---

## 5. Hướng dẫn sử dụng hằng ngày (Bảng điều khiển)

Sau khi hoàn tất cấu hình, bạn sẽ vào màn hình **Bảng điều khiển**. Tại đây, bạn có thể dễ dàng quản lý việc đồng bộ qua các nút chức năng:

![Bảng điều khiển Zalo Sync](dashboard-860x640.png)

### Ý nghĩa các nút thao tác:

| Nút bấm | Ý nghĩa & Hướng dẫn sử dụng |
| :--- | :--- |
| **▶ Chạy ngay** (Nút màu cam) | Nhấp để bắt đầu đồng bộ dữ liệu ngay lập tức. Cửa sổ đen phía dưới sẽ hiển thị tiến trình quét tin nhắn, tải ảnh, tải file văn bản/bản vẽ. |
| **⏰ Bật tự động** | **Rất khuyến nghị:** Bấm nút này 1 lần. Ứng dụng sẽ tự động đăng ký với Windows để chạy ngầm đúng vào giờ bạn đã chọn ở Bước 4 (ví dụ 04:15 sáng). Khi đã bật, trạng thái sẽ báo `BẬT`. |
| **📁 Thư mục dữ liệu** | Bấm để mở ngay thư mục chứa toàn bộ tin nhắn, hình ảnh, biên bản, báo cáo công trường đã tải về máy tính. |
| **📋 Xuất log** | Khi gặp lỗi hoặc cần hỗ trợ, bấm nút này. Phần mềm sẽ tự động xuất file nhật ký (đã ẩn khóa an toàn) và tự mở thư mục báo cáo. Bạn chỉ cần gửi file này cho bộ phận kỹ thuật / AI hỗ trợ. |
| **Chạy thử** (Dry Run) | Chạy thử nghiệm quét dữ liệu mà không tải file nặng về ổ cứng (dùng để kiểm tra kết nối). |
| **⚙ Thiết lập lại** | Cho phép bạn quay lại giao diện 4 bước ban đầu để chọn thêm nhóm hoặc đổi thư mục lưu bất kỳ lúc nào. |

---

## 6. Chế độ chạy ngầm (Khay hệ thống - System Tray)

* Khi bạn bấm nút đóng cửa sổ **[X]** hoặc nút thu nhỏ **[-]**, phần mềm **không bị tắt hẳn** mà sẽ tự động thu nhỏ về **Khay hệ thống** (ở góc dưới cùng bên phải màn hình, cạnh đồng hồ Windows).
* Biểu tượng ô vuông bo góc màu cam có chữ **Z** màu trắng ở khay cho biết ứng dụng vẫn đang chạy ngầm sẵn sàng. (Ở cỡ lớn — Desktop, thanh tác vụ — chữ **Z** được bao quanh bởi hai mũi tên xoay vòng, biểu tượng đồng bộ.)
* **Cách thao tác trên khay hệ thống:**
  * **Bấm đúp chuột vào biểu tượng Zalo Sync:** Mở lại giao diện Bảng điều khiển.
  * **Nhấp chuột phải vào biểu tượng:** Menu hiện ra cho phép chọn **"Mở giao diện"**, **"Chạy ngay"** hoặc **"Thoát hẳn"**.

---

## 7. Các câu hỏi thường gặp & Lưu ý quan trọng

1. **Phần mềm có làm lộ tin nhắn hay mật khẩu Zalo không?**
   * *Hoàn toàn không.* Phần mềm chạy hoàn toàn cục bộ trên máy của bạn (offline/local), chỉ đọc dữ liệu của tài khoản đang đăng nhập trên máy đó và lưu thẳng vào thư mục trên ổ cứng của bạn. Khóa giải mã cũng được che kín khi xuất log.
2. **Tôi có cần bật phần mềm này liên tục không?**
   * Chỉ cần bấm nút **"Bật tự động"** một lần duy nhất. Windows sẽ tự động kích hoạt tác vụ chạy ngầm hằng ngày mà không cần bạn phải mở sẵn cửa sổ ứng dụng.
3. **Nếu vào giờ chạy tự động máy tính đang tắt thì sao?**
   * Tác vụ đã được cấu hình chế độ bù giờ: khi bạn mở máy tính lên làm việc, hệ thống sẽ tự động phát hiện và thực hiện lượt chạy bù cho bạn.
4. **Khi gặp trục trặc thì liên hệ hỗ trợ như thế nào?**
   * Bạn chỉ cần bấm nút **"Xuất log"** trên Bảng điều khiển. Thư mục `baocao` sẽ tự động mở ra với file nhật ký dạng `ZaloSync_log_...txt`. Hãy gửi file này cho nhân sự phụ trách công nghệ hoặc chuyển cho trợ lý AI để được hướng dẫn xử lý ngay lập tức.
