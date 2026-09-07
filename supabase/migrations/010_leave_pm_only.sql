-- =============================================================
-- Cho nhân viên nghỉ việc (left_at / active) chỉ PM thực hiện được.
-- Admin vẫn sửa hồ sơ, ràng buộc ca, ngày vào làm như trước.
-- =============================================================
create or replace function employees_guard_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.left_at is distinct from old.left_at or new.active is distinct from old.active) and not is_pm() then
    raise exception 'Chỉ tài khoản PM mới được cho nhân viên nghỉ việc' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists employees_guard_leave on employees;
create trigger employees_guard_leave
  before update on employees
  for each row execute function employees_guard_leave();
