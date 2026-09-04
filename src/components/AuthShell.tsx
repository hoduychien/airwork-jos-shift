import type { ReactNode } from 'react'

/** Khung đăng nhập / đổi mật khẩu: một cột, form căn giữa trên nền giấy trắng. */
export default function AuthShell({ children, mode }: { children: ReactNode; mode: string }) {
  return (
    <div className="auth">
      <section className="auth-form">
        <div className="auth-panel">
          <div className="auth-head">
            <span className="flex items-center gap-2">
              <span className="user-avatar" aria-hidden style={{ background: 'var(--color-accent)' }}>
                AW
              </span>
              airwork-jos-shift
            </span>
            <span className="eyebrow">{mode}</span>
          </div>
          {children}
        </div>
      </section>
    </div>
  )
}
