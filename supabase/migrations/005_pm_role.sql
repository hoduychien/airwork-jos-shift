-- =============================================================
-- Vai trò PM: toàn quyền như admin nhưng KHÔNG nằm trong danh sách nhân viên
-- làm ca → không bao giờ được gắn employee_id, không bị xếp ca.
--   - user_roles.role nhận thêm 'pm'
--   - is_admin() coi admin và pm là như nhau (mọi policy RLS dùng is_admin())
--   - admin_set_role: nhận 'pm', đổi sang pm thì bỏ gắn nhân viên; giữ ≥ 1 admin/pm
--   - admin_set_employee: không cho gắn nhân viên vào tài khoản pm
--   - admin_create_account(email, role, password): tạo tài khoản quản lý không gắn nhân viên
-- =============================================================

alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles add constraint user_roles_role_check check (role in ('admin', 'pm', 'member'));

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'pm')
  );
$$;

create or replace function admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được đổi vai trò' using errcode = '42501';
  end if;
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
        -- PM không nằm trong danh sách làm ca
        employee_id = case when excluded.role = 'pm' then null else user_roles.employee_id end;
end $$;

create or replace function admin_set_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được gắn nhân viên' using errcode = '42501';
  end if;
  if p_employee_id is not null
     and exists (select 1 from user_roles where user_id = p_user_id and role = 'pm') then
    raise exception 'Tài khoản PM không nằm trong danh sách làm ca, không gắn nhân viên';
  end if;
  insert into user_roles (user_id, role, employee_id)
  values (p_user_id, 'member', p_employee_id)
  on conflict (user_id) do update set employee_id = excluded.employee_id;
end $$;

create or replace function admin_create_account(p_email text, p_role text, p_password text default '123456')
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  uid uuid;
  mail text := lower(trim(p_email));
begin
  if not is_admin() then
    raise exception 'Chỉ admin mới được tạo tài khoản' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'pm') then
    raise exception 'Vai trò không hợp lệ: %', p_role;
  end if;
  if length(p_password) < 6 then
    raise exception 'Mật khẩu phải có ít nhất 6 ký tự';
  end if;
  select id into uid from auth.users where email = mail;
  if uid is not null then
    raise exception 'Tài khoản % đã tồn tại', mail;
  end if;
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
  insert into user_roles (user_id, role, employee_id) values (uid, p_role, null);
  return uid;
end $$;

grant execute on function admin_create_account(text, text, text) to authenticated;
