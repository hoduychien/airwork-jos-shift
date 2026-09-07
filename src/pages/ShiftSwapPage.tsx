import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import AppSelect from '../components/AppSelect'
import { LoadingBar } from '../components/Loading'
import { useFeedback } from '../components/Feedback'
import { useAuth } from '../lib/AuthContext'
import { store, type StoredSchedule } from '../lib/store'
import { validateMatrix } from '../lib/solver/validate'
import {
  DEFAULT_SETTINGS,
  SHIFT_LABELS,
  WEEKDAY_VI,
  daysInMonth,
  employeesInMonth,
  weekdayOf,
  type Employee,
  type Settings,
  type Shift,
} from '../lib/types'
import {
  DECISION_LABELS,
  SWAP_STATUS_LABELS,
  applySwap,
  describeCell,
  fmtShort,
  isSwapDayOpen,
  pendingCellKeys,
  sortSwapRequests,
  validateSwapRequest,
  type Decision,
  type SwapRequest,
} from '../lib/swap'

/**
 * Đổi ca — nhân viên chọn 1 ca của mình và 1 ca của đồng nghiệp trong THÁNG HIỆN TẠI (lịch đã chốt).
 * Khi gửi: thông báo tới đồng nghiệp và PM. Cần đồng nghiệp đồng ý VÀ PM duyệt → lịch cập nhật,
 * hai ô được đánh dấu «đã đổi ca» (tooltip trên bảng lịch).
 */

const now = new Date()
const MONTH = now.getMonth() + 1
const YEAR = now.getFullYear()

const STATUS_CHIP: Record<SwapRequest['status'], string> = {
  pending: 'chip chip-warn',
  approved: 'chip chip-ok',
  rejected: 'chip',
  cancelled: 'chip',
}
const DECISION_CHIP: Record<Decision, string> = {
  pending: 'chip chip-warn',
  approved: 'chip chip-ok',
  rejected: 'chip',
}

function CellText({ day, shift, month, year }: { day: number; shift: Shift; month: number; year: number }) {
  return (
    <span className="mono" style={{ whiteSpace: 'nowrap' }}>
      {day}
      <span style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-2xs)' }}> {WEEKDAY_VI[weekdayOf(day, month, year)]}</span>{' '}
      <span className="swatch" style={{ display: 'inline-block', background: `var(--shift-${shift.toLowerCase()})`, verticalAlign: '-1px' }} />{' '}
      {shift}
    </span>
  )
}

export default function ShiftSwapPage() {
  const { user, isAdmin } = useAuth()
  const { confirm, toast } = useFeedback()
  const D = daysInMonth(MONTH, YEAR)

  const [employees, setEmployees] = useState<Employee[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [schedule, setSchedule] = useState<StoredSchedule | null>(null)
  const [requests, setRequests] = useState<SwapRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // form
  const [myDay, setMyDay] = useState<number>(Math.min(now.getDate(), D))
  const [partnerId, setPartnerId] = useState<string>('')
  const [partnerDay, setPartnerDay] = useState<number>(Math.min(now.getDate(), D))
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [emps, sets, sched, reqs] = await Promise.all([
        store.listEmployees(),
        store.getSettings(),
        store.getSchedule(MONTH, YEAR),
        store.listSwapRequests(MONTH, YEAR),
      ])
      setEmployees(employeesInMonth(emps, MONTH, YEAR))
      setSettings(sets)
      setSchedule(sched && sched.status === 'published' ? sched : null)
      setRequests(sortSwapRequests(reqs))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được dữ liệu đổi ca.', 'danger')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const myId = user?.employeeId
  const me = employees.find((e) => e.id === myId)
  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? '—'
  /** "Họ tên · MÃ" cho nhãn trong khung xem trước */
  const labelOf = (e: Employee | undefined) => (e ? `${e.name} · ${e.code}` : '—')
  const matrix = schedule?.matrix ?? {}
  const shiftAt = (id: string, day: number): Shift | undefined => matrix[id]?.[day - 1]

  const colleagues = employees.filter((e) => e.id !== myId)
  useEffect(() => {
    if (!partnerId && colleagues.length > 0) setPartnerId(colleagues[0].id)
  }, [colleagues, partnerId])

  const openDays = useMemo(
    () => Array.from({ length: D }, (_, i) => i + 1).filter((d) => isSwapDayOpen(d, MONTH, YEAR)),
    [D],
  )
  const pendingKeys = useMemo(() => pendingCellKeys(requests), [requests])

  const myShift = myId ? shiftAt(myId, myDay) : undefined
  const partnerShift = partnerId ? shiftAt(partnerId, partnerDay) : undefined

  const formError = useMemo(() => {
    if (!myId || !schedule) return null
    return validateSwapRequest(
      { requester_id: myId, requester_day: myDay, partner_id: partnerId, partner_day: partnerDay },
      matrix,
      MONTH,
      YEAR,
      pendingKeys,
    )
  }, [myId, schedule, myDay, partnerId, partnerDay, matrix, pendingKeys])

  /** vi phạm quy tắc cứng MỚI phát sinh nếu đổi — chỉ cảnh báo, không chặn (PM quyết) */
  const newViolations = useMemo(() => {
    if (!myId || !schedule || formError || !myShift || !partnerShift) return []
    const draft: SwapRequest = {
      id: 'draft',
      month: MONTH,
      year: YEAR,
      requester_id: myId,
      requester_day: myDay,
      requester_shift: myShift,
      partner_id: partnerId,
      partner_day: partnerDay,
      partner_shift: partnerShift,
      note: '',
      peer_status: 'pending',
      pm_status: 'pending',
      status: 'pending',
      created_at: '',
    }
    const opts = {
      employees,
      daysInMonth: D,
      minPerShift: settings.min_per_shift,
      streakMin: settings.streak_min,
      streakMax: settings.streak_max,
      restMax: settings.rest_max,
      skipBalance: true,
    }
    const before = new Set(validateMatrix({ ...opts, matrix }).map((v) => v.message))
    return validateMatrix({ ...opts, matrix: applySwap(matrix, draft) })
      .map((v) => v.message)
      .filter((m, i, arr) => !before.has(m) && arr.indexOf(m) === i)
  }, [myId, schedule, formError, myShift, partnerShift, myDay, partnerId, partnerDay, employees, D, settings, matrix])

  const submit = async () => {
    if (!myId || !myShift || !partnerShift || formError) return
    const ok = await confirm({
      title: 'Gửi đề nghị đổi ca?',
      message: (
        <>
          {describeCell(myDay, myShift)} của bạn ↔ {describeCell(partnerDay, partnerShift)} của {nameOf(partnerId)}.{' '}
          {nameOf(partnerId)} và PM sẽ nhận thông báo; cần cả hai đồng ý thì lịch mới đổi.
          {newViolations.length > 0 && (
            <>
              <br />
              <strong>Lưu ý:</strong> đổi xong sẽ phát sinh {newViolations.length} vi phạm quy tắc — PM sẽ cân nhắc.
            </>
          )}
        </>
      ),
      confirmLabel: 'Gửi đề nghị',
    })
    if (!ok) return
    setBusy('submit')
    try {
      await store.createSwapRequest({
        month: MONTH,
        year: YEAR,
        requester_id: myId,
        requester_day: myDay,
        requester_shift: myShift,
        partner_id: partnerId,
        partner_day: partnerDay,
        partner_shift: partnerShift,
        note: note.trim(),
      })
      toast(`Đã gửi đề nghị — ${nameOf(partnerId)} và PM đã được thông báo.`)
      setNote('')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gửi đề nghị thất bại.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (r: SwapRequest) => {
    const ok = await confirm({
      title: 'Rút lại đề nghị?',
      message: `${describeCell(r.requester_day, r.requester_shift)} ↔ ${describeCell(r.partner_day, r.partner_shift)} của ${nameOf(r.partner_id)}.`,
      confirmLabel: 'Rút lại',
      danger: true,
    })
    if (!ok) return
    setBusy(r.id)
    try {
      await store.cancelSwapRequest(r.id)
      toast('Đã rút lại đề nghị.')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không rút lại được.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const decide = async (r: SwapRequest, side: 'peer' | 'pm', status: 'approved' | 'rejected') => {
    const a = nameOf(r.requester_id)
    const b = nameOf(r.partner_id)
    const pair = `${describeCell(r.requester_day, r.requester_shift)} của ${a} ↔ ${describeCell(r.partner_day, r.partner_shift)} của ${b}`
    const willApply =
      status === 'approved' && (side === 'peer' ? r.pm_status === 'approved' : r.peer_status === 'approved')
    const ok = await confirm({
      title:
        status === 'approved'
          ? side === 'peer'
            ? 'Đồng ý đổi ca?'
            : `Duyệt đổi ca ${a} ↔ ${b}?`
          : 'Từ chối đổi ca?',
      message: (
        <>
          {pair}.
          {status === 'approved' && (
            <>
              {' '}
              {willApply
                ? 'Đây là lượt duyệt cuối — lịch sẽ được cập nhật ngay.'
                : side === 'peer'
                  ? 'Sau khi bạn đồng ý, PM sẽ duyệt.'
                  : `Còn chờ ${b} đồng ý.`}
            </>
          )}
        </>
      ),
      confirmLabel: status === 'approved' ? (side === 'peer' ? 'Đồng ý' : 'Duyệt') : 'Từ chối',
      danger: status === 'rejected',
    })
    if (!ok) return
    setBusy(r.id)
    try {
      await store.decideSwapRequest(r.id, side, status)
      toast(
        status === 'rejected'
          ? 'Đã từ chối — các bên đã được thông báo.'
          : willApply
            ? 'Đã đổi ca — lịch đã cập nhật, hai ô được đánh dấu «đã đổi ca».'
            : side === 'peer'
              ? 'Đã đồng ý — chờ PM duyệt.'
              : `Đã duyệt — chờ ${b} đồng ý.`,
        status === 'rejected' ? 'info' : 'ok',
      )
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Xử lý thất bại.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  const visible = isAdmin ? requests : requests.filter((r) => r.requester_id === myId || r.partner_id === myId)
  const pendingCount = visible.filter((r) => r.status === 'pending').length
  const dayOption = (id: string | undefined) => (d: number) => {
    const sh = id ? shiftAt(id, d) : undefined
    return { value: d, label: `${d} ${WEEKDAY_VI[weekdayOf(d, MONTH, YEAR)]} · ${sh ? (sh === 'OFF' ? 'Nghỉ' : sh) : '—'}` }
  }

  return (
    <div className="page">
      <LoadingBar active={loading || busy !== null} />
      <PageHeader
        title="Đổi ca"
        lede={`Tháng ${MONTH}/${YEAR} · đồng nghiệp đồng ý + PM duyệt → lịch cập nhật`}
        badge={pendingCount > 0 ? <span className="badge badge-draft">{pendingCount} chờ xử lý</span> : undefined}
      />

      {!loading && !schedule && (
        <div className="alert alert-warn" role="status">
          Lịch tháng {MONTH}/{YEAR} chưa được chốt nên chưa đổi ca được. Cần nghỉ tháng sau?{' '}
          <Link to="/xin-nghi" className="underline">
            Gửi xin nghỉ
          </Link>
          .
        </div>
      )}

      <div className="leave-grid">
        {/* ---- form ---- */}
        <section className="panel" aria-label="Gửi đề nghị đổi ca">
          <div className="panel-head">
            <h2>Gửi đề nghị</h2>
            {me && <span className="eyebrow">{me.name}</span>}
          </div>
          <div className="panel-body leave-body">
            {!myId ? (
              <p className="pending-intro" style={{ margin: 0 }}>
                {user?.role === 'pm'
                  ? 'Tài khoản PM không nằm trong danh sách làm ca. Bạn duyệt đề nghị của nhân viên ở bảng bên.'
                  : 'Tài khoản của bạn chưa gắn với nhân viên nào — nhờ admin/PM gắn ở trang Nhân viên.'}
              </p>
            ) : !schedule ? (
              <p className="pending-intro" style={{ margin: 0 }}>
                Chờ PM chốt lịch tháng {MONTH}/{YEAR}.
              </p>
            ) : openDays.length === 0 ? (
              <p className="pending-intro" style={{ margin: 0 }}>
                Tháng này không còn ngày nào để đổi.
              </p>
            ) : (
              <fieldset className="pending-form" disabled={busy !== null}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="field">
                    <span className="field-label">Ca của bạn</span>
                    <AppSelect
                      width="100%"
                      aria-label="Ngày của bạn"
                      options={openDays.map(dayOption(myId))}
                      value={openDays.includes(myDay) ? myDay : openDays[0]}
                      onChange={setMyDay}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Đồng nghiệp</span>
                    <AppSelect
                      width="100%"
                      aria-label="Đồng nghiệp"
                      options={colleagues.map((e) => ({ value: e.id, label: e.name }))}
                      value={partnerId}
                      onChange={setPartnerId}
                    />
                  </label>
                  <label className="field col-span-2">
                    <span className="field-label">Ca của đồng nghiệp</span>
                    <AppSelect
                      width="100%"
                      aria-label="Ngày của đồng nghiệp"
                      options={openDays.map(dayOption(partnerId))}
                      value={openDays.includes(partnerDay) ? partnerDay : openDays[0]}
                      onChange={setPartnerDay}
                    />
                  </label>
                </div>

                {myShift && partnerShift && (
                  <div className="swap-preview" aria-live="polite">
                    <div>
                      <span className="eyebrow">{labelOf(me)}</span>
                      <div>
                        <CellText day={myDay} shift={myShift} month={MONTH} year={YEAR} />
                        <span className="swap-arrow">→</span>
                        <strong className="mono">{partnerShift}</strong>
                      </div>
                    </div>
                    <div>
                      <span className="eyebrow">{labelOf(employees.find((e) => e.id === partnerId))}</span>
                      <div>
                        <CellText day={partnerDay} shift={partnerShift} month={MONTH} year={YEAR} />
                        <span className="swap-arrow">→</span>
                        <strong className="mono">{myShift}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {formError ? (
                  <div className="alert alert-warn" role="status" style={{ margin: 0 }}>
                    {formError}
                  </div>
                ) : newViolations.length > 0 ? (
                  <div className="alert alert-warn" role="status" style={{ margin: 0 }}>
                    Đổi xong sẽ phát sinh {newViolations.length} vi phạm quy tắc (PM sẽ cân nhắc):
                    <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                      {newViolations.slice(0, 4).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <label className="field">
                  <span className="field-label">Ghi chú (tuỳ chọn)</span>
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="Lý do đổi ca…"
                    value={note}
                    maxLength={300}
                    onChange={(ev) => setNote(ev.target.value)}
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void submit()}
                    disabled={!!formError || !myShift || !partnerShift}
                    data-loading={busy === 'submit' || undefined}
                  >
                    Gửi đề nghị
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        </section>

        {/* ---- danh sách ---- */}
        <section className="panel" aria-label="Đề nghị đổi ca">
          <div className="panel-head">
            <h2>{isAdmin ? 'Đề nghị đổi ca' : 'Đề nghị liên quan tới tôi'}</h2>
            <span className="eyebrow">tháng {MONTH}/{YEAR}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Người gửi</th>
                  <th>Ca gửi</th>
                  <th>Đồng nghiệp</th>
                  <th>Ca nhận</th>
                  <th>Đồng nghiệp</th>
                  <th>PM</th>
                  <th>Trạng thái</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="pending-empty">
                      {loading ? 'Đang tải…' : 'Chưa có đề nghị nào.'}
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => {
                    const isRequester = r.requester_id === myId
                    const isPartner = r.partner_id === myId
                    const pend = r.status === 'pending'
                    return (
                      <tr key={r.id} data-active={pend || undefined}>
                        <td>
                          {nameOf(r.requester_id)}
                          {r.note && <div className="leave-note">{r.note}</div>}
                        </td>
                        <td>
                          <CellText day={r.requester_day} shift={r.requester_shift} month={r.month} year={r.year} />
                        </td>
                        <td>{nameOf(r.partner_id)}</td>
                        <td>
                          <CellText day={r.partner_day} shift={r.partner_shift} month={r.month} year={r.year} />
                        </td>
                        <td>
                          <span className={DECISION_CHIP[r.peer_status]}>{DECISION_LABELS[r.peer_status]}</span>
                        </td>
                        <td>
                          <span className={DECISION_CHIP[r.pm_status]}>{DECISION_LABELS[r.pm_status]}</span>
                        </td>
                        <td>
                          <span className={STATUS_CHIP[r.status]}>{SWAP_STATUS_LABELS[r.status]}</span>
                          <div className="leave-note">{fmtShort(r.applied_at ?? r.created_at)}</div>
                        </td>
                        <td className="actions">
                          {pend && isPartner && r.peer_status === 'pending' && (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void decide(r, 'peer', 'approved')}
                                disabled={busy !== null}
                              >
                                Đồng ý
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void decide(r, 'peer', 'rejected')}
                                disabled={busy !== null}
                              >
                                Từ chối
                              </button>
                            </>
                          )}
                          {pend && isAdmin && r.pm_status === 'pending' && (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => void decide(r, 'pm', 'approved')}
                                disabled={busy !== null}
                                title={r.peer_status === 'pending' ? 'Đồng nghiệp chưa trả lời — duyệt trước vẫn được' : undefined}
                              >
                                Duyệt
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => void decide(r, 'pm', 'rejected')}
                                disabled={busy !== null}
                              >
                                Từ chối
                              </button>
                            </>
                          )}
                          {pend && isRequester && (
                            <button className="btn btn-ghost btn-sm" onClick={() => void cancel(r)} disabled={busy !== null}>
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

      <p className="leave-note">
        Ô đã đổi ca hiện dấu <span className="mono">⇄</span> trên bảng lịch, rê chuột để xem đổi với ai. Ca: {SHIFT_LABELS.S1} ·{' '}
        {SHIFT_LABELS.S2} · {SHIFT_LABELS.S3}.
      </p>
    </div>
  )
}
