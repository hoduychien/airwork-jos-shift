import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { ROLE_LABELS } from '../lib/auth'
import { useNotifications } from '../lib/NotificationsContext'
import { useFeedback } from './Feedback'
import { fmtShort } from '../lib/swap'
import type { Notification } from '../lib/swap'

/* Hallmark · component: topbar — thanh trên cùng cho toàn app, dính khi cuộn.
 * Trái: wordmark (chỉ mobile, vì sidebar đã có ở desktop). Phải: chuông thông báo + tài khoản, cả hai mở popover.
 * Popover: đóng khi bấm ra ngoài / Esc; mỗi lúc chỉ mở một cái. */

type Open = 'bell' | 'account' | null

/** popover neo dưới nút, canh phải; đóng khi bấm ngoài / Esc (xử lý ở Topbar) */
function Popover({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="popover" data-wide={wide || undefined} role="dialog" aria-label={label}>
      {children}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0M12 3v2" />
    </svg>
  )
}
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export default forwardRef<HTMLElement>(function Topbar(_props, ref) {
  const { user, isAdmin, logout } = useAuth()
  const { items, unread, markAllRead, markRead } = useNotifications()
  const { confirm } = useFeedback()
  const navigate = useNavigate()
  const [open, setOpen] = useState<Open>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // bấm ngoài / Esc → đóng
  useEffect(() => {
    if (!open) return
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const initials = user.username.slice(0, 2).toUpperCase()
  const toggle = (which: Exclude<Open, null>) => {
    // mobile: popover cố định theo viewport → đo đáy thanh trên lúc mở (có thể có dải demo phía trên)
    const bar = wrapRef.current?.closest('header')
    if (bar) wrapRef.current?.style.setProperty('--popover-top', `${bar.getBoundingClientRect().bottom + 6}px`)
    setOpen((o) => (o === which ? null : which))
  }

  const openItem = (n: Notification) => {
    setOpen(null)
    if (!n.read) void markRead([n.id])
    navigate(n.link || '/')
  }
  const doLogout = async () => {
    setOpen(null)
    const ok = await confirm({ title: 'Đăng xuất?', message: 'Bạn sẽ quay về màn hình đăng nhập.', confirmLabel: 'Đăng xuất' })
    if (ok) await logout()
  }

  const recent = items.slice(0, 8)

  return (
    <header className="topbar" ref={ref}>
      <NavLink to="/" className="wordmark topbar-wordmark" aria-label="Airwork JOS Shift — về bảng lịch">
        <span className="mark">AW</span>
        <span>AIRWORK · JOS SHIFT</span>
      </NavLink>

      <div className="topbar-spacer" />

      <div className="topbar-tools" ref={wrapRef}>
        {/* ---- chuông ---- */}
        <div className="popover-anchor">
          <button
            type="button"
            className="icon-btn topbar-bell"
            aria-label={unread > 0 ? `Thông báo · ${unread} chưa đọc` : 'Thông báo'}
            aria-haspopup="dialog"
            aria-expanded={open === 'bell'}
            data-active={open === 'bell' || undefined}
            onClick={() => toggle('bell')}
          >
            <BellIcon />
            {unread > 0 && <span className="topbar-count">{unread > 99 ? '99+' : unread}</span>}
          </button>
          {open === 'bell' && (
            <Popover label="Thông báo" wide>
              <div className="popover-head">
                <strong>Thông báo</strong>
                {unread > 0 && (
                  <button type="button" className="link-quiet" onClick={() => void markAllRead()}>
                    Đánh dấu đã đọc
                  </button>
                )}
              </div>
              <div className="notif-list popover-scroll">
                {recent.length === 0 ? (
                  <div className="pending-empty">Chưa có thông báo nào.</div>
                ) : (
                  recent.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="notif-item"
                      data-unread={!n.read || undefined}
                      onClick={() => openItem(n)}
                    >
                      <span className="notif-dot" aria-hidden />
                      <span className="min-w-0 text-left">
                        <div className="notif-title">{n.title}</div>
                        {n.body && <div className="notif-body">{n.body}</div>}
                      </span>
                      <span className="notif-time">{fmtShort(n.created_at)}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="popover-foot">
                <Link to="/thong-bao" className="link-quiet" onClick={() => setOpen(null)}>
                  Xem tất cả{items.length > recent.length ? ` (${items.length})` : ''}
                </Link>
              </div>
            </Popover>
          )}
        </div>

        {/* ---- tài khoản ---- */}
        <div className="popover-anchor">
          <button
            type="button"
            className="topbar-user"
            aria-haspopup="menu"
            aria-expanded={open === 'account'}
            data-active={open === 'account' || undefined}
            onClick={() => toggle('account')}
            title={`${user.username} · ${ROLE_LABELS[user.role]}`}
          >
            <span className="user-avatar" data-role={isAdmin ? 'admin' : 'member'} aria-hidden>
              {initials}
            </span>
            <span className="topbar-username">{user.username}</span>
            <Chevron />
          </button>
          {open === 'account' && (
            <Popover label="Tài khoản">
              <div className="popover-head popover-id">
                <span className="user-avatar" data-role={isAdmin ? 'admin' : 'member'} aria-hidden>
                  {initials}
                </span>
                <span className="min-w-0">
                  <div className="notif-title">{user.username}</div>
                  <div className="notif-body">{ROLE_LABELS[user.role]}</div>
                </span>
              </div>
              <nav className="popover-menu" role="menu" aria-label="Tài khoản">
                <Link to="/tai-khoan" role="menuitem" onClick={() => setOpen(null)}>
                  Thông tin tài khoản
                </Link>
                <Link to="/tai-khoan" role="menuitem" onClick={() => setOpen(null)}>
                  Đổi mật khẩu
                </Link>
                <button type="button" role="menuitem" data-danger onClick={() => void doLogout()}>
                  Đăng xuất
                </button>
              </nav>
            </Popover>
          )}
        </div>
      </div>
    </header>
  )
})
