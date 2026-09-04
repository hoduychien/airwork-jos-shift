-- =============================================================
-- Quản lý tài khoản từ trong app (chỉ admin):
--   admin_list_accounts()                    danh sách tài khoản + vai trò + nhân viên
--   admin_set_role(user_id, role)            đổi vai trò, luôn giữ ≥ 1 admin
--   admin_set_employee(user_id, employee_id) gắn/bỏ gắn nhân viên
--   admin_reset_password(user_id, password)  đặt lại mật khẩu, bắt đổi lần đầu
--   admin_ensure_account(email, employee_id, password)  tạo tài khoản nếu chưa có
-- Các hàm là SECURITY DEFINER (chạy với quyền chủ DB) nên tự kiểm tra is_admin().
-- =============================================================

create or replace function admin_list_accounts()
returns table (
  user_id uuid,
  email text,
  role text,
  employee_id uuid,
  must_change_password boolean,
  last_sign_in_at timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select
    u.id,
    u.email::text,
    coalesce(r.role, 'member'),
    r.employee_id,
    coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false),
    u.last_sign_in_at
  from auth.users u
  left join user_roles r on r.user_id = u.id
  where is_admin()
  order by u.email;
$$;

create or replace function admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được đổi vai trò' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Vai trò không hợp lệ: %', p_role;
  end if;
  if p_role = 'member'
     and exists (select 1 from user_roles where user_id = p_user_id and role = 'admin')
     and (select count(*) from user_roles where role = 'admin') <= 1 then
    raise exception 'Phải còn ít nhất một tài khoản admin';
  end if;
  insert into user_roles (user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role;
end $$;

create or replace function admin_set_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được gắn nhân viên' using errcode = '42501';
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
  if length(p_password) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb,
      updated_at = now()
  where id = p_user_id;
end $$;

create or replace function admin_ensure_account(p_email text, p_employee_id uuid, p_password text default '123456')
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  uid uuid;
  mail text := lower(trim(p_email));
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được tạo tài khoản' using errcode = '42501';
  end if;
  select id into uid from auth.users where email = mail;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      mail, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"must_change_password": true}',
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;
  insert into user_roles (user_id, role, employee_id)
  values (uid, 'member', p_employee_id)
  on conflict (user_id) do update set employee_id = coalesce(excluded.employee_id, user_roles.employee_id);
  return uid;
end $$;

grant execute on function admin_list_accounts() to authenticated;
grant execute on function admin_set_role(uuid, text) to authenticated;
grant execute on function admin_set_employee(uuid, uuid) to authenticated;
grant execute on function admin_reset_password(uuid, text) to authenticated;
grant execute on function admin_ensure_account(text, uuid, text) to authenticated;
