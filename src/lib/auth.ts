import { supabase, isLocalMode } from './supabase'
import { SEED_EMPLOYEES } from './seed'

/**
 * Xác thực + phân quyền.
 *  - Chế độ demo (localStorage): tài khoản = mã nhân viên, mật khẩu ban đầu 123456,
 *    bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên. ChienHD2 là admin.
 *  - Chế độ Supabase: đăng nhập email + mật khẩu (Supabase Auth), role đọc từ bảng user_roles,
 *    cờ user_metadata.must_change_password bắt đổi mật khẩu lần đầu.
 * Chỉ admin mới được xếp lịch / chỉnh lịch / quản lý nhân viên & cài đặt.
 */

export type Role = 'admin' | 'member'

export interface AuthUser {
  id: string
  username: string
  role: Role
  employeeId?: string
  /** true → phải đổi mật khẩu trước khi dùng app (mật khẩu ban đầu) */
  mustChangePassword: boolean
}

export interface Account {
  username: string
  passwordHash: string
  role: Role
  employeeId?: string
  mustChangePassword: boolean
}

export const DEFAULT_PASSWORD = '123456'
export const ADMIN_USERNAME = 'ChienHD2'
export const MIN_PASSWORD_LENGTH = 6

const LS_ACCOUNTS = 'shift.accounts'
const LS_SESSION = 'shift.session'

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`cakip:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

/** so khớp username: không phân biệt hoa/thường; "ChienHD" cũng khớp "ChienHD2" */
export function matchUsername(input: string, username: string): boolean {
  const a = input.trim().toLowerCase()
  const b = username.toLowerCase()
  return a === b || a === b.replace(/\d+$/, '')
}

// ---------------- Local (demo) ----------------

async function seedAccounts(): Promise<Account[]> {
  const hash = await hashPassword(DEFAULT_PASSWORD)
  return SEED_EMPLOYEES.map((e) => ({
    username: e.code,
    passwordHash: hash,
    role: e.code === ADMIN_USERNAME ? 'admin' : 'member',
    employeeId: e.id,
    mustChangePassword: true,
  }))
}

export async function listAccounts(): Promise<Account[]> {
  const existing = lsGet<Account[] | null>(LS_ACCOUNTS, null)
  if (existing && existing.length > 0) return existing
  const seeded = await seedAccounts()
  lsSet(LS_ACCOUNTS, seeded)
  return seeded
}

function saveAccounts(accounts: Account[]) {
  lsSet(LS_ACCOUNTS, accounts)
}

function toUser(a: Account): AuthUser {
  return {
    id: a.username,
    username: a.username,
    role: a.role,
    employeeId: a.employeeId,
    mustChangePassword: a.mustChangePassword,
  }
}

async function findAccount(username: string): Promise<Account | undefined> {
  const accounts = await listAccounts()
  const lower = username.trim().toLowerCase()
  return (
    accounts.find((a) => a.username.toLowerCase() === lower) ??
    accounts.find((a) => matchUsername(username, a.username))
  )
}

export const localAuth = {
  async currentUser(): Promise<AuthUser | null> {
    const username = lsGet<string | null>(LS_SESSION, null)
    if (!username) return null
    const acc = await findAccount(username)
    return acc ? toUser(acc) : null
  },
  async login(username: string, password: string): Promise<AuthUser> {
    const acc = await findAccount(username)
    if (!acc) throw new Error('Tài khoản không tồn tại.')
    if ((await hashPassword(password)) !== acc.passwordHash) throw new Error('Mật khẩu không đúng.')
    lsSet(LS_SESSION, acc.username)
    return toUser(acc)
  },
  logout() {
    localStorage.removeItem(LS_SESSION)
  },
  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<AuthUser> {
    const accounts = await listAccounts()
    const acc = accounts.find((a) => a.username === username)
    if (!acc) throw new Error('Tài khoản không tồn tại.')
    if ((await hashPassword(oldPassword)) !== acc.passwordHash) throw new Error('Mật khẩu hiện tại không đúng.')
    if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
    if (newPassword === DEFAULT_PASSWORD) throw new Error('Mật khẩu mới không được trùng mật khẩu ban đầu.')
    acc.passwordHash = await hashPassword(newPassword)
    acc.mustChangePassword = false
    saveAccounts(accounts)
    return toUser(acc)
  },
  /** admin: đặt lại mật khẩu về 123456 và bắt đổi ở lần đăng nhập sau */
  async resetPassword(username: string) {
    const accounts = await listAccounts()
    const acc = accounts.find((a) => a.username === username)
    if (!acc) return
    acc.passwordHash = await hashPassword(DEFAULT_PASSWORD)
    acc.mustChangePassword = true
    saveAccounts(accounts)
  },
  /** admin: đổi vai trò — luôn phải còn ít nhất 1 admin */
  async setRole(username: string, role: Role) {
    const accounts = await listAccounts()
    const acc = accounts.find((a) => a.username === username)
    if (!acc) return
    if (acc.role === 'admin' && role !== 'admin' && accounts.filter((a) => a.role === 'admin').length <= 1) {
      throw new Error('Phải còn ít nhất một tài khoản admin.')
    }
    acc.role = role
    saveAccounts(accounts)
  },
  /** admin: gắn / bỏ gắn tài khoản với nhân viên */
  async setEmployee(username: string, employeeId: string | null) {
    const accounts = await listAccounts()
    const acc = accounts.find((a) => a.username === username)
    if (!acc) return
    acc.employeeId = employeeId ?? undefined
    saveAccounts(accounts)
  },
  /** tạo tài khoản cho nhân viên mới (mã nhân viên), mật khẩu ban đầu 123456 */
  async ensureAccount(username: string, employeeId: string) {
    const accounts = await listAccounts()
    if (accounts.some((a) => a.username === username)) return
    accounts.push({
      username,
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      role: 'member',
      employeeId,
      mustChangePassword: true,
    })
    saveAccounts(accounts)
  },
}

// ---------------- Supabase ----------------

/** dịch thông báo lỗi Supabase Auth sang tiếng Việt cho người dùng cuối */
function translateAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.'
  if (m.includes('email not confirmed')) return 'Email chưa được xác nhận — nhờ admin bật "Auto Confirm" khi tạo tài khoản.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Thử đăng nhập quá nhiều lần — chờ một lúc rồi thử lại.'
  if (m.includes('password should be')) return 'Mật khẩu chưa đủ mạnh — cần ít nhất 6 ký tự.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Không kết nối được máy chủ — kiểm tra mạng.'
  return message
}

export const supabaseAuth = {
  async currentUser(): Promise<AuthUser | null> {
    if (!supabase) return null
    const { data, error } = await supabase.auth.getUser()
    // chưa đăng nhập → null (không phải lỗi hệ thống)
    if (error && !/session|jwt|token/i.test(error.message)) throw error
    const u = data.user
    if (!u) return null
    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role, employee_id')
      .eq('user_id', u.id)
      .maybeSingle()
    if (roleErr) throw roleErr
    return {
      id: u.id,
      username: u.email ?? u.id,
      role: roleRow?.role === 'admin' ? 'admin' : 'member',
      employeeId: roleRow?.employee_id ?? undefined,
      // admin đặt user_metadata.must_change_password = true khi tạo tài khoản với mật khẩu tạm
      mustChangePassword: u.user_metadata?.must_change_password === true,
    }
  },
  /** đăng nhập email + mật khẩu (Supabase Auth, không dùng magic link) */
  async login(email: string, password: string) {
    if (!supabase) throw new Error('Chưa cấu hình Supabase.')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(translateAuthError(error.message))
  },
  async logout() {
    await supabase?.auth.signOut()
  },
  async changePassword(newPassword: string) {
    if (!supabase) return
    if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    })
    if (error) throw new Error(translateAuthError(error.message))
  },
}

export const authMode: 'local' | 'supabase' = isLocalMode ? 'local' : 'supabase'
