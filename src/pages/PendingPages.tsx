import type { ReactNode } from 'react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../lib/AuthContext'
import { SHIFT_LABELS } from '../lib/types'

/**
 * Màn hình CHỜ RA MẮT (chưa đưa vào phiên bản này): Bàn giao ca.
 * Người dùng xem được bố cục dự kiến nhưng mọi control đều bị khóa, không có thao tác nào ghi dữ liệu.
 */

function PendingShell({
  title,
  lede,
  intro,
  steps,
  children,
}: {
  title: string
  lede: string
  intro: ReactNode
  steps: string[]
  children: ReactNode
}) {
  return (
    <div className="page">
      <PageHeader title={title} lede={lede} badge={<span className="badge badge-draft">Sắp ra mắt</span>} />

      <div className="alert alert-warn" role="status">
        Tính năng này chưa có trong phiên bản hiện tại. Bên dưới là bản xem trước — chưa thao tác được.
      </div>

      <div className="pending-grid">
        <section className="panel" aria-label="Mô tả tính năng">
          <div className="panel-head">
            <h2>Sẽ hoạt động thế nào</h2>
          </div>
          <div className="panel-body pending-body">
            <p className="pending-intro">{intro}</p>
            <ol className="pending-steps">
              {steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="panel pending-preview" aria-label="Xem trước" aria-disabled="true">
          <div className="panel-head">
            <h2>Xem trước</h2>
            <span className="eyebrow">chưa kích hoạt</span>
          </div>
          <div className="panel-body pending-body">{children}</div>
        </section>
      </div>
    </div>
  )
}

/** Bàn giao ca (Handover) — người kết thúc ca ghi lại tình hình, người vào ca đọc và xác nhận */
export function HandoverPage() {
  const { user } = useAuth()
  return (
    <PendingShell
      title="Bàn giao ca"
      lede="Ghi chú cuối ca cho người vào ca sau — đi sớm 10' để bàn giao"
      intro={
        <>
          Cuối ca, người trực ghi lại tình hình hệ thống, sự cố đang theo dõi và việc còn dở. Người vào ca sau đọc,
          đánh dấu <strong>đã nhận bàn giao</strong>. Mỗi ngày có 3 lượt bàn giao tương ứng 3 ca; admin và PM xem được
          toàn bộ lịch sử.
        </>
      }
      steps={[
        'Người kết thúc ca mở lượt bàn giao của ca mình (S1 → S2 → S3).',
        'Ghi tình hình, sự cố đang mở, việc cần tiếp tục; đính kèm link ticket nếu có.',
        'Người vào ca đọc và bấm «Đã nhận bàn giao» trong 10 phút đầu ca.',
        'Lượt bàn giao chưa được xác nhận sẽ hiện cảnh báo trên bảng lịch.',
      ]}
    >
      <fieldset className="pending-form" disabled>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Ca bàn giao</span>
            <input className="input" value={`Hôm nay · ${SHIFT_LABELS.S1} → ${SHIFT_LABELS.S2}`} readOnly />
          </label>
          <label className="field">
            <span className="field-label">Người bàn giao</span>
            <input className="input" value={user?.username ?? ''} readOnly />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Tình hình hệ thống</span>
          <textarea className="input" rows={2} placeholder="Ổn định / đang có cảnh báo…" readOnly />
        </label>
        <label className="field">
          <span className="field-label">Sự cố đang theo dõi · việc còn dở</span>
          <textarea className="input" rows={3} placeholder="Mã ticket, mô tả ngắn, việc cần tiếp tục…" readOnly />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" type="button" disabled>
            Lưu nháp
          </button>
          <button className="btn btn-primary" type="button" disabled>
            Gửi bàn giao
          </button>
        </div>
      </fieldset>

      <div className="table-wrap" style={{ marginTop: 'var(--space-md)' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Ca</th>
              <th>Người giao → nhận</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="pending-empty">
                Chưa có lượt bàn giao nào.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PendingShell>
  )
}
