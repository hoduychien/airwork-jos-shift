-- Seed theo file Shift_plan_Thang10_2026_final.xlsx:
-- 9 nhân viên — QuangPK1 & ChienHD2 ưu tiên ca đêm (16 S3 + 2 S1 + 2 S2/tháng),
-- QuanPD7 không làm ca đêm.
insert into employees (name, code, display_order, prefer_night, min_night_shifts, no_s1, no_s2, no_s3, max_shifts_per_month)
values
  ('QuangPK1',   'QuangPK1',   1, true,  16, false, false, false, 21),
  ('VuNL4',      'VuNL4',      2, false, 0,  false, false, false, 21),
  ('TruongPT16', 'TruongPT16', 3, false, 0,  false, false, false, 21),
  ('HungLQ33',   'HungLQ33',   4, false, 0,  false, false, false, 21),
  ('ChienHD2',   'ChienHD2',   5, true,  16, false, false, false, 21),
  ('QuanPD7',    'QuanPD7',    6, false, 0,  false, false, true,  21),
  ('AnhND191',   'AnhND191',   7, false, 0,  false, false, false, 21),
  ('ThongDV3',   'ThongDV3',   8, false, 0,  false, false, false, 21),
  ('ThaiDTD1',   'ThaiDTD1',   9, false, 0,  false, false, false, 21);

-- Lịch tháng 10/2026 chốt (đã publish) — mỗi ký tự một ngày: 1=S1, 2=S2, 3=S3, .=OFF
do $$
declare
  sched_id uuid;
  codes text[] := array[
    'QuangPK1', 'VuNL4', 'TruongPT16', 'HungLQ33', 'ChienHD2',
    'QuanPD7', 'AnhND191', 'ThongDV3', 'ThaiDTD1'
  ];
  plans text[] := array[
    '11.22.33.333..33..333..33333..3',
    '333.11.33.111..2222..2222..111.',
    '33.22..22..333.2222.1111..1111.',
    '2.333.11.22.11.11.11.222..33.22',
    '..11.33.333.33333..22.3333..33.',
    '.22..22..111.22.11.22.1111.22.1',
    '.22.11111.22.11..333.33..2222.1',
    '2.11.22.11.22.11.11.33..222.333',
    '11.333.222..222.33.111..111..22'
  ];
  emp uuid;
begin
  insert into schedules (month, year, status, min_per_shift)
  values (10, 2026, 'published', 2)
  returning id into sched_id;

  for i in 1..array_length(codes, 1) loop
    select id into emp from employees where code = codes[i];
    for d in 1..31 loop
      insert into shift_assignments (schedule_id, employee_id, day, shift)
      values (
        sched_id, emp, d,
        case substr(plans[i], d, 1)
          when '1' then 'S1'
          when '2' then 'S2'
          when '3' then 'S3'
          else 'OFF'
        end
      );
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Tài khoản đăng nhập (email + mật khẩu, KHÔNG dùng magic link):
--   Dashboard → Authentication → Users → Add user → Create new user
--   · Email, Password (mật khẩu tạm), tick "Auto Confirm User"
--   · User Metadata: {"must_change_password": true}  → bắt đổi mật khẩu lần đầu
-- Sau đó gán vai trò + gắn nhân viên (thay email và mã nhân viên):
--   insert into user_roles (user_id, role, employee_id)
--   select u.id, 'admin', e.id
--   from auth.users u, employees e
--   where u.email = 'chienhd@congty.vn' and e.code = 'ChienHD2'
--   on conflict (user_id) do update set role = 'admin', employee_id = excluded.employee_id;
-- Thành viên: đổi 'admin' thành 'member' và e.code thành mã của người đó.
