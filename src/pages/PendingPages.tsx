import type { ReactNode } from 'react'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../lib/AuthContext'
import { SHIFT_LABELS } from '../lib/types'

/**
 * Màn hình CHỜ RA MẮT (chưa đưa vào phiên bản này): Xin nghỉ · Đổi ca · Bàn giao ca.
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

/** Xin nghỉ (Request off) — nhân viên gửi ngày muốn nghỉ, admin/PM duyệt trước khi xếp lịch */
export function RequestOffPage() {
  const { user } = useAuth()
  return (
    <PendingShell
      title="Xin nghỉ"
      lede="Gửi ngày muốn nghỉ để được tính vào lịch tháng sau"
      intro={
        <>
          Nhân viên chọn ngày cần nghỉ trong tháng sắp xếp lịch và ghi lý do. Yêu cầu ở trạng thái{' '}
          <strong>chờ duyệt</strong> cho đến khi admin hoặc PM xử lý. Ngày được duyệt sẽ tự thành ngày nghỉ cố định
          khi tạo lịch.
        </>
      }
      steps={[
        'Chọn tháng và các ngày muốn nghỉ trên lịch.',
        'Ghi lý do ngắn (tuỳ chọn) rồi gửi yêu cầu.',
        'Admin / PM duyệt hoặc từ chối, có thông báo lại cho người gửi.',
        'Ngày đã duyệt được đưa vào ràng buộc khi «Tạo lịch tự động».',
      ]}
    >
      <fieldset className="pending-form" disabled>
        <label className="field">
          <span className="field-label">Người gửi</span>
          <input className="input" value={user?.username ?? ''} readOnly />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Tháng</span>
            <input className="input" value="Tháng sau" readOnly />
          </label>
          <label className="field">
            <span className="field-label">Số ngày</span>
            <input className="input" value="0" readOnly />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Lý do</span>
          <textarea className="input" rows={3} placeholder="Ví dụ: việc gia đình, khám bệnh…" readOnly />
        </label>
        <div className="flex justify-end">
          <button className="btn btn-primary" type="button" disabled>
            Gửi yêu cầu
          </button>
        </div>
      </fieldset>

      <div className="table-wrap" style={{ marginTop: 'var(--space-md)' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Lý do</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={3} className="pending-empty">
                Chưa có yêu cầu nào.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PendingShell>
  )
}

/** Đổi ca (Shift swap request) — hai nhân viên đổi ca cho nhau trong lịch đã chốt, cần admin/PM duyệt */
export function ShiftSwapPage() {
  const { user } = useAuth()
  return (
    <PendingShell
      title="Đổi ca"
      lede="Đề nghị đổi ca với đồng nghiệp trong lịch đã chốt"
      intro={
        <>
          Nhân viên chọn một ca của mình và một ca của đồng nghiệp muốn đổi. Người kia xác nhận, sau đó admin hoặc PM
          duyệt. Hệ thống tự kiểm tra các quy tắc cứng (nghỉ ≥ 16h, độ phủ tối thiểu) trước khi cho phép.
        </>
      }
      steps={[
        'Chọn ngày và ca của bạn muốn đổi.',
        'Chọn đồng nghiệp và ca của họ để đổi lấy.',
        'Đồng nghiệp xác nhận, admin / PM duyệt.',
        'Lịch đã chốt được cập nhật, hai ô được đánh dấu «đã đổi ca».',
      ]}
    >
      <fieldset className="pending-form" disabled>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span className="field-label">Ca của bạn</span>
            <input className="input" value={`${user?.username ?? ''} · ${SHIFT_LABELS.S1}`} readOnly />
          </label>
          <label className="field">
            <span className="field-label">Đổi lấy</span>
            <input className="input" value="— chọn đồng nghiệp —" readOnly />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Ghi chú</span>
          <textarea className="input" rows={2} placeholder="Lý do đổi ca (tuỳ chọn)" readOnly />
        </label>
        <div className="flex justify-end">
          <button className="btn btn-primary" type="button" disabled>
            Gửi đề nghị
          </button>
        </div>
      </fieldset>

      <div className="table-wrap" style={{ marginTop: 'var(--space-md)' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Bạn</th>
              <th>Đồng nghiệp</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="pending-empty">
                Chưa có đề nghị nào.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PendingShell>
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
