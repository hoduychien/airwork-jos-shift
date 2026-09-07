import { useEffect, useMemo, useRef, useState } from 'react'
import type { Employee, PerShift, ScheduleMatrix, Shift, Violation } from '../lib/types'
import { SHIFT_LABELS, WEEKDAY_VI, WORK_SHIFTS, daysInMonth, perShiftLabel, weekdayOf } from '../lib/types'

interface Props {
  employees: Employee[]
  matrix: ScheduleMatrix
  daysInMonth: number
  month: number
  year: number
  minPerShift: PerShift
  violationMap: Map<string, string[]>
  violations: Violation[]
  manual: Set<string>
  onCellChange: (employeeId: string, day: number, shift: Shift) => void
  /** true → chỉ xem, không mở menu đổi ca (tài khoản không phải admin) */
  readOnly?: boolean
  /** tháng đã qua: bảng mờ đi, khóa chuột, có nhãn «chỉ xem» */
  locked?: boolean
  /** hàng được hiển thị (đã lọc theo tên) — dòng tổng vẫn tính trên `employees` */
  visibleEmployees?: Employee[]
  /** chỉ làm nổi ô đúng ca này, ô khác mờ đi */
  shiftFilter?: Shift | null
  /** ô đã đổi ca (key `${employeeId}:${day}`) → dòng mô tả hiện trong tooltip */
  swapTips?: Map<string, string>
  /** xem trước vài ngày đầu tháng sau ở mép phải — chỉ xem, không thao tác. `matrix` null = chưa có lịch */
  nextPreview?: { month: number; year: number; matrix: ScheduleMatrix | null }
}

/** số ngày tháng sau hiện thêm — để thấy ca nối tiếp qua tháng */
const PREVIEW_MAX = 5

interface MenuState {
  employeeId: string
  day: number
  x: number
  y: number
}

const SWATCH: Record<Shift, string> = {
  S1: 'var(--shift-s1)',
  S2: 'var(--shift-s2)',
  S3: 'var(--shift-s3)',
  OFF: 'var(--shift-off)',
}

const keyOf = (employeeId: string, day: number) => `${employeeId}:${day}`

export default function ScheduleGrid({
  employees,
  matrix,
  daysInMonth: D,
  month,
  year,
  minPerShift,
  violationMap,
  violations,
  manual,
  onCellChange,
  readOnly = false,
  locked = false,
  visibleEmployees,
  shiftFilter = null,
  swapTips,
  nextPreview,
}: Props) {
  const rows = visibleEmployees ?? employees
  // luôn hiện PREVIEW_MAX ngày đầu tháng sau (không quá số ngày tháng đó), mọi cỡ màn hình
  const previewDays = nextPreview ? Math.min(PREVIEW_MAX, daysInMonth(nextPreview.month, nextPreview.year)) : 0
  const preview = nextPreview && previewDays > 0 ? nextPreview : null
  const pDays = preview ? Array.from({ length: previewDays }, (_, i) => i + 1) : []
  const pCounts = WORK_SHIFTS.map((s) =>
    pDays.map((d) => employees.filter((e) => preview?.matrix?.[e.id]?.[d - 1] === s).length),
  )
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; msgs: string[]; title?: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  // gom toàn bộ vi phạm theo từng nhân viên → icon cảnh báo ở đầu hàng + tooltip
  const violsByEmp = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const v of violations) {
      if (!v.employee_id) continue
      const arr = map.get(v.employee_id) ?? []
      if (!arr.includes(v.message)) arr.push(v.message)
      map.set(v.employee_id, arr)
    }
    return map
  }, [violations])

  useEffect(() => {
    if (!menu) return
    const close = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenu(null)
    }
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menu])

  const days = Array.from({ length: D }, (_, i) => i + 1)
  const counts = WORK_SHIFTS.map((s) =>
    days.map((d) => employees.filter((e) => matrix[e.id]?.[d - 1] === s).length),
  )

  const totals = (e: Employee) => {
    const row = matrix[e.id] ?? []
    const s1 = row.filter((s) => s === 'S1').length
    const s2 = row.filter((s) => s === 'S2').length
    const s3 = row.filter((s) => s === 'S3').length
    return { s1, s2, s3, off: D - s1 - s2 - s3, tot: s1 + s2 + s3 }
  }

  const onCellClick = (ev: React.MouseEvent<HTMLButtonElement>, e: Employee, d: number) => {
    if (readOnly) return
    const r = ev.currentTarget.getBoundingClientRect()
    setTip(null)
    setMenu({ employeeId: e.id, day: d, x: r.left, y: r.bottom + 4 })
  }

  const menuEmp = menu ? byId.get(menu.employeeId) : undefined
  const menuShift: Shift = menu ? (matrix[menu.employeeId]?.[menu.day - 1] ?? 'OFF') : 'OFF'

  return (
    <div className="grid-wrap" data-locked={locked || undefined} data-readonly={readOnly || undefined}>
      {locked && <div className="grid-locked-tag">Tháng đã qua · chỉ xem</div>}
      <table className="sched">
        <thead>
          <tr>
            <th className="rowhead">Nhân viên</th>
            {days.map((d) => {
              const wd = weekdayOf(d, month, year)
              return (
                <th key={d} data-day={d} className={wd === 0 || wd === 6 ? 'weekend' : ''}>
                  <div style={{ fontSize: '0.6rem', fontWeight: 500, color: 'var(--color-ink-3)' }}>
                    {WEEKDAY_VI[wd]}
                  </div>
                  {d}
                </th>
              )
            })}
            {preview &&
              pDays.map((d) => {
                const wd = weekdayOf(d, preview.month, preview.year)
                return (
                  <th
                    key={'p' + d}
                    data-preview={d}
                    className={'preview ' + (wd === 0 || wd === 6 ? 'weekend' : '')}
                    title={d + '/' + preview.month + '/' + preview.year + ' — tháng sau, chỉ xem'}
                  >
                    <div style={{ fontSize: '0.6rem', fontWeight: 500, color: 'var(--color-ink-3)' }}>
                      {d === 1 ? 'T' + preview.month : WEEKDAY_VI[wd]}
                    </div>
                    {d}
                  </th>
                )
              })}
            <th>S1</th>
            <th>S2</th>
            <th>S3</th>
            <th>OFF</th>
            <th>Tổng</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="rowhead" colSpan={D + pDays.length + 6} style={{ color: 'var(--color-ink-3)', fontWeight: 500 }}>
                Không có nhân viên nào khớp bộ lọc.
              </td>
            </tr>
          )}
          {rows.map((e) => {
            const t = totals(e)
            const empViols = violsByEmp.get(e.id)
            return (
              <tr key={e.id}>
                <td className="rowhead">
                  <span className="flex items-center gap-1.5">
                    {empViols && (
                      <span
                        className="warn-dot"
                        role="img"
                        aria-label={`${e.name}: ${empViols.length} vi phạm ràng buộc`}
                        onMouseEnter={(ev) => {
                          const r = (ev.target as HTMLElement).getBoundingClientRect()
                          setTip({
                            x: r.right + 8,
                            y: r.top - 4,
                            title: `${e.name} — ${empViols.length} quy tắc đang vi phạm:`,
                            msgs: empViols.slice(0, 6),
                          })
                        }}
                        onMouseLeave={() => setTip(null)}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </span>
                    )}
                    <span style={empViols ? { color: 'var(--color-danger)' } : undefined}>{e.name}</span>
                    <span className="code" style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: '0.65rem' }}>
                      {e.code}
                    </span>
                  </span>
                </td>
                {days.map((d) => {
                  const shift = matrix[e.id]?.[d - 1] ?? 'OFF'
                  const key = keyOf(e.id, d)
                  const viols = violationMap.get(key)
                  const swapped = swapTips?.get(key)
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className="cell"
                        data-shift={shift}
                        data-violation={viols ? 'true' : undefined}
                        data-manual={manual.has(key) ? 'true' : undefined}
                        data-swapped={swapped ? 'true' : undefined}
                        data-dim={shiftFilter && shift !== shiftFilter ? 'true' : undefined}
                        aria-label={`${e.name} — ngày ${d}: ${SHIFT_LABELS[shift]}${viols ? ' (vi phạm)' : ''}${swapped ? ' (đã đổi ca)' : ''}`}
                        onClick={(ev) => onCellClick(ev, e, d)}
                        onMouseEnter={(ev) => {
                          if (viols || swapped) {
                            setTip({
                              x: ev.clientX + 10,
                              y: ev.clientY + 12,
                              title: swapped ? '⇄ Đã đổi ca' : undefined,
                              msgs: [...(swapped ? [swapped] : []), ...(viols ?? [])],
                            })
                          }
                        }}
                        onMouseLeave={() => setTip(null)}
                      >
                        {shift === 'OFF' ? '·' : shift}
                      </button>
                    </td>
                  )
                })}
                {preview &&
                  pDays.map((d) => {
                    const shift = preview.matrix?.[e.id]?.[d - 1]
                    return (
                      <td key={'p' + d} className="preview" data-first={d === 1 || undefined}>
                        <span className="cell cell-preview" data-shift={shift ?? 'OFF'} aria-hidden>
                          {!shift || shift === 'OFF' ? '·' : shift}
                        </span>
                      </td>
                    )
                  })}
                <td className="sum-cell">{t.s1}</td>
                <td className="sum-cell">{t.s2}</td>
                <td className="sum-cell">{t.s3}</td>
                <td className="sum-cell">{t.off}</td>
                <td className="sum-cell" style={{ fontWeight: 700, color: 'var(--color-ink)' }}>
                  {t.tot}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          {WORK_SHIFTS.map((s, i) => (
            <tr key={s}>
              <td className="rowhead" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                Số người {s} (≥{minPerShift[s]})
              </td>
              {days.map((d) => (
                <td key={d} className={`sum-cell ${counts[i][d - 1] < minPerShift[s] ? 'sum-low' : ''}`}>
                  {counts[i][d - 1]}
                </td>
              ))}
              {pDays.map((d) => (
                <td key={'p' + d} className="sum-cell preview">
                  {preview?.matrix ? pCounts[i][d - 1] : ''}
                </td>
              ))}
              <td colSpan={5} />
            </tr>
          ))}
          <tr>
            <td className="rowhead" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
              Kiểm tra (≥{perShiftLabel(minPerShift)}/ca)
            </td>
            {days.map((d) => {
              const ok = WORK_SHIFTS.every((s, i) => counts[i][d - 1] >= minPerShift[s])
              return (
                <td key={d} className={`sum-cell ${ok ? 'sum-ok' : 'sum-low'}`}>
                  {ok ? 'OK' : 'LOW'}
                </td>
              )
            })}
            {pDays.map((d) => (
              <td key={'p' + d} className="sum-cell preview" />
            ))}
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>

      {menu && menuEmp && (
        <div ref={menuRef} className="cell-menu" style={{ left: Math.min(menu.x, window.innerWidth - 260), top: menu.y }} role="menu">
          <div className="cell-menu-head">
            <strong>{menuEmp.name}</strong> · ngày {menu.day} · {SHIFT_LABELS[menuShift]}
          </div>

          {(['S1', 'S2', 'S3', 'OFF'] as Shift[]).map((s) => (
              <button
                key={s}
                role="menuitem"
                disabled={s === menuShift}
                onClick={() => {
                  onCellChange(menu.employeeId, menu.day, s)
                  setMenu(null)
                }}
              >
                <span className="swatch" style={{ background: SWATCH[s] }} />
                {SHIFT_LABELS[s]}
              </button>
            ))}
        </div>
      )}

      {tip && (
        <div className="viol-tip" style={{ left: Math.min(tip.x, window.innerWidth - 330), top: tip.y }}>
          {tip.title && <div style={{ fontWeight: 700, marginBottom: 2 }}>{tip.title}</div>}
          {tip.msgs.map((m, i) => (
            <div key={i}>{tip.title ? '• ' : ''}{m}</div>
          ))}
        </div>
      )}
    </div>
  )
}
