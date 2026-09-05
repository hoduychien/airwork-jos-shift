-- =============================================================
-- Tài khoản PM chỉ PM mới được sửa: admin không đổi được vai trò, không đặt lại
-- mật khẩu, không gắn nhân viên cho tài khoản PM. Admin vẫn tạo được PM
-- (admin_create_account) để có PM đầu tiên.
-- =============================================================

create or replace function is_pm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'pm');
$$;

-- kiểm tra chung: đang sửa tài khoản PM mà người thao tác không phải PM → chặn
create or replace function assert_can_edit_account(p_user_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from user_roles where user_id = p_user_id and role = 'pm') and not is_pm() then
    raise exception 'Chỉ PM mới được sửa tài khoản PM' using errcode = '42501';
  end if;
end $$;

create or replace function admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được đổi vai trò' using errcode = '42501';
  end if;
  perform assert_can_edit_account(p_user_id);
  if p_role not in ('admin', 'pm', 'member') then
    raise exception 'Vai trò không hợp lệ: %', p_role;
  end if;
  if p_role = 'member'
     and exists (select 1 from user_roles where user_id = p_user_id and role in ('admin', 'pm'))
     and (select count(*) from user_roles where role in ('admin', 'pm')) <= 1 then
    raise exception 'Phải còn ít nhất một tài khoản admin hoặc PM';
  end if;
  insert into user_roles (user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id) do update
    set role = excluded.role,
        employee_id = case when excluded.role = 'pm' then null else user_roles.employee_id end;
end $$;

create or replace function admin_set_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được gắn nhân viên' using errcode = '42501';
  end if;
  perform assert_can_edit_account(p_user_id);
  if p_employee_id is not null
     and exists (select 1 from user_roles where user_id = p_user_id and role = 'pm') then
    raise exception 'Tài khoản PM không nằm trong danh sách làm ca, không gắn nhân viên';
  end if;
  insert into user_roles (user_id, role, employee_id)
  values (p_user_id, 'member', p_employee_id)
  on conflict (user_id) do update set employee_id = excluded.employee_id;
end $$;

create or replace function admin_reset_password(p_user_id uuid, p_password text default '123456')
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được đặt lại mật khẩu' using errcode = '42501';
  end if;
  perform assert_can_edit_account(p_user_id);
  if length(p_password) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb,
      updated_at = now()
  where id = p_user_id;
end $$;
