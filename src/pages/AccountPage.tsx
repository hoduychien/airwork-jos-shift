import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import ChangePasswordPage from './ChangePasswordPage'
import { useAuth } from '../lib/AuthContext'
import { useFeedback } from '../components/Feedback'
import { ROLE_LABELS, authMode } from '../lib/auth'
import { store } from '../lib/store'

/** Tài khoản: thông tin cá nhân · đổi mật khẩu · đăng xuất — gộp vào một mục trên sidebar */
export default function AccountPage() {
  const { user, isAdmin, logout } = useAuth()
  const { confirm } = useFeedback()
  const [employeeName, setEmployeeName] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.employeeId) return
    let alive = true
    void store.listEmployees().then((list) => {
      if (alive) setEmployeeName(list.find((e) => e.id === user.employeeId)?.name ?? null)
    })
    return () => {
      alive = false
    }
  }, [user?.employeeId])

  if (!user) return null
  const initials = user.username.slice(0, 2).toUpperCase()

  const doLogout = async () => {
    const ok = await confirm({ title: 'Đăng xuất?', message: 'Bạn sẽ quay về màn hình đăng nhập.', confirmLabel: 'Đăng xuất' })
    if (ok) await logout()
  }

  return (
    <div className="page">
      <PageHeader
        title="Tài khoản"
        lede={authMode === 'local' ? 'Chế độ demo · tài khoản lưu trên trình duyệt này' : 'Đăng nhập qua Supabase Auth'}
        actions={
          <button className="btn btn-ghost" onClick={() => void doLogout()}>
            Đăng xuất
          </button>
        }
      />

      <div className="account-grid">
        <section className="panel" aria-label="Thông tin cá nhân">
          <div className="panel-head">
            <h2>Thông tin cá nhân</h2>
          </div>
          <div className="panel-body account-body">
            <div className="account-id">
              <span className="user-avatar account-avatar" data-role={isAdmin ? 'admin' : 'member'} aria-hidden>
                {initials}
              </span>
              <div className="min-w-0">
                <div className="account-name">{user.username}</div>
                <span className="chip chip-accent">{ROLE_LABELS[user.role]}</span>
              </div>
            </div>
            <dl className="account-facts">
              <dt>Vai trò</dt>
              <dd>
                {ROLE_LABELS[user.role]}
                <span className="account-note">
                  {user.role === 'pm'
                    ? ' — toàn quyền như admin, không nằm trong danh sách làm ca'
                    : user.role === 'admin'
                      ? ' — xếp lịch, quản lý nhân viên và cài đặt'
                      : ' — xem lịch đã chốt, đăng ký ngày nghỉ của mình'}
                </span>
              </dd>
              <dt>Nhân viên</dt>
              <dd>
                {user.employeeId ? (employeeName ?? '…') : user.role === 'pm' ? 'Không xếp ca' : 'Chưa gắn với nhân viên nào'}
              </dd>
              <dt>Mật khẩu</dt>
              <dd>
                {user.mustChangePassword ? (
                  <span className="chip chip-warn">Đang dùng mật khẩu ban đầu</span>
                ) : (
                  <span className="chip chip-ok">Đã đổi</span>
                )}
              </dd>
            </dl>
          </div>
        </section>

        <section className="panel" aria-label="Đổi mật khẩu">
          <div className="panel-head">
            <h2>Đổi mật khẩu</h2>
          </div>
          <div className="panel-body account-body">
            <ChangePasswordPage embedded />
          </div>
        </section>
      </div>
    </div>
  )
}
