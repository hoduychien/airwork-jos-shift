# Airwork JOS Shift — Website chia ca trực tự động

Ứng dụng xếp lịch ca trực theo tháng cho team vận hành 9–15 người, 3 ca/ngày
(S1 sáng 6:00–14:00 · S2 chiều 14:00–22:00 · S3 đêm 22:00–6:00), solver
constraint-based chạy trong Web Worker, backend Supabase (database + auth +
realtime).

## Tính năng

- **Tạo lịch tự động** thỏa mãn toàn bộ ràng buộc cứng:
  - Mỗi ngày mỗi ca có tối thiểu N người (mặc định 2, chỉnh được).
  - Nghỉ giữa 2 ngày làm luôn ≥ 16h — 2 ngày làm liên tiếp bắt buộc cùng ca;
    cấm mọi chuyển ca S2→S1, S3→S2, S3→S1 giữa 2 ngày liền kề.
  - Chuỗi làm 2–5 ngày cùng ca; solver nhắm nghỉ 1–2 ngày giữa các chuỗi
    (nghỉ liên tục dài hơn vẫn hợp lệ).
  - Cân bằng 20–21 ca/người/tháng, chênh lệch tổng ca ≤ 1.
  - Preferences: ưu tiên ca đêm (quota là ưu tiên mềm — solver tối đa hóa
    nhưng làm ít hơn số đăng ký vẫn hợp lệ; luôn giữ ≥2 ca S1 và ≥2 ca S2),
    cấm từng ca, ngày nghỉ cố định, số ca tối đa/tháng.
  - Chia đều ca cho mọi nhân viên — ưu tiên cao nhất sau ràng buộc cứng, xếp
    trên cả quota ca đêm: trong cùng nhóm ràng buộc (làm cả 3 ca / không S3 /
    ưu tiên đêm / …) mỗi loại ca chênh ≤ 2 giữa các người; người làm cả S1 và
    S2 có |S1 − S2| ≤ 2. Sau khi đạt mọi rule, solver vẫn dành thêm ~1.5s để
    kéo chênh lệch xuống thấp nhất.
- **Tạo lại (shuffle)** ra phương án khác; **chỉnh tay từng ô** với realtime
  validate — ô vi phạm viền đỏ kèm tooltip giải thích.
- Cảnh báo **xung đột ràng buộc** rõ ràng khi bài toán vô nghiệm (ví dụ quá
  nhiều người không làm ca đêm) thay vì trả lịch sai.
- Bảng lịch kiểu Excel: thứ tiếng Việt, tô vàng T7/CN, màu ca đúng chuẩn
  (S1 vàng, S2 xanh lá, S3 cam, OFF xám), cột tổng từng người, hàng summary
  OK/LOW theo ngày.
- Export **Excel (.xlsx)** giữ nguyên màu/layout và **CSV** (UTF-8 BOM).
- Quản lý nhân viên: CRUD, kéo thả sắp thứ tự. **Ràng buộc ca (ưu tiên đêm, cấm
  ca, số ca tối đa) và ngày nghỉ đều thiết lập THEO THÁNG**: mỗi tháng một bộ,
  tháng chưa cấu hình dùng mặc định trên hồ sơ, có nút "Sao chép từ tháng
  trước" (Supabase: bảng `employee_month_settings`, migration 004).
- Draft → **Publish**; giữ lịch sử các tháng cũ; **Supabase Realtime** đồng bộ
  live khi admin chỉnh tay.
- **Đăng nhập & phân quyền**: chỉ tài khoản **admin** mới được xếp lịch, chỉnh
  ô, publish, quản lý nhân viên và cài đặt; thành viên chỉ xem lịch đã chốt.
  Chế độ demo: tài khoản = mã nhân viên (gõ `ChienHD` hoặc `ChienHD2` đều
  được), mật khẩu ban đầu `123456`, bắt buộc đổi mật khẩu ở lần đăng nhập
  đầu tiên; `ChienHD2` là admin, admin đổi vai trò / đặt lại mật khẩu trong
  Nhân viên. Chế độ Supabase: đăng nhập email + mật khẩu; admin quản lý tài
  khoản ngay trên trang Nhân viên (cột Tài khoản / Vai trò: tạo tài khoản
  `<mã>@domain`, đổi vai trò, đặt lại mật khẩu; tài khoản chưa gắn nhân viên
  liệt kê riêng để gắn) qua các hàm SQL trong `migrations/003_admin_accounts.sql`. Người đầu tiên cần được cấp admin bằng
  SQL (xem cuối `supabase/seed.sql`).
- **Màn hình lỗi** thống nhất: 404 (đường dẫn sai), 403 (thành viên vào trang
  admin), 500 (lỗi runtime — ErrorBoundary bắt cả promise bị từ chối, kèm chi
  tiết kỹ thuật thu gọn), 503 (mất mạng / Supabase không phản hồi, có nút thử
  lại), 401 (phiên hết hạn). Xem trước tại `/loi/404`, `/loi/403`, `/loi/500`,
  `/loi/503`, `/loi/401`.
- Chưa cấu hình Supabase? App tự chạy **chế độ demo** với localStorage + seed
  9 nhân viên mẫu — `npm run dev` là dùng được ngay.

## Chạy nhanh (chế độ demo)

```bash
npm install
npm run dev
```

Mở http://localhost:5173 — dữ liệu mẫu gồm 9 nhân viên (2 người ưu tiên ca
đêm ≥16 ca, 1 người không làm ca đêm).

## Kết nối Supabase

1. Tạo project tại https://supabase.com → **New project**.
2. Mở **SQL Editor**, chạy lần lượt:
   - `supabase/migrations/001_init.sql` (schema + RLS + realtime)
   - `supabase/migrations/003_admin_accounts.sql` (hàm quản lý tài khoản cho admin)
   - `supabase/migrations/004_employee_month_settings.sql` (ràng buộc ca theo tháng)
   - `supabase/seed.sql` (9 nhân viên mẫu)
3. **Authentication → Providers → Email**: bật Email provider, **tắt** "Confirm
   email". Tạo tài khoản tại **Authentication → Users → Add user** (email, mật
   khẩu tạm, tick Auto Confirm, metadata `{"must_change_password": true}`), rồi
   gán vai trò bằng SQL ở cuối `supabase/seed.sql`.
4. Cấu hình env:

   ```bash
   cp .env.example .env
   # điền từ Dashboard → Settings → API
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

5. `npm run dev`, đăng nhập bằng magic link, rồi cấp quyền admin cho mình
   (SQL Editor):

   ```sql
   insert into user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'ban@congty.vn';
   ```

   Role `member` chỉ đọc lịch đã publish và tự ghi ngày nghỉ của mình
   (gắn `employee_id` vào hàng user_roles tương ứng).

## Kiến trúc

```
src/
  components/       Layout (side-rail), ScheduleGrid (bảng lịch + dropdown + tooltip)
  hooks/            useSolver (Web Worker wrapper)
  lib/
    solver/         solver.ts (thuật toán), validate.ts (kiểm tra ràng buộc), worker.ts
    supabase.ts     client + phát hiện chế độ demo
    store.ts        data layer: SupabaseStore / LocalStore cùng interface
    export.ts       xuất .xlsx (ExcelJS, giữ màu) và .csv
    types.ts        kiểu dữ liệu + hằng số ca
  pages/            SchedulePage, EmployeesPage, SettingsPage, LoginPage
supabase/
  migrations/001_init.sql   schema + RLS + realtime publication
  seed.sql                  dữ liệu mẫu
```

### Thuật toán (lib/solver)

Solver constraint-based nhiều tầng, chạy trong Web Worker:

1. **Integrated builder** — xếp từng người một: DFS chọn đồng thời (gap nghỉ,
   độ dài block, ca của block); người xếp sau nhìn thấy chính xác các ô
   (ngày, ca) còn thiếu để trám. Người ưu tiên ca đêm được ép cấu trúc block
   `[~4,4,4,4]` cho quota S3 + 2 block nhỏ cho S1/S2.
2. **LNS (coordinate descent)** — gỡ từng người ra xây lại khi đã thấy toàn
   cảnh, kèm **micro-move chain**: chuyển 1 ngày thừa sang ô thủng qua chuỗi
   augmenting (độ sâu 3) — bước quyết định giúp đóng các lỗ hổng cuối.
3. **Chain repair + local search** trên block (đổi ca nguyên block có rollback)
   và vòng polish cuối dồn budget vào phương án tốt nhất.
4. **San đều ca** (`lib/solver/fairness.ts`) khi lịch đã hợp lệ: hoán đổi đoạn
   lịch giữa 2 người (độ phủ từng ngày bất biến, chỉ kiểm tra lại chuỗi
   làm/nghỉ) xen kẽ LNS theo cặp — gỡ 2 người đang lệch nhau, xây lại rồi vá
   độ phủ — cho tới khi mỗi loại ca chênh ≤ 2 trong từng nhóm ràng buộc.
5. Mọi kết quả đều qua `validateMatrix` — một nguồn sự thật duy nhất cho cả
   solver, realtime validate khi chỉnh tay, và unit tests.

Vì mỗi block làm việc chỉ mang một ca và các block cách nhau ≥1 ngày nghỉ,
ràng buộc "nghỉ ≥16h giữa 2 ngày làm" được thỏa mãn theo cấu trúc.

## Tests

```bash
npm test
```

41 test Vitest phủ từng ràng buộc mục nghiệp vụ: không chuyển ca khác nhau
giữa 2 ngày liền kề, nghỉ luôn ≥16h, chuỗi làm 2–5 ngày, độ phủ tối thiểu,
cân bằng ±1, quota ca đêm mềm + ≥2 ca S1/S2, ngày nghỉ cố định, cấm ca,
chia đều ca cho nhóm không làm đêm, và chẩn đoán vô nghiệm.

## Scripts

| Lệnh              | Mô tả                          |
| ----------------- | ------------------------------ |
| `npm run dev`     | Dev server (Vite)              |
| `npm run build`   | Type-check + build production  |
| `npm run preview` | Xem thử bản build              |
| `npm test`        | Chạy unit tests (Vitest)       |
