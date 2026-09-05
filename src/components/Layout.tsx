import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { isLocalMode } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ROLE_LABELS } from '../lib/auth'

/* Hallmark · nav: sidebar dọc bên trái (wordmark · links · user) · theme: custom "Console" · designed-as-app
 * Desktop (≥768px): cột trái 14rem dính suốt chiều cao, icon + nhãn.
 * Mobile: thanh tab cố định DƯỚI ĐÁY màn hình, chỉ icon + nhãn nhỏ. */

type IconName = 'calendar' | 'calendar-off' | 'swap' | 'handover' | 'users' | 'settings' | 'account'

const NAV: { to: string; label: string; icon: IconName; adminOnly?: boolean; pending?: boolean }[] = [
  { to: '/', label: 'Lịch ca', icon: 'calendar' },
  { to: '/xin-nghi', label: 'Xin nghỉ', icon: 'calendar-off', pending: true },
  { to: '/doi-ca', label: 'Đổi ca', icon: 'swap', pending: true },
  { to: '/ban-giao', label: 'Bàn giao', icon: 'handover', pending: true },
  { to: '/nhan-vien', label: 'Nhân viên', icon: 'users', adminOnly: true },
  { to: '/cai-dat', label: 'Cài đặt', icon: 'settings', adminOnly: true },
]

const DESKTOP = '(min-width: 768px)'

/** icon nét mảnh 1.8px, 20px — cùng ngôn ngữ với các icon khác của app */
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    calendar: (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </>
    ),
    'calendar-off': (
      <>
        <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4M9.5 13.5l5 5M14.5 13.5l-5 5" />
      </>
    ),
    swap: (
      <>
        <path d="M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5" />
        <path d="M17 20V7M17 20l3.5-3.5M17 20l-3.5-3.5" />
      </>
    ),
    handover: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8.5" r="4" />
        <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    ),
  }
  return (
    <svg
      className="nav-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name]}
    </svg>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth()
  const nav = NAV.filter((item) => !item.adminOnly || isAdmin)
  const barRef = useRef<HTMLElement>(null)

  // Desktop: sidebar bên trái → không chiếm chỗ trên/dưới nội dung (--topbar-h = 0, --bottombar-h = 0).
  // Mobile: thanh tab cố định dưới đáy → --bottombar-h = chiều cao thanh để .main chừa chỗ, --topbar-h = 0.
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const mq = window.matchMedia(DESKTOP)
    const root = document.documentElement.style
    const apply = () => {
      root.setProperty('--topbar-h', '0px')
      root.setProperty('--bottombar-h', mq.matches ? '0px' : `${el.offsetHeight}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    mq.addEventListener('change', apply)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', apply)
    }
  }, [])

  const demoStrip = <div className="demo-strip">Chế độ demo · dữ liệu lưu trên trình duyệt này</div>

  return (
    <div className="app">
      {/* mobile: dải demo nằm trên cùng trang (sidebar đã xuống đáy) */}
      {isLocalMode && <div className="demo-strip-top">{demoStrip}</div>}

      <aside className="sidebar" ref={barRef}>
        {isLocalMode && <div className="demo-strip-side">{demoStrip}</div>}
        <div className="sidebar-inner">
          <NavLink to="/" className="wordmark" aria-label="Airwork JOS Shift — về bảng lịch">
            <span className="mark">AW</span>
            <span>AIRWORK · JOS SHIFT</span>
          </NavLink>

          <nav className="sidenav" aria-label="Điều hướng">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className="sidenav-link"
                data-pending={item.pending || undefined}
                title={item.pending ? `${item.label} — sắp ra mắt, chưa thao tác được` : item.label}
              >
                <Icon name={item.icon} />
                <span className="sidenav-label">{item.label}</span>
                {item.pending && (
                  <span className="sidenav-soon" aria-label="sắp ra mắt">
                    soon
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Tài khoản: thông tin cá nhân · đổi mật khẩu · đăng xuất — một mục, ghim cuối sidebar ở desktop */}
          <nav className="sidenav sidenav-account" aria-label="Tài khoản">
            <NavLink
              to="/tai-khoan"
              className="sidenav-link"
              title={user ? `${user.username} · ${ROLE_LABELS[user.role]}` : 'Tài khoản'}
            >
              <Icon name="account" />
              <span className="sidenav-label">Tài khoản</span>
              {user && <span className="sidenav-user">{user.username}</span>}
            </NavLink>
          </nav>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  )
}
