-- =============================================================
-- Xin nghỉ (leave_requests): nhân viên gửi ngày muốn nghỉ cho THÁNG SAU,
-- PM/admin duyệt → các ngày được duyệt gộp vào ngày nghỉ cố định
-- (day_off_requests) của tháng đó; solver tự tôn trọng khi tạo lịch.
--   - member: tạo yêu cầu của CHÍNH MÌNH, xóa khi còn chờ duyệt
--   - admin/pm: duyệt / từ chối qua RPC decide_leave_request (1 transaction)
-- =============================================================

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null,
  days int[] not null check (cardinality(days) > 0),
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text
);

create index if not exists leave_requests_month_idx on leave_requests (year, month);

alter table leave_requests enable row level security;

-- đọc chung (PM duyệt, đồng nghiệp biết ai nghỉ)
create policy "leave read" on leave_requests for select to authenticated using (true);

-- member chỉ tạo yêu cầu cho nhân viên gắn với mình, luôn ở trạng thái pending
create policy "leave insert own" on leave_requests for insert to authenticated
  with check (
    status = 'pending'
    and (is_admin() or employee_id = my_employee_id())
  );

-- rút lại: chỉ khi còn chờ duyệt; admin xóa được tất
create policy "leave delete own pending" on leave_requests for delete to authenticated
  using (is_admin() or (employee_id = my_employee_id() and status = 'pending'));

-- mọi cập nhật trạng thái đi qua RPC bên dưới; cho admin update trực tiếp để sửa tay khi cần
create policy "leave update admin" on leave_requests for update to authenticated
  using (is_admin()) with check (is_admin());

-- ghi created_by tự động
create or replace function leave_requests_set_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := auth.uid();
  return new;
end $$;

drop trigger if exists leave_requests_creator on leave_requests;
create trigger leave_requests_creator before insert on leave_requests
  for each row execute function leave_requests_set_creator();

-- duyệt / từ chối: đổi trạng thái và (nếu duyệt) gộp ngày vào day_off_requests
create or replace function decide_leave_request(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r leave_requests%rowtype;
  d int;
begin
  if not is_admin() then
    raise exception 'Chỉ admin hoặc PM mới được duyệt xin nghỉ' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Trạng thái không hợp lệ: %', p_status;
  end if;

  select * into r from leave_requests where id = p_id for update;
  if not found then
    raise exception 'Yêu cầu không tồn tại';
  end if;
  if r.status <> 'pending' then
    raise exception 'Yêu cầu đã được xử lý trước đó';
  end if;

  update leave_requests
  set status = p_status,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;

  if p_status = 'approved' then
    foreach d in array r.days loop
      insert into day_off_requests (employee_id, month, year, day, note)
      values (r.employee_id, r.month, r.year, d, 'xin nghỉ đã duyệt')
      on conflict (employee_id, month, year, day) do nothing;
    end loop;
  end if;
end $$;

grant execute on function decide_leave_request(uuid, text, text) to authenticated;
