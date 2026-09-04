import type { ReactNode } from 'react'

/** Tiêu đề trang: dải mỏng kẻ đậm 2px — tiêu đề + badge + meta mono bên trái, hành động bên phải. */
export default function PageHeader({
  title,
  lede,
  badge,
  actions,
}: {
  title: string
  lede?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <h1>{title}</h1>
          {badge}
        </span>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}
