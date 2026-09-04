import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { isLocalMode } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

/* Hallmark · nav: N1b top bar (wordmark · links · user) · theme: custom "Console" · designed-as-app
 * Thanh trên 3rem, kẻ đậm dưới; link mono viết hoa, gạch chân 2px khi active. */

const NAV: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: '/', label: 'Lịch ca' },
  { to: '/nhan-vien', label: 'Nhân viên', adminOnly: true },
  { to: '/cai-dat', label: 'Cài đặt', adminOnly: true },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin, logout } = useAuth()
  const nav = NAV.filter((item) => !item.adminOnly || isAdmin)
  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase()
  const topbarRef = useRef<HTMLElement>(null)

  // Ghi chiều cao thanh trên vào biến CSS để tiêu đề trang (.page-head) dính ngay bên dưới khi cuộn
  useLayoutEffect(() => {
    const el = topbarRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="min-h-dvh">
      <header className="topbar" ref={topbarRef}>
        {isLocalMode && <div className="demo-strip">Chế độ demo · dữ liệu lưu trên trình duyệt này</div>}
        <div className="topbar-inner">
          <NavLink to="/" className="wordmark" aria-label="Airwork JOS Shift — về bảng lịch">
            <span className="mark">AW</span>
            <span className="hidden sm:inline">AIRWORK · JOS SHIFT</span>
          </NavLink>

          <nav className="topnav" aria-label="Điều hướng">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="topnav-link">
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-right">
            {user && (
              <NavLink to="/doi-mat-khau" className="user-tag" title="Đổi mật khẩu" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="user-avatar" data-role={isAdmin ? 'admin' : 'member'} aria-hidden>
                  {initials}
                </span>
                <span className="hidden sm:inline">{user.username}</span>
                <span className="role hidden md:inline" data-admin={isAdmin ? 'true' : undefined}>
                  {isAdmin ? 'admin' : 'member'}
                </span>
              </NavLink>
            )}
            <button className="icon-btn" title="Đăng xuất" aria-label="Đăng xuất" onClick={() => void logout()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="main">{children}</main>
    </div>
  )
}
