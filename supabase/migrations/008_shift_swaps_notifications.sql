-- =============================================================
-- Đổi ca (shift_swap_requests) + Thông báo trong app (notifications)
--
-- Đổi ca: nhân viên chọn 1 ô (ngày, ca) của mình và 1 ô của đồng nghiệp trong
-- THÁNG HIỆN TẠI. Cần đồng nghiệp đồng ý (peer_status) VÀ admin/PM duyệt
-- (pm_status). Đủ 2 bên → RPC đổi 2 ô trên shift_assignments của lịch mới nhất
-- tháng đó, đánh dấu is_manual_override, status = 'approved'.
-- Thông báo: trigger/RPC ghi vào notifications cho đồng nghiệp, admin/PM, người gửi.
-- =============================================================

-- ---------- notifications ----------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null default '',
  link text not null default '/',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;
create policy "notifications read own" on notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications update own" on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- insert chỉ qua hàm security definer bên dưới

create or replace function notify_users(p_user_ids uuid[], p_title text, p_body text, p_link text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, title, body, link)
  select distinct u, p_title, coalesce(p_body, ''), coalesce(p_link, '/')
  from unnest(p_user_ids) as u
  where u is not null;
end $$;

/** user_id của các tài khoản gắn với danh sách nhân viên */
create or replace function users_of_employees(p_employee_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}'::uuid[])
  from user_roles where employee_id = any (p_employee_ids);
$$;

/** user_id của mọi admin / PM */
create or replace function manager_users()
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}'::uuid[]) from user_roles where role in ('admin', 'pm');
$$;

-- ---------- shift_swap_requests ----------
create table if not exists shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  month int not null check (month between 1 and 12),
  year int not null,
  requester_id uuid not null references employees (id) on delete cascade,
  requester_day int not null check (requester_day between 1 and 31),
  requester_shift text not null check (requester_shift in ('S1', 'S2', 'S3', 'OFF')),
  partner_id uuid not null references employees (id) on delete cascade,
  partner_day int not null check (partner_day between 1 and 31),
  partner_shift text not null check (partner_shift in ('S1', 'S2', 'S3', 'OFF')),
  note text not null default '',
  peer_status text not null default 'pending' check (peer_status in ('pending', 'approved', 'rejected')),
  pm_status text not null default 'pending' check (pm_status in ('pending', 'approved', 'rejected')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  peer_decided_at timestamptz,
  pm_decided_at timestamptz,
  pm_decided_by uuid references auth.users (id),
  applied_at timestamptz,
  decision_note text,
  check (requester_id <> partner_id)
);
create index if not exists shift_swap_requests_month_idx on shift_swap_requests (year, month);

alter table shift_swap_requests enable row level security;

create policy "swap read" on shift_swap_requests for select to authenticated using (true);

-- chỉ tạo yêu cầu cho chính mình, trạng thái ban đầu
create policy "swap insert own" on shift_swap_requests for insert to authenticated
  with check (
    (is_admin() or requester_id = my_employee_id())
    and status = 'pending' and peer_status = 'pending' and pm_status = 'pending'
  );
-- mọi thay đổi trạng thái đi qua RPC; admin được sửa tay
create policy "swap update admin" on shift_swap_requests for update to authenticated
  using (is_admin()) with check (is_admin());

create or replace function employee_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select name from employees where id = p_id;
$$;

create or replace function describe_cell(p_day int, p_shift text) returns text
language sql immutable as $$
  select 'ngày ' || p_day || ' · ' || case p_shift
    when 'S1' then 'Ca sáng (S1)' when 'S2' then 'Ca chiều (S2)' when 'S3' then 'Ca đêm (S3)' else 'Nghỉ' end;
$$;

-- khi tạo yêu cầu: ghi created_by, kiểm tra tháng hiện tại, thông báo đồng nghiệp + admin/PM
create or replace function swap_request_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.month <> extract(month from now())::int or new.year <> extract(year from now())::int then
    raise exception 'Chỉ đổi ca trong tháng hiện tại';
  end if;
  new.created_by := auth.uid();
  return new;
end $$;

create or replace function swap_request_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a text := employee_name(new.requester_id);
  b text := employee_name(new.partner_id);
  body text := describe_cell(new.requester_day, new.requester_shift) || ' của ' || a
            || ' ↔ ' || describe_cell(new.partner_day, new.partner_shift) || ' của ' || b;
begin
  perform notify_users(users_of_employees(array[new.partner_id]), a || ' đề nghị đổi ca với bạn', body, '/doi-ca');
  perform notify_users(manager_users(), a || ' đề nghị đổi ca với ' || b, body || ' — cần PM duyệt.', '/doi-ca');
  return new;
end $$;

drop trigger if exists swap_request_before_insert on shift_swap_requests;
create trigger swap_request_before_insert before insert on shift_swap_requests
  for each row execute function swap_request_on_insert();
drop trigger if exists swap_request_notify_insert on shift_swap_requests;
create trigger swap_request_notify_insert after insert on shift_swap_requests
  for each row execute function swap_request_after_insert();

-- người gửi rút lại khi còn chờ duyệt
create or replace function cancel_swap_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r shift_swap_requests%rowtype;
begin
  select * into r from shift_swap_requests where id = p_id for update;
  if not found then raise exception 'Yêu cầu không tồn tại'; end if;
  if not (is_admin() or r.requester_id = my_employee_id()) then
    raise exception 'Chỉ người gửi mới rút lại được' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý, không rút lại được'; end if;
  update shift_swap_requests set status = 'cancelled' where id = p_id;
  perform notify_users(
    users_of_employees(array[r.partner_id]) || manager_users(),
    employee_name(r.requester_id) || ' đã rút yêu cầu đổi ca',
    describe_cell(r.requester_day, r.requester_shift) || ' ↔ ' || describe_cell(r.partner_day, r.partner_shift),
    '/doi-ca');
end $$;
grant execute on function cancel_swap_request(uuid) to authenticated;

-- đồng nghiệp (peer) hoặc PM (pm) quyết định; đủ 2 bên → đổi ô trên lịch
create or replace function decide_swap_request(p_id uuid, p_side text, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r shift_swap_requests%rowtype;
  sched_id uuid;
  cur_a text;
  cur_b text;
  a text;
  b text;
  pair text;
  new_status text;
begin
  if p_status not in ('approved', 'rejected') then raise exception 'Trạng thái không hợp lệ: %', p_status; end if;
  if p_side not in ('peer', 'pm') then raise exception 'Bên quyết định không hợp lệ: %', p_side; end if;

  select * into r from shift_swap_requests where id = p_id for update;
  if not found then raise exception 'Yêu cầu không tồn tại'; end if;
  if r.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý trước đó'; end if;

  if p_side = 'peer' then
    if r.partner_id is distinct from my_employee_id() then
      raise exception 'Chỉ đồng nghiệp được đề nghị mới trả lời được' using errcode = '42501';
    end if;
    if r.peer_status <> 'pending' then raise exception 'Đồng nghiệp đã trả lời rồi'; end if;
    r.peer_status := p_status;
    r.peer_decided_at := now();
  else
    if not is_admin() then raise exception 'Chỉ admin hoặc PM mới được duyệt đổi ca' using errcode = '42501'; end if;
    if r.pm_status <> 'pending' then raise exception 'PM đã quyết định rồi'; end if;
    r.pm_status := p_status;
    r.pm_decided_at := now();
    r.pm_decided_by := auth.uid();
  end if;

  new_status := case
    when r.peer_status = 'rejected' or r.pm_status = 'rejected' then 'rejected'
    when r.peer_status = 'approved' and r.pm_status = 'approved' then 'approved'
    else 'pending' end;

  if new_status = 'approved' then
    select id into sched_id from schedules
      where month = r.month and year = r.year order by created_at desc limit 1;
    if sched_id is null then raise exception 'Không tìm thấy lịch tháng này'; end if;
    select shift into cur_a from shift_assignments
      where schedule_id = sched_id and employee_id = r.requester_id and day = r.requester_day;
    select shift into cur_b from shift_assignments
      where schedule_id = sched_id and employee_id = r.partner_id and day = r.partner_day;
    if cur_a is distinct from r.requester_shift or cur_b is distinct from r.partner_shift then
      raise exception 'Lịch đã thay đổi so với lúc gửi yêu cầu — không đổi ca được, hãy tạo yêu cầu mới';
    end if;
    update shift_assignments set shift = r.partner_shift, is_manual_override = true
      where schedule_id = sched_id and employee_id = r.requester_id and day = r.requester_day;
    update shift_assignments set shift = r.requester_shift, is_manual_override = true
      where schedule_id = sched_id and employee_id = r.partner_id and day = r.partner_day;
    r.applied_at := now();
  end if;

  update shift_swap_requests set
    peer_status = r.peer_status, pm_status = r.pm_status, status = new_status,
    peer_decided_at = r.peer_decided_at, pm_decided_at = r.pm_decided_at, pm_decided_by = r.pm_decided_by,
    applied_at = r.applied_at,
    decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note)
  where id = p_id;

  a := employee_name(r.requester_id);
  b := employee_name(r.partner_id);
  pair := describe_cell(r.requester_day, r.requester_shift) || ' của ' || a
       || ' ↔ ' || describe_cell(r.partner_day, r.partner_shift) || ' của ' || b;

  if new_status = 'approved' then
    perform notify_users(users_of_employees(array[r.requester_id, r.partner_id]) || manager_users(),
      'Đổi ca đã được duyệt — lịch đã cập nhật', pair, '/');
  elsif new_status = 'rejected' then
    perform notify_users(users_of_employees(array[r.requester_id, r.partner_id]) || manager_users(),
      (case when p_side = 'peer' then b else 'PM' end) || ' từ chối đổi ca', pair, '/doi-ca');
  elsif p_side = 'peer' then
    perform notify_users(users_of_employees(array[r.requester_id]) || manager_users(),
      b || ' đã đồng ý đổi ca — chờ PM duyệt', pair, '/doi-ca');
  else
    perform notify_users(users_of_employees(array[r.requester_id, r.partner_id]),
      'PM đã duyệt — chờ ' || b || ' đồng ý', pair, '/doi-ca');
  end if;
end $$;
grant execute on function decide_swap_request(uuid, text, text, text) to authenticated;

-- realtime cho thông báo (chuông trên sidebar cập nhật live)
alter publication supabase_realtime add table notifications;
