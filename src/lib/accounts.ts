import { supabase } from './supabase'
import { authMode, DEFAULT_PASSWORD, PM_EDIT_ERROR, listAccounts, localAuth, parseRole, type Role } from './auth'

/**
 * API quản lý tài khoản dùng chung cho admin — cùng một interface cho 2 backend:
 *  - demo: localStorage (lib/auth.ts)
 *  - Supabase: các hàm SQL security definer trong migrations/003_admin_accounts.sql
 */

export interface AccountInfo {
  /** khóa để thao tác: username (demo) hoặc auth user id (Supabase) */
  id: string
  /** hiển thị: mã nhân viên (demo) hoặc email (Supabase) */
  username: string
  role: Role
  employeeId?: string
  mustChangePassword: boolean
  lastSignInAt?: string
}

export interface AccountsApi {
  list(): Promise<AccountInfo[]>
  setRole(id: string, role: Role): Promise<void>
  setEmployee(id: string, employeeId: string | null): Promise<void>
  /** đặt lại về mật khẩu ban đầu, bắt đổi ở lần đăng nhập sau */
  resetPassword(id: string): Promise<void>
  /** tạo tài khoản cho nhân viên nếu chưa có (demo: mã NV · Supabase: email) */
  ensureAccount(login: string, employeeId: string): Promise<void>
  /** tạo tài khoản quản lý (PM / admin) KHÔNG gắn nhân viên — không bị xếp ca */
  createManagerAccount(login: string, role: 'pm' | 'admin'): Promise<void>
  /** cách sinh tên đăng nhập từ mã nhân viên */
  loginFor(code: string): string
}

/** domain email cho tài khoản Supabase: VITE_ACCOUNT_EMAIL_DOMAIN, mặc định fpt.com */
export const ACCOUNT_EMAIL_DOMAIN = (import.meta.env.VITE_ACCOUNT_EMAIL_DOMAIN as string | undefined)?.trim() || 'fpt.com'

const localAccounts: AccountsApi = {
  async list() {
    return (await listAccounts()).map((a) => ({
      id: a.username,
      username: a.username,
      role: a.role,
      employeeId: a.employeeId,
      mustChangePassword: a.mustChangePassword,
    }))
  },
  setRole: (id, role) => localAuth.setRole(id, role),
  setEmployee: (id, employeeId) => localAuth.setEmployee(id, employeeId),
  resetPassword: (id) => localAuth.resetPassword(id),
  ensureAccount: (login, employeeId) => localAuth.ensureAccount(login, employeeId),
  createManagerAccount: (login, role) => localAuth.createAccount(login, role),
  loginFor: (code) => code.trim(),
}

function rpcError(message: string): Error {
  // Postgres raise exception → message tiếng Việt đã viết trong hàm SQL; 42501 = không có quyền
  if (/PM mới được sửa/i.test(message)) return new Error(PM_EDIT_ERROR)
  if (/permission denied|42501/i.test(message)) return new Error('Chỉ admin mới được thao tác tài khoản.')
  if (/admin_create_account/i.test(message) && /does not exist/i.test(message)) {
    return new Error('Chưa chạy migration 005_pm_role.sql trên Supabase.')
  }
  if (/user_roles_role_check/i.test(message)) {
    return new Error('Vai trò PM chưa được bật — chạy migration 005_pm_role.sql trên Supabase.')
  }
  if (/function .* does not exist/i.test(message)) {
    return new Error('Chưa chạy migration 003_admin_accounts.sql trên Supabase.')
  }
  return new Error(message)
}

const supabaseAccounts: AccountsApi = {
  async list() {
    const { data, error } = await supabase!.rpc('admin_list_accounts')
    if (error) throw rpcError(error.message)
    return (data as {
      user_id: string
      email: string
      role: string
      employee_id: string | null
      must_change_password: boolean
      last_sign_in_at: string | null
    }[]).map((r) => ({
      id: r.user_id,
      username: r.email,
      role: parseRole(r.role),
      employeeId: r.employee_id ?? undefined,
      mustChangePassword: r.must_change_password,
      lastSignInAt: r.last_sign_in_at ?? undefined,
    }))
  },
  async setRole(id, role) {
    const { error } = await supabase!.rpc('admin_set_role', { p_user_id: id, p_role: role })
    if (error) throw rpcError(error.message)
  },
  async setEmployee(id, employeeId) {
    const { error } = await supabase!.rpc('admin_set_employee', { p_user_id: id, p_employee_id: employeeId })
    if (error) throw rpcError(error.message)
  },
  async resetPassword(id) {
    const { error } = await supabase!.rpc('admin_reset_password', { p_user_id: id, p_password: DEFAULT_PASSWORD })
    if (error) throw rpcError(error.message)
  },
  async ensureAccount(login, employeeId) {
    const { error } = await supabase!.rpc('admin_ensure_account', {
      p_email: login,
      p_employee_id: employeeId,
      p_password: DEFAULT_PASSWORD,
    })
    if (error) throw rpcError(error.message)
  },
  async createManagerAccount(login, role) {
    const { error } = await supabase!.rpc('admin_create_account', {
      p_email: login,
      p_role: role,
      p_password: DEFAULT_PASSWORD,
    })
    if (error) throw rpcError(error.message)
  },
  loginFor: (code) => `${code.trim().toLowerCase()}@${ACCOUNT_EMAIL_DOMAIN}`,
}

export const accountsApi: AccountsApi = authMode === 'local' ? localAccounts : supabaseAccounts
