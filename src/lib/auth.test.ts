import { beforeEach, describe, expect, it } from 'vitest'
import { canManage, localAuth, listAccounts, matchUsername, DEFAULT_PASSWORD } from './auth'

// localStorage giả cho môi trường node
const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  })
})

describe('đăng nhập chế độ demo', () => {
  it('ChienHD là admin, các tài khoản khác là member, mật khẩu ban đầu 123456', async () => {
    const accounts = await listAccounts()
    expect(accounts.filter((a) => a.role === 'admin').map((a) => a.username)).toEqual(['ChienHD2'])
    const u = await localAuth.login('ChienHD', DEFAULT_PASSWORD)
    expect(u.role).toBe('admin')
    expect(u.mustChangePassword).toBe(true)
    const m = await localAuth.login('VuNL4', DEFAULT_PASSWORD)
    expect(m.role).toBe('member')
  })

  it('sai mật khẩu / sai tài khoản bị từ chối', async () => {
    await expect(localAuth.login('ChienHD', 'sai')).rejects.toThrow()
    await expect(localAuth.login('khongco', DEFAULT_PASSWORD)).rejects.toThrow()
  })

  it('đổi mật khẩu lần đầu: bỏ cờ mustChangePassword, không được giữ 123456', async () => {
    await localAuth.login('ChienHD', DEFAULT_PASSWORD)
    await expect(localAuth.changePassword('ChienHD2', DEFAULT_PASSWORD, DEFAULT_PASSWORD)).rejects.toThrow()
    await expect(localAuth.changePassword('ChienHD2', DEFAULT_PASSWORD, '123')).rejects.toThrow()
    const u = await localAuth.changePassword('ChienHD2', DEFAULT_PASSWORD, 'matkhau-moi')
    expect(u.mustChangePassword).toBe(false)
    await expect(localAuth.login('ChienHD', DEFAULT_PASSWORD)).rejects.toThrow()
    expect((await localAuth.login('ChienHD', 'matkhau-moi')).role).toBe('admin')
  })

  it('admin đặt lại mật khẩu → về 123456 và bắt đổi lại; không được hạ admin cuối cùng', async () => {
    await localAuth.changePassword('VuNL4', DEFAULT_PASSWORD, 'abcdef')
    await localAuth.resetPassword('VuNL4')
    const u = await localAuth.login('VuNL4', DEFAULT_PASSWORD)
    expect(u.mustChangePassword).toBe(true)
    await expect(localAuth.setRole('ChienHD2', 'member')).rejects.toThrow()
    await localAuth.setRole('VuNL4', 'admin')
    await localAuth.setRole('ChienHD2', 'member')
    expect((await localAuth.login('ChienHD2', DEFAULT_PASSWORD)).role).toBe('member')
  })

  it('khớp tài khoản không phân biệt hoa/thường và bỏ số cuối', () => {
    expect(matchUsername('chienhd', 'ChienHD2')).toBe(true)
    expect(matchUsername('ChienHD2', 'ChienHD2')).toBe(true)
    expect(matchUsername('Chien', 'ChienHD2')).toBe(false)
  })
})

describe('vai trò PM', () => {
  it('PM có quyền quản lý, không gắn nhân viên; hạ admin cuối cùng khi còn PM thì được', async () => {
    await localAuth.createAccount('PM', 'pm')
    const pm = await localAuth.login('PM', DEFAULT_PASSWORD)
    expect(pm.role).toBe('pm')
    expect(pm.employeeId).toBeUndefined()
    expect(canManage(pm.role)).toBe(true)
    await expect(localAuth.setEmployee('PM', 'e1')).rejects.toThrow()
    await expect(localAuth.createAccount('pm', 'pm')).rejects.toThrow()
    // đổi admin (đang gắn nhân viên e5) sang PM → tự bỏ gắn nhân viên
    await localAuth.setRole('ChienHD2', 'pm')
    expect((await localAuth.login('ChienHD2', DEFAULT_PASSWORD)).employeeId).toBeUndefined()
    // còn PM nên hạ ChienHD2 xuống member được; hạ PM cuối cùng thì không
    await localAuth.setRole('ChienHD2', 'member')
    await expect(localAuth.setRole('PM', 'member')).rejects.toThrow()
  })
})

describe('admin không sửa được tài khoản PM', () => {
  it('admin bị chặn đổi vai trò / đặt lại mật khẩu PM; PM thì được', async () => {
    await localAuth.createAccount('PM', 'pm')
    await localAuth.login('ChienHD2', DEFAULT_PASSWORD) // admin
    await expect(localAuth.setRole('PM', 'member')).rejects.toThrow(/PM/)
    await expect(localAuth.resetPassword('PM')).rejects.toThrow(/PM/)
    // admin vẫn sửa được tài khoản thường
    await localAuth.setRole('VuNL4', 'admin')
    await localAuth.login('PM', DEFAULT_PASSWORD) // PM
    await localAuth.resetPassword('PM')
    await localAuth.setRole('PM', 'admin')
    expect((await localAuth.login('PM', DEFAULT_PASSWORD)).role).toBe('admin')
  })
})
