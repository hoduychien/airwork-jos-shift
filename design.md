# Design — Airwork JOS Shift

Hệ thống thiết kế đã khóa cho app nội bộ chia ca. Mọi trang đọc file này trước khi sửa giao diện;
không đổi theme theo từng trang — cần gì thì bổ sung vào đây.

## Genre
modern-minimal, nhánh utilitarian ("bảng điều khiển trực ca"): dữ liệu dày, viền rõ, ít trang trí.

## Macrostructure family
- App pages (Lịch ca, Nhân viên, Cài đặt, Đổi mật khẩu): **Console** — thanh trên full bề rộng,
  tiêu đề trang là dải mỏng kẻ đậm 2px, thanh công cụ một hàng, dải số liệu thật (stat strip),
  vùng dữ liệu chiếm toàn bề rộng, khối phụ (checklist) dưới dữ liệu.
- Auth pages (Đăng nhập, Đổi mật khẩu lần đầu): **H2 Split** theo DNA — form trái trên giấy trắng
  với eyebrow chip, mảng phải nền tối chứa khối hình phẳng bằng CSS (đĩa, vành, lục giác) màu sản phẩm.

## Theme — studied-DNA (nguồn: https://www.together.ai/, tham chiếu công khai)
- Paper trắng tinh, ink đen cho chữ và viền. **Màu chủ đạo = cam thương hiệu** `--color-accent oklch(58% 0.2 38)`
  (nút chính, wordmark, ngày nghỉ được chọn); nút phụ = đen 8 % không viền.
- Tín hiệu `--color-signal oklch(66% 0.22 40)` (#fc4c02) cho gạch nav đang chọn, focus, avatar admin, dòng đang
  chọn, chấm chỉnh tay, dải demo.
- Bảng màu sản phẩm pastel (tím, cyan, xanh, hồng, cam) làm nền thẻ số liệu, bảng giờ ca, khối hình đăng nhập.
- Nền tối `--color-ink-deep` (#010120) chỉ cho mảng hình màn đăng nhập.
- Màu ô ca S1/S2/S3 là hex bắt buộc theo Excel nghiệp vụ.
- Trục theme: nền sáng / grotesk hình học / accent ấm.

## Typography (2 họ — vai trò lấy từ DNA, font thay bằng bản miễn phí có tiếng Việt)
- Display + thân: **Manrope** 400–800 (thay The Future, font thương mại), tiêu đề tracking −0.03em, weight 600.
- Nhãn, nút, số liệu, nav: **JetBrains Mono** (thay PP Neue Montreal Mono). Nút viết hoa, cao 2.5em, giãn 0.04em.
- Không italic tiêu đề. Không thêm họ chữ thứ ba.

## Spacing & hình khối
Thang 4pt (`--space-*`). Trang `gap: --space-md`. Bo góc 4/8/12px theo DNA, viền 1px, kẻ đậm 2px
dưới tiêu đề trang. Không bóng đổ trừ menu nổi.

## Motion
Chỉ `transform`/`opacity`/màu nút, easing DNA `cubic-bezier(.215,.61,.355,1)`, 150–260ms, không reveal
khi cuộn (DNA dùng GSAP ScrollTrigger — cố ý không mang sang app dữ liệu), reduced-motion về 1ms.

## Microinteractions
Thành công im lặng (✓ Đã lưu 2 giây). Menu ô ca mở tại chỗ, Esc/click ngoài để đóng.
Tooltip vi phạm hiện ngay khi hover.

## CTA voice
- Primary: nền ink, chữ trắng, radius 3px, Plex 600.
- Secondary: nền trắng, viền `--color-line-strong`. Nhóm nút liền: `.btn-group`.
- Trong bảng: `.btn-ghost.btn-sm`, xóa: `.btn-danger`.

## Thành phần dùng chung (`src/layout.css`)
`.topbar/.topnav/.user-tag` · `PageHeader` · `.toolbar/.month-nav/.btn-group` · `.stat-strip/.stat` ·
`.table-wrap/.table/.chip/.avatar-sm` · `.form-section` · `.status-list/.status-row/.status-tag` ·
`AuthShell` (`.auth/.auth-panel/.auth-head/.auth-hours`).

## Trang PHẢI chia sẻ
Wordmark AW mono, accent ink + signal, cặp font, giọng nút, mẫu tiêu đề trang, bảng dữ liệu, nhãn mono hoa.

## Trang Nhân viên
Bảng nhân viên kiêm quản lý tài khoản (cột Tài khoản, Vai trò, nút Đặt lại MK). Trang Cài đặt chỉ còn
tham số thuật toán, bố cục một cột hẹp.

## Trang ĐƯỢC khác
Nội dung thanh công cụ, có/không dải số liệu, bề rộng tối đa (`.page-narrow` cho form).
