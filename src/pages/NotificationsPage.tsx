import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { LoadingBar } from '../components/Loading'
import { useNotifications } from '../lib/NotificationsContext'
import { fmtShort } from '../lib/swap'

/** Thông báo trong app: đề nghị đổi ca, kết quả duyệt… Mở trang = đánh dấu đã đọc tất cả. */
export default function NotificationsPage() {
  const { items, loading, unread, markAllRead, refresh } = useNotifications()

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="page">
      <LoadingBar active={loading} />
      <PageHeader
        title="Thông báo"
        lede="Đề nghị đổi ca, kết quả duyệt và các việc cần bạn xử lý"
        badge={unread > 0 ? <span className="badge badge-draft">{unread} chưa đọc</span> : undefined}
        actions={
          unread > 0 ? (
            <button className="btn btn-ghost" onClick={() => void markAllRead()}>
              Đánh dấu đã đọc
            </button>
          ) : undefined
        }
      />

      <section className="panel" aria-label="Danh sách thông báo">
        <div className="notif-list">
          {items.length === 0 ? (
            <div className="pending-empty">{loading ? 'Đang tải…' : 'Chưa có thông báo nào.'}</div>
          ) : (
            items.map((n) => (
              <Link key={n.id} to={n.link || '/'} className="notif-item" data-unread={!n.read || undefined}>
                <span className="notif-dot" aria-hidden />
                <span className="min-w-0">
                  <div className="notif-title">{n.title}</div>
                  {n.body && <div className="notif-body">{n.body}</div>}
                </span>
                <span className="notif-time">{fmtShort(n.created_at)}</span>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
