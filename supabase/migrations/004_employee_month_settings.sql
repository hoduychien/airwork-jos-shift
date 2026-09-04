-- =============================================================
-- Thiết lập nhân viên THEO THÁNG: ưu tiên ca đêm, cấm ca, số ca tối đa.
-- Tháng chưa có dòng → dùng giá trị mặc định trên bảng employees.
-- =============================================================
create table if not exists employee_month_settings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null,
  prefer_night boolean not null default false,
  min_night_shifts int not null default 0,
  no_s1 boolean not null default false,
  no_s2 boolean not null default false,
  no_s3 boolean not null default false,
  max_shifts_per_month int not null default 21,
  updated_at timestamptz not null default now(),
  unique (employee_id, month, year)
);

alter table employee_month_settings enable row level security;

create policy "month settings read" on employee_month_settings for select to authenticated using (true);
create policy "month settings write" on employee_month_settings for all to authenticated
  using (is_admin()) with check (is_admin());
