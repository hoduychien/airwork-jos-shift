-- =============================================================
-- Thời gian làm việc của nhân viên: ngày vào làm / ngày nghỉ việc.
-- Mỗi tháng chỉ hiển thị & xếp lịch cho người có làm trong tháng đó:
--   người mới không xuất hiện ở tháng trước ngày vào,
--   người nghỉ vẫn giữ nguyên dòng ở các tháng trước ngày nghỉ.
-- =============================================================
alter table employees
  add column if not exists joined_at date,
  add column if not exists left_at date;

-- nhân viên đã "xóa" trước đây (active=false) → coi như nghỉ từ hôm nay
update employees set left_at = current_date where active = false and left_at is null;
