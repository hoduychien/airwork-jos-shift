import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { LoadingBar } from '../components/Loading'
import { useFeedback } from '../components/Feedback'
import { useAuth } from '../lib/AuthContext'
import { store } from '../lib/store'
import { WEEKDAY_VI, daysInMonth, weekdayOf, type Employee } from '../lib/types'
import {
  LEAVE_STATUS_LABELS,
  leaveMonthState,
  leaveTarget,
  normalizeDays,
  sameMonth,
  shiftMonth,
  sortLeaveRequests,
  validateLeaveRequest,
  type LeaveRequest,
  type MonthRef,
} from '../lib/leave'

/**
 * Xin nghỉ — nhân viên gửi ngày muốn nghỉ cho THÁNG SAU; admin/PM duyệt → ngày được duyệt
 * gộp vào «Ngày nghỉ cố định» của tháng đó (trang Nhân viên) và solver tôn trọng khi tạo lịch.
 * Tháng này đã có lịch → không xin nghỉ được, hướng sang «Đổi ca».
 */

const STATUS_CHIP: Record<LeaveRequest['status'], string> = {
  pending: 'chip chip-warn',
  approved: 'chip chip-ok',
  rejected: 'chip',
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function DayList({ days, month, year }: { days: number[]; month: number; year: number }) {
  return (
    <span className="mono" style={{ whiteSpace: 'normal' }}>
      {days.map((d, i) => (
        <span key={d}>
          {i > 0 && ', '}
          {d}
          <span style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-2xs)' }}>
            {' '}
            {WEEKDAY_VI[weekdayOf(d, month, year)]}
          </span>
        </span>
      ))}
    </span>
  )
}

export default function RequestOffPage() {
  const { user, isAdmin } = useAuth()
  const { confirm, toast } = useFeedback()

  const target = useMemo(() => leaveTarget(), [])
  const [view, setView] = useState<MonthRef>(target)
  const state = leaveMonthState(view)
  const isOpen = state === 'open'
  const D = daysInMonth(view.month, view.year)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [fixedOff, setFixedOff] = useState<Record<string, number[]>>({})
  const [published, setPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [picked, setPicked] = useState<number[]>([])
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, reqs, offs, sched] = await Promise.all([
        store.listEmployees(),
        store.listLeaveRequests(view.month, view.year),
        store.getDayOffs(view.month, view.year),
        store.getSchedule(view.month, view.year),
      ])
      setEmployees(emps)
      setRequests(sortLeaveRequests(reqs))
      setFixedOff(offs)
      setPublished(sched?.status === 'published')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được dữ liệu xin nghỉ.', 'danger')
    } finally {
      setLoading(false)
    }
  }, [view.month, view.year, toast])

  useEffect(() => {
    void load()
    setPicked([])
  }, [load])

  const myId = user?.employeeId
  const me = employees.find((e) => e.id === myId)
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'

  const mine = useMemo(() => requests.filter((r) => r.employee_id === myId), [requests, myId])
  const myFixed = myId ? (fixedOff[myId] ?? []) : []
  const myPendingDays = useMemo(
    () => mine.filter((r) => r.status === 'pending').flatMap((r) => r.days),
    [mine],
  )
  const pendingCount = requests.filter((r) => r.status === 'pending').length

  const togglePick = (d: number) =>
    setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort((a, b) => a - b)))

  const submit = async () => {
    if (!myId) return
    const days = normalizeDays(picked, D)
    const err = validateLeaveRequest(days, myFixed, myPendingDays)
    if (err) {
      toast(err, 'danger')
      return
    }
    setBusy('submit')
    try {
      await store.createLeaveRequest({
        employee_id: myId,
        month: view.month,
        year: view.year,
        days,
        reason: reason.trim(),
      })
      toast(`Đã gửi yêu cầu nghỉ ${days.length} ngày tháng ${view.month}/${view.year}, chờ PM duyệt.`)
      setPicked([])
      setReason('')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gửi yêu cầu thất bại.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (r: LeaveRequest) => {
    const ok = await confirm({
      title: 'Rút lại yêu cầu?',
      message: `Yêu cầu nghỉ ngày ${r.days.join(', ')} sẽ bị xóa.`,
      confirmLabel: 'Rút lại',
      danger: true,
    })
    if (!ok) return
    setBusy(r.id)
    try {
      await store.cancelLeaveRequest(r.id)
      toast('Đã rút lại yêu cầu.')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không rút lại được.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const decide = async (r: LeaveRequest, status: 'approved' | 'rejected') => {
    const who = nameOf(r.employee_id)
    const ok = await confirm({
      title: status === 'approved' ? `Duyệt cho ${who}?` : `Từ chối yêu cầu của ${who}?`,
      message:
        status === 'approved' ? (
          <>
            Ngày <strong>{r.days.join(', ')}</strong> sẽ được thêm vào ngày nghỉ cố định tháng {r.month}/{r.year} của{' '}
            {who}.
            {published && (
              <>
                {' '}
                Lịch tháng này <strong>đã chốt</strong> — cần xếp lại khoảng ngày liên quan hoặc sửa tay trên bảng
                lịch.
              </>
            )}
          </>
        ) : (
          <>Yêu cầu nghỉ ngày {r.days.join(', ')} sẽ chuyển sang «Từ chối». Người gửi thấy được kết quả.</>
        ),
      confirmLabel: status === 'approved' ? 'Duyệt' : 'Từ chối',
      danger: status === 'rejected',
    })
    if (!ok) return
    setBusy(r.id)
    try {
      await store.decideLeaveRequest(r.id, status)
      toast(
        status === 'approved'
          ? `Đã duyệt — thêm ${r.days.length} ngày vào ngày nghỉ cố định của ${who}.`
          : `Đã từ chối yêu cầu của ${who}.`,
        status === 'approved' ? 'ok' : 'info',
      )
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Xử lý thất bại.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const monthLabel = `tháng ${view.month}/${view.year}`

  return (
    <div className="page">
      <LoadingBar active={loading || busy !== null} />
      <PageHeader
        title="Xin nghỉ"
        lede={`Gửi ngày muốn nghỉ cho tháng sau · PM duyệt → thành ngày nghỉ cố định`}
        badge={
          isAdmin && pendingCount > 0 ? <span className="badge badge-draft">{pendingCount} chờ duyệt</span> : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="btn-group">
              <button className="btn btn-ghost" onClick={() => setView((v) => shiftMonth(v, -1))} aria-label="Tháng trước">
                ‹
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setView(target)}
                disabled={sameMonth(view, target)}
                style={{ minWidth: '9rem' }}
              >
                Tháng {view.month}/{view.year}
              </button>
              <button className="btn btn-ghost" onClick={() => setView((v) => shiftMonth(v, 1))} aria-label="Tháng sau">
                ›
              </button>
            </div>
          </div>
        }
      />

      {state === 'current' && (
        <div className="alert alert-warn" role="status">
          Tháng này đã có lịch nên không nhận xin nghỉ. Cần nghỉ trong {monthLabel}?{' '}
          <Link to="/doi-ca" className="underline">
            Gửi đề nghị đổi ca
          </Link>{' '}
          với đồng nghiệp.
        </div>
      )}
      {state === 'future' && (
        <div className="alert alert-warn" role="status">
          Chưa mở xin nghỉ cho {monthLabel}. Hiện chỉ nhận yêu cầu cho tháng {target.month}/{target.year}.
        </div>
      )}
      {state === 'past' && (
        <div className="alert" role="status">
          {monthLabel} đã qua — chỉ xem lại lịch sử.
        </div>
      )}
      {isOpen && published && isAdmin && (
        <div className="alert alert-warn" role="status">
          Lịch {monthLabel} đã chốt. Duyệt xin nghỉ lúc này chỉ thêm ngày nghỉ cố định — cần xếp lại hoặc sửa tay
          bảng lịch cho khớp.
        </div>
      )}

      <div className="leave-grid">
        {/* ---- form: nhân viên có gắn tài khoản ---- */}
        {myId ? (
          <section className="panel" aria-label="Gửi yêu cầu xin nghỉ">
            <div className="panel-head">
              <h2>Gửi yêu cầu</h2>
              <span className="eyebrow">{me?.name ?? user?.username}</span>
            </div>
            <div className="panel-body leave-body">
              {isOpen ? (
                <fieldset className="pending-form" disabled={busy !== null}>
                  <div className="field">
                    <span className="field-label">
                      Ngày muốn nghỉ — {monthLabel} ({picked.length} ngày)
                    </span>
                    <div className="daypick">
                      {WEEKDAY_VI.map((w) => (
                        <span key={w} className="daypick-dow">
                          {w}
                        </span>
                      ))}
                      {Array.from({ length: weekdayOf(1, view.month, view.year) }, (_, i) => (
                        <span key={`pad-${i}`} aria-hidden />
                      ))}
                      {Array.from({ length: D }, (_, i) => i + 1).map((d) => {
                        const fixed = myFixed.includes(d)
                        const pending = myPendingDays.includes(d)
                        const on = picked.includes(d)
                        const weekend = [0, 6].includes(weekdayOf(d, view.month, view.year))
                        return (
                          <button
                            key={d}
                            type="button"
                            className="daypick-day"
                            aria-pressed={on}
                            disabled={fixed || pending}
                            data-on={on || undefined}
                            data-fixed={fixed || undefined}
                            data-pending={pending || undefined}
                            data-weekend={weekend || undefined}
                            title={fixed ? 'Đã là ngày nghỉ cố định' : pending ? 'Đang chờ duyệt' : undefined}
                            onClick={() => togglePick(d)}
                          >
                            {d}
                          </button>
                        )
                      })}
                    </div>
                    <span className="daypick-legend">
                      <i data-kind="fixed" /> nghỉ cố định · <i data-kind="pending" /> đang chờ duyệt
                    </span>
                  </div>
                  <label className="field">
                    <span className="field-label">Lý do (tuỳ chọn)</span>
                    <textarea
                      className="input"
                      rows={3}
                      placeholder="Ví dụ: việc gia đình, khám bệnh…"
                      value={reason}
                      maxLength={300}
                      onChange={(ev) => setReason(ev.target.value)}
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    {picked.length > 0 && (
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPicked([])}>
                        Bỏ chọn
                      </button>
                    )}
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void submit()}
                      disabled={picked.length === 0}
                      data-loading={busy === 'submit' || undefined}
                    >
                      Gửi yêu cầu
                    </button>
                  </div>
                </fieldset>
              ) : (
                <p className="pending-intro" style={{ margin: 0 }}>
                  {state === 'current' ? (
                    <>
                      Không xin nghỉ cho tháng đang chạy. Hãy dùng{' '}
                      <Link to="/doi-ca" className="underline">
                        Đổi ca
                      </Link>{' '}
                      hoặc chuyển sang{' '}
                      <button className="underline" type="button" onClick={() => setView(target)}>
                        tháng {target.month}/{target.year}
                      </button>
                      .
                    </>
                  ) : (
                    <>
                      Chỉ nhận xin nghỉ cho{' '}
                      <button className="underline" type="button" onClick={() => setView(target)}>
                        tháng {target.month}/{target.year}
                      </button>
                      .
                    </>
                  )}
                </p>
              )}
              {myFixed.length > 0 && (
                <p className="leave-note">
                  Ngày nghỉ cố định {monthLabel} của bạn: <span className="mono">{myFixed.join(', ')}</span>
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="panel" aria-label="Không gắn nhân viên">
            <div className="panel-head">
              <h2>Gửi yêu cầu</h2>
            </div>
            <div className="panel-body leave-body">
              <p className="pending-intro" style={{ margin: 0 }}>
                {user?.role === 'pm'
                  ? 'Tài khoản PM không nằm trong danh sách làm ca nên không cần xin nghỉ. Bạn duyệt yêu cầu của nhân viên ở bảng bên.'
                  : 'Tài khoản của bạn chưa gắn với nhân viên nào — nhờ admin/PM gắn ở trang Nhân viên để gửi xin nghỉ.'}
              </p>
            </div>
          </section>
        )}

        {/* ---- danh sách: của tôi (member) / tất cả (admin, PM) ---- */}
        <section className="panel" aria-label={isAdmin ? 'Yêu cầu chờ duyệt' : 'Yêu cầu của tôi'}>
          <div className="panel-head">
            <h2>{isAdmin ? 'Yêu cầu xin nghỉ' : 'Yêu cầu của tôi'}</h2>
            <span className="eyebrow">{monthLabel}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {isAdmin && <th>Nhân viên</th>}
                  <th>Ngày</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                  <th>Gửi lúc</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {(isAdmin ? requests : mine).length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 5} className="pending-empty">
                      {loading ? 'Đang tải…' : 'Chưa có yêu cầu nào.'}
                    </td>
                  </tr>
                ) : (
                  (isAdmin ? requests : mine).map((r) => {
                    const isMine = r.employee_id === myId
                    return (
                      <tr key={r.id} data-active={r.status === 'pending' || undefined}>
                        {isAdmin && <td>{nameOf(r.employee_id)}</td>}
                        <td>
                          <DayList days={r.days} month={r.month} year={r.year} />
                        </td>
                        <td style={{ color: r.reason ? undefined : 'var(--color-ink-3)', maxWidth: '18rem' }}>
                          {r.reason || '—'}
                          {r.decision_note && (
                            <div className="leave-note" style={{ marginTop: '0.2rem' }}>
                              PM: {r.decision_note}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={STATUS_CHIP[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</span>
                          {r.status !== 'pending' && (
                            <div className="leave-note">{fmtDateTime(r.decided_at)}</div>
                          )}
                        </td>
                        <td className="mono" style={{ color: 'var(--color-ink-2)' }}>
                          {fmtDateTime(r.created_at)}
                        </td>
                        <td className="actions">
                          {r.status === 'pending' && isAdmin && (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void decide(r, 'approved')}
                                disabled={busy !== null}
                                data-loading={busy === r.id || undefined}
                              >
                                Duyệt
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void decide(r, 'rejected')}
                                disabled={busy !== null}
                              >
                                Từ chối
                              </button>
                            </>
                          )}
                          {r.status === 'pending' && isMine && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => void cancel(r)}
                              disabled={busy !== null}
                            >
                              Rút lại
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
