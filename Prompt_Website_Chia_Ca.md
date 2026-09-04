# PROMPT: Xây dựng Website Chia Ca Trực (Shift Scheduler)

> Copy toàn bộ nội dung dưới đây làm prompt cho AI code generator (Claude, Cursor, v0, Bolt...)

---

Bạn là một senior fullstack developer. Hãy xây dựng cho tôi một **website chia ca trực tự động** hoàn chỉnh với **ReactJS (Vite + TailwindCSS)** ở frontend và **Supabase** làm backend (database + auth). Website phục vụ team vận hành ~9-15 người, chia 3 ca/ngày, xếp lịch theo tháng.

## 1. Nghiệp vụ chia ca (BẮT BUỘC tuân thủ)

### 1.1. Ca làm việc
- **S1 (Ca sáng):** 6:00 - 14:00
- **S2 (Ca chiều):** 14:00 - 22:00
- **S3 (Ca đêm):** 22:00 - 6:00 hôm sau
- **OFF:** ngày nghỉ
- Mỗi ca đi sớm 10 phút để handover (chỉ hiển thị ghi chú, không ảnh hưởng thuật toán).

### 1.2. Ràng buộc cứng (hard constraints) — thuật toán KHÔNG được vi phạm
1. **Độ phủ:** mỗi ngày, mỗi ca phải có **tối thiểu N người** (mặc định N=2, admin chỉnh được).
2. **Nghỉ giữa 2 ngày làm phải > 8 tiếng.** Cách đảm bảo: **2 ngày làm liên tiếp phải CÙNG một ca** (nghỉ 16 tiếng). Tuyệt đối cấm các chuyển ca ngày liền kề: S2→S1 (chỉ nghỉ 8h), S3→S2 (chỉ nghỉ 8h), S3→S1 (0h), và mọi chuyển ca X→Y khác ca khi 2 ngày sát nhau.
3. **Nguyên tắc streak:** mỗi người làm **1 ca xuyên suốt 2-5 ngày liên tục**, sau đó **nghỉ 1-2 ngày**, rồi mới được đổi sang ca khác. Không có chuỗi làm việc quá 5 ngày, không có chuỗi nghỉ quá 2 ngày (trừ đầu/cuối tháng).
4. **Cân bằng khối lượng:** mỗi người làm 20-21 ca/tháng (tháng 31 ngày), nghỉ 10-11 ngày. Chênh lệch tổng ca giữa người nhiều nhất và ít nhất ≤ 1.
5. **Tôn trọng preferences cá nhân** (mục 1.3).

### 1.3. Preferences cá nhân (cấu hình bằng checkbox/input trên UI cho từng nhân viên)
- ☑ **Ưu tiên ca đêm (S3):** kèm input "tối thiểu ___ ca đêm/tháng" (ví dụ 16). Người này vẫn phải có 2-3 ca S1 và 2-3 ca S2 để không quên việc các ca khác.
- ☑ **Không làm ca S1** (ca sáng)
- ☑ **Không làm ca S2** (ca chiều)
- ☑ **Không làm ca S3** (ca đêm) — ví dụ người có con nhỏ
- ☑ **Đăng ký ngày nghỉ cố định:** chọn các ngày cụ thể trong tháng bắt buộc OFF (nghỉ phép, việc riêng)
- Input **số ca tối đa/tháng** (mặc định 21)
- Nếu tổng preferences khiến bài toán vô nghiệm (ví dụ quá nhiều người không làm S3), hiển thị cảnh báo rõ ràng nêu ràng buộc nào xung đột thay vì trả lịch sai.

### 1.4. Mục tiêu tối ưu (soft objectives)
- Cân bằng số ca S1/S2/S3 giữa những người không có preference đặc biệt (chênh lệch S3 ≤ 2, |S1 - S2| của mỗi người ≤ 2).
- Hạn chế chuỗi làm việc 1 ngày lẻ loi (OFF - làm 1 ngày - OFF).
- Xoay vòng ca công bằng theo tuần: không ai bị kẹt 1 ca cả tháng (trừ người có preference).

### 1.5. Thuật toán
- Viết solver dạng **constraint-based** chạy phía client (Web Worker để không đứng UI): backtracking + heuristic, hoặc mô hình hóa kiểu CP (biến x[người][ngày] ∈ {S1,S2,S3,OFF}).
- Solver nhận input: danh sách nhân viên + preferences, tháng/năm, số người tối thiểu mỗi ca. Output: ma trận lịch.
- Có nút **"Tạo lịch tự động"**, **"Tạo lại (shuffle)"** để ra phương án khác, và cho phép **chỉnh tay từng ô** sau khi tạo — khi chỉnh tay, hệ thống realtime validate và highlight đỏ ô vi phạm (thiếu người, nghỉ <8h, đổi ca không có ngày nghỉ đệm, quá 5 ngày liên tục...) kèm tooltip giải thích vi phạm gì.

## 2. Giao diện (UI)

### 2.1. Trang chính — Bảng lịch tháng
- Grid giống Excel: cột = ngày 1→31 (hiện thứ tiếng Việt: Thứ Hai...Chủ nhật, tô vàng T7/CN), hàng = nhân viên.
- Ô ca tô màu: **S1 vàng (#FFFF00), S2 xanh lá (#92D050), S3 cam (#ED7D31), OFF xám nhạt**. Click ô để đổi ca thủ công (dropdown S1/S2/S3/OFF).
- Cột tổng bên phải mỗi người: số ca S1, S2, S3, ngày OFF, tổng ca.
- Hàng summary dưới cùng: số người mỗi ca theo từng ngày + hàng kiểm tra "OK/LOW" so với mức tối thiểu.
- Thanh chọn tháng/năm, nút Tạo lịch, nút Export **Excel (.xlsx)** và **CSV** đúng layout và màu như trên.
- Responsive: mobile xem được dạng cuộn ngang hoặc dạng "lịch của tôi" theo từng người.

### 2.2. Trang quản lý nhân viên
- CRUD nhân viên: tên, mã NV, các checkbox preferences ở mục 1.3.
- Kéo thả sắp thứ tự hiển thị.

### 2.3. Trang cài đặt
- Số người tối thiểu/ca, giờ các ca, độ dài streak min/max, độ dài nghỉ min/max.
- Các thay đổi lưu vào Supabase.

## 3. Supabase

### 3.1. Schema (viết SQL migration đầy đủ)
```sql
employees   (id uuid pk, name text, code text, display_order int,
             prefer_night bool default false, min_night_shifts int default 0,
             no_s1 bool default false, no_s2 bool default false, no_s3 bool default false,
             max_shifts_per_month int default 21, active bool default true, created_at)
schedules   (id uuid pk, month int, year int, status text check in ('draft','published'),
             min_per_shift int default 2, created_by uuid, created_at)
shift_assignments (id uuid pk, schedule_id fk→schedules, employee_id fk→employees,
             day int, shift text check in ('S1','S2','S3','OFF'),
             is_manual_override bool default false, unique(schedule_id, employee_id, day))
day_off_requests (id uuid pk, employee_id fk, month int, year int, day int, note text)
settings    (id, key text unique, value jsonb)
```

### 3.2. Yêu cầu backend
- Bật **Row Level Security** trên mọi bảng; role `admin` được ghi, role `member` chỉ đọc lịch published và ghi day_off_requests của chính mình.
- Auth bằng Supabase Auth (email magic link).
- Dùng **Supabase Realtime** để lịch cập nhật live khi admin chỉnh tay.
- Lưu lịch dạng draft, nút **Publish** để chốt; giữ lịch sử các tháng cũ để xem lại.

## 4. Chất lượng code
- React 18 + Vite + TailwindCSS, TypeScript, cấu trúc: `components/`, `hooks/`, `lib/solver/`, `lib/supabase.ts`, `pages/`.
- Solver có **unit tests** (Vitest) cho từng ràng buộc mục 1.2: test không có chuyển ca ngày liền kề khác ca, test nghỉ luôn ≥16h, test streak 2-5 ngày, test độ phủ, test preferences.
- Có README hướng dẫn: tạo project Supabase, chạy migration, cấu hình `.env` (SUPABASE_URL, SUPABASE_ANON_KEY), `npm run dev`.
- Seed data mẫu: 9 nhân viên, trong đó 2 người ☑ ưu tiên ca đêm (min 16 ca), 1 người ☑ không làm ca đêm.

Hãy trả về đầy đủ: SQL migration, toàn bộ source code các file chính (solver, grid component, trang nhân viên, export Excel), và README.
