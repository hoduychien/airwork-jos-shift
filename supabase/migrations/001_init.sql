-- =============================================================
-- Airwork JOS Shift — Shift Scheduler: schema + RLS
-- Chạy trong Supabase SQL Editor hoặc `supabase db push`
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- bảng ----------
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  display_order int not null default 0,
  prefer_night boolean not null default false,
  min_night_shifts int not null default 0,
  no_s1 boolean not null default false,
  no_s2 boolean not null default false,
  no_s3 boolean not null default false,
  max_shifts_per_month int not null default 21,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  month int not null check (month between 1 and 12),
  year int not null check (year between 2020 and 2100),
  status text not null default 'draft' check (status in ('draft', 'published')),
  min_per_shift int not null default 2,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists shift_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  day int not null check (day between 1 and 31),
  shift text not null check (shift in ('S1', 'S2', 'S3', 'OFF')),
  is_manual_override boolean not null default false,
  unique (schedule_id, employee_id, day)
);

create table if not exists day_off_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null,
  day int not null check (day between 1 and 31),
  note text,
  unique (employee_id, month, year, day)
);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null
);

-- phân quyền: admin được ghi, member chỉ đọc lịch published
create table if not exists user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  -- member có thể gắn với 1 nhân viên để tự đăng ký ngày nghỉ
  employee_id uuid references employees (id)
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from user_roles where user_id = auth.uid();
$$;

-- ---------- Row Level Security ----------
alter table employees enable row level security;
alter table schedules enable row level security;
alter table shift_assignments enable row level security;
alter table day_off_requests enable row level security;
alter table settings enable row level security;
alter table user_roles enable row level security;

-- employees: mọi người đăng nhập được đọc, chỉ admin ghi
create policy "employees read" on employees for select to authenticated using (true);
create policy "employees write" on employees for all to authenticated
  using (is_admin()) with check (is_admin());

-- schedules: admin thấy tất, member chỉ thấy published; chỉ admin ghi
create policy "schedules read" on schedules for select to authenticated
  using (is_admin() or status = 'published');
create policy "schedules write" on schedules for all to authenticated
  using (is_admin()) with check (is_admin());

-- shift_assignments: theo schedule cha; chỉ admin ghi
create policy "assignments read" on shift_assignments for select to authenticated
  using (
    is_admin()
    or exists (select 1 from schedules s where s.id = schedule_id and s.status = 'published')
  );
create policy "assignments write" on shift_assignments for all to authenticated
  using (is_admin()) with check (is_admin());

-- day_off_requests: đọc chung; member được ghi request của CHÍNH MÌNH, admin ghi tất
create policy "dayoff read" on day_off_requests for select to authenticated using (true);
create policy "dayoff insert own" on day_off_requests for insert to authenticated
  with check (is_admin() or employee_id = my_employee_id());
create policy "dayoff update own" on day_off_requests for update to authenticated
  using (is_admin() or employee_id = my_employee_id());
create policy "dayoff delete own" on day_off_requests for delete to authenticated
  using (is_admin() or employee_id = my_employee_id());

-- settings: đọc chung, admin ghi
create policy "settings read" on settings for select to authenticated using (true);
create policy "settings write" on settings for all to authenticated
  using (is_admin()) with check (is_admin());

-- user_roles: ai cũng đọc được role của mình; chỉ admin quản lý
create policy "roles read own" on user_roles for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy "roles write" on user_roles for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- Realtime ----------
alter publication supabase_realtime add table shift_assignments;
