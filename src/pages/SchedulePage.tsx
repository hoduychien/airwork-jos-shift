import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DateRangePicker from '@wojtekmaj/react-daterange-picker'
import '@wojtekmaj/react-daterange-picker/dist/DateRangePicker.css'
import 'react-calendar/dist/Calendar.css'
import AppSelect from '../components/AppSelect'
import RuleChecklist from '../components/RuleChecklist'
import ScheduleGrid from '../components/ScheduleGrid'
import PageHeader from '../components/PageHeader'
import { Busy, GridSkeleton, LoadingBar, Spinner } from '../components/Loading'
import { useSolver } from '../hooks/useSolver'
import { useDebounce } from '../hooks/useDebounce'
// exceljs nặng ~1MB — chỉ tải khi bấm export
const loadExport = () => import('../lib/export')
import { store, type StoredSchedule } from '../lib/store'
import { backupFilename, buildBackup, parseBackup, planRestore } from '../lib/backup'
import { validateMatrix, violationCellMap } from '../lib/solver/validate'
import type { Employee, ScheduleMatrix, Settings, Shift } from '../lib/types'
import { DEFAULT_SETTINGS, WORK_SHIFTS, applyMonthData, daysInMonth, isPastMonth, perShiftLabel } from '../lib/types'
import { useAuth } from '../lib/AuthContext'
import { useFeedback } from '../components/Feedback'
import { swappedCellTips, type SwapRequest } from '../lib/swap'

const now = new Date()

export default function SchedulePage() {
  const { isAdmin } = useAuth()
  const { confirm, toast } = useFeedback()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  /** tháng đã qua → chỉ xem: không tạo lại, không chỉnh ô, không chốt, không nhập lại */
  const isPast = isPastMonth(month, year)
  const canEdit = isAdmin && !isPast
  const [employees, setEmployees] = useState<Employee[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [swaps, setSwaps] = useState<SwapRequest[]>([])
  const [schedule, setSchedule] = useState<StoredSchedule | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  // nhập lại lịch từ file sao lưu JSON
  const importRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  // 'hard' = đổi tháng / lần đầu (chưa có gì để vẽ → skeleton); 'soft' = tải lại nền (giữ bảng, phủ mờ)
  const [loading, setLoading] = useState<'hard' | 'soft' | null>('hard')
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)
  // ---- bộ lọc hiển thị: theo tên nhân viên, theo ca ----
  const [query, setQuery] = useState('')
  // ô nhập cập nhật ngay, bảng chỉ lọc lại sau khi ngừng gõ 250ms
  const debouncedQuery = useDebounce(query, 250)
  const [shiftFilter, setShiftFilter] = useState<Shift | null>(null)
  // popup chọn khoảng ngày cần xếp (mở khi bấm "Xáo phương án khác"); null = đóng
  const [rangePick, setRangePick] = useState<[Date, Date] | null>(null)
  const { run, running } = useSolver()
  const seedRef = useRef(1)
  // realtime: bỏ qua sự kiện do chính tab này vừa ghi (mỗi dòng upsert = 1 sự kiện → hàng trăm lần fetch),
  // các sự kiện còn lại (người khác sửa) gom lại thành một lần tải sau 800ms
  const selfWriteUntil = useRef(0)
  const realtimeTimer = useRef<number | undefined>(undefined)
  const markSelfWrite = () => {
    selfWriteUntil.current = Date.now() + 2000
  }

  const D = daysInMonth(month, year)
  const monthStart = useMemo(() => new Date(year, month - 1, 1), [month, year])
  const monthEnd = useMemo(() => new Date(year, month - 1, D), [month, year, D])
  // đổi tháng → đóng popup chọn khoảng ngày
  useEffect(() => setRangePick(null), [month, year])
  /** khoảng ngày 1-based [from..to] trong tháng từ 2 mốc Date; null = cả tháng */
  const toDayRange = (pick: [Date, Date] | null): { from: number; to: number } | null => {
    if (!pick) return null
    const lo = Math.max(1, Math.min(pick[0].getDate(), pick[1].getDate()))
    const hi = Math.min(D, Math.max(pick[0].getDate(), pick[1].getDate()))
    return lo <= 1 && hi >= D ? null : { from: lo, to: hi }
  }
  const rangeLabelOf = (r: { from: number; to: number } | null) => (r ? `ngày ${r.from}–${r.to}` : 'cả tháng')

  const load = useCallback(
    async (mode: 'hard' | 'soft' = 'hard') => {
      setLoading(mode)
      try {
        const [emps, sets, dayoffs, prefs, sched, swapList] = await Promise.all([
          store.listEmployees(),
          store.getSettings(),
          store.getDayOffs(month, year),
          store.getMonthPrefs(month, year),
          store.getSchedule(month, year),
          store.listSwapRequests(month, year).catch(() => [] as SwapRequest[]),
        ])
        // ràng buộc ca (ưu tiên đêm, cấm ca, tối đa) là thiết lập THEO THÁNG
        const withOffs = applyMonthData(emps, prefs, dayoffs)
        // cập nhật một lượt để React vẽ đúng một lần, tránh nhấp nháy giữa các setState
        setEmployees(withOffs)
        setSettings(sets)
        setSwaps(swapList)
        // thành viên chỉ xem lịch đã chốt; bản nháp chỉ admin thấy
        setSchedule(sched && (isAdmin || sched.status === 'published') ? sched : null)
        setConflicts([])
      } finally {
        setLoading(null)
      }
    },
    [month, year, isAdmin],
  )

  useEffect(() => {
    void load('hard')
  }, [load])

  // realtime: lịch cập nhật live khi admin khác chỉnh tay — tải lại nền, giữ bảng đang hiện
  useEffect(() => {
    if (!schedule || store.mode !== 'supabase') return
    const unsubscribe = store.subscribe(schedule.id, () => {
      if (Date.now() < selfWriteUntil.current) return
      window.clearTimeout(realtimeTimer.current)
      realtimeTimer.current = window.setTimeout(() => void load('soft'), 800)
    })
    return () => {
      window.clearTimeout(realtimeTimer.current)
      unsubscribe()
    }
  }, [schedule?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // tooltip «đã đổi ca» trên 2 ô của mỗi yêu cầu đổi ca đã duyệt
  const swapTips = useMemo(
    () => swappedCellTips(swaps, (id) => employees.find((e) => e.id === id)?.name ?? '—'),
    [swaps, employees],
  )

  const matrix: ScheduleMatrix = useMemo(() => {
    if (schedule) return schedule.matrix
    return Object.fromEntries(employees.map((e) => [e.id, new Array<Shift>(D).fill('OFF')]))
  }, [schedule, employees, D])

  const violations = useMemo(
    () =>
      employees.length === 0
        ? []
        : validateMatrix({
            employees,
            matrix,
            daysInMonth: D,
            minPerShift: settings.min_per_shift,
            streakMin: settings.streak_min,
            streakMax: settings.streak_max,
            restMax: settings.rest_max,
            skipBalance: !schedule,
          }),
    [employees, matrix, D, settings, schedule],
  )
  const violationMap = useMemo(() => violationCellMap(violations, employees, matrix), [violations, employees, matrix])

  /**
   * Xếp lịch. `dayRange` = khoảng ngày cần xếp (null = cả tháng).
   * `skipConfirm` khi đã xác nhận trong popup chọn khoảng ngày.
   */
  const generate = async (
    shuffle: boolean,
    dayRange: { from: number; to: number } | null = null,
    skipConfirm = false,
  ) => {
    if (!canEdit) return
    const rangeLabel = rangeLabelOf(dayRange)
    const scope = dayRange ? ` (${rangeLabel})` : ''
    if (schedule && !skipConfirm) {
      const ok = await confirm({
        title:
          schedule.status === 'published'
            ? `Tạo lại lịch tháng ${month}/${year} đã chốt${scope}?`
            : `Tạo lại lịch tháng ${month}/${year}${scope}?`,
        message: dayRange
          ? `Chỉ ${rangeLabel} được xếp lại; các ngày còn lại giữ nguyên.${schedule.status === 'published' ? ' Lịch về trạng thái bản nháp.' : ''} Ô chỉnh tay trong khoảng này sẽ mất.`
          : schedule.status === 'published'
            ? 'Lịch đã chốt sẽ bị thay bằng phương án mới (trạng thái về bản nháp). Các ô chỉnh tay sẽ mất.'
            : 'Phương án hiện tại và các ô chỉnh tay sẽ bị thay bằng phương án mới.',
        confirmLabel: 'Tạo lại',
        danger: schedule.status === 'published',
      })
      if (!ok) return
    }
    if (shuffle) seedRef.current = Math.floor(Math.random() * 1e9)
    const result = await run({
      employees,
      month,
      year,
      daysInMonth: D,
      minPerShift: settings.min_per_shift,
      streakMin: settings.streak_min,
      streakMax: settings.streak_max,
      restMin: settings.rest_min,
      restMax: settings.rest_max,
      seed: seedRef.current,
      range: dayRange ?? undefined,
      base: dayRange ? schedule?.matrix : undefined,
    })
    setConflicts(result.conflicts)
    setSaving(true)
    markSelfWrite()
    try {
      // giữ ô chỉnh tay NGOÀI khoảng vừa xếp
      const keptManual = new Set<string>()
      if (dayRange && schedule) {
        for (const key of schedule.manual) {
          const day = Number(key.split(':')[1])
          if (day < dayRange.from || day > dayRange.to) keptManual.add(key)
        }
      }
      const saved = await store.saveSchedule({
        id: schedule?.id ?? `local-${year}-${month}`,
        month,
        year,
        status: 'draft',
        matrix: result.matrix,
        manual: keptManual,
      })
      markSelfWrite() // sự kiện realtime của lượt ghi này còn về sau khi request xong
      // hiển thị đúng những gì ĐÃ LƯU (đọc lại từ backend) — nếu lệch với kết quả solver thì báo ngay,
      // thay vì chỉ lộ ra sau khi F5
      const persisted = await store.getSchedule(month, year)
      if (persisted) {
        const diff = countMatrixDiff(result.matrix, persisted.matrix, employees, D)
        if (diff.cells > 0 || diff.missing.length > 0) {
          console.warn('[airwork-jos-shift] lịch đã lưu khác kết quả solver', diff)
          setNotice({
            tone: 'danger',
            text: `Lịch đã lưu khác kết quả vừa tạo ở ${diff.cells} ô${diff.missing.length ? `, thiếu hàng: ${diff.missing.join(', ')}` : ''} — kiểm tra quyền ghi / dữ liệu trên máy chủ.`,
          })
        }
        setSchedule(persisted)
      } else {
        setSchedule({ ...saved })
      }
      const what = dayRange ? `lịch ${rangeLabel} tháng ${month}/${year}` : `lịch tháng ${month}/${year}`
      if (result.ok) toast(`Đã tạo ${what} — đạt mọi ràng buộc.`)
      else toast(`Đã tạo ${what} nhưng còn ${result.violations.length} vi phạm — xem ô đỏ.`, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const onCellChange = async (employeeId: string, day: number, shift: Shift) => {
    if (!schedule || !canEdit) return
    const next: StoredSchedule = {
      ...schedule,
      matrix: { ...schedule.matrix, [employeeId]: [...schedule.matrix[employeeId]] },
      manual: new Set(schedule.manual),
    }
    next.matrix[employeeId][day - 1] = shift
    next.manual.add(`${employeeId}:${day}`)
    setSchedule(next)
    markSelfWrite()
    try {
      await store.setCell(next, employeeId, day, shift)
      toast(
        `Đã đổi ngày ${day} của ${employees.find((x) => x.id === employeeId)?.name ?? ''} → ${shift === 'OFF' ? 'nghỉ' : shift}.`,
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được ô.', 'danger')
    }
    markSelfWrite()
  }

  /** Sao lưu lịch tháng đang xem ra file JSON (ma trận ca + nhân viên + ô chỉnh tay). */
  const backup = () => {
    if (!schedule) return
    const data = buildBackup({
      month,
      year,
      status: schedule.status,
      employees,
      matrix: schedule.matrix,
      manual: schedule.manual,
    })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFilename(month, year)
    a.click()
    URL.revokeObjectURL(url)
    toast(`Đã sao lưu lịch tháng ${month}/${year}.`)
  }

  /** Nhập lại lịch từ file sao lưu: kiểm tra file, ghép nhân viên, xác nhận rồi ghi đè lịch tháng đó. */
  const importBackup = async (file: File) => {
    if (!canEdit) return
    setImporting(true)
    try {
      const data = parseBackup(await file.text())
      // nhân viên + ngày nghỉ/prefs của tháng trong file (có thể khác tháng đang xem)
      const [emps, prefs, offs] = await Promise.all([
        store.listEmployees(),
        store.getMonthPrefs(data.month, data.year),
        store.getDayOffs(data.month, data.year),
      ])
      const targetEmployees = applyMonthData(emps, prefs, offs)
      const plan = planRestore(data, targetEmployees)
      if (plan.matched.length === 0) throw new Error('Không có nhân viên nào trong file khớp với danh sách hiện tại.')
      const existing = await store.getSchedule(data.month, data.year)
      const notes = [
        `${plan.matched.length} nhân viên khớp.`,
        plan.missing.length ? `${plan.missing.length} người trong file không còn tồn tại, bỏ qua: ${plan.missing.map((m) => m.code || m.name).join(', ')}.` : '',
        plan.unmapped.length ? `${plan.unmapped.length} nhân viên hiện tại không có trong file, sẽ toàn OFF: ${plan.unmapped.map((e) => e.name).join(', ')}.` : '',
        existing
          ? existing.status === 'published'
            ? 'Lịch ĐÃ CHỐT của tháng này sẽ bị ghi đè và về bản nháp.'
            : 'Bản nháp hiện có của tháng này sẽ bị ghi đè.'
          : 'Tháng này chưa có lịch, sẽ tạo mới ở trạng thái bản nháp.',
      ].filter(Boolean)
      const ok = await confirm({
        title: `Nhập lại lịch tháng ${data.month}/${data.year} từ file?`,
        message: notes.join(' '),
        confirmLabel: 'Nhập lại',
        danger: existing?.status === 'published',
      })
      if (!ok) return
      markSelfWrite()
      await store.saveSchedule({
        id: existing?.id ?? `local-${data.year}-${data.month}`,
        month: data.month,
        year: data.year,
        status: 'draft',
        matrix: plan.matrix,
        manual: plan.manual,
      })
      markSelfWrite()
      if (data.month !== month || data.year !== year) {
        setMonth(data.month)
        setYear(data.year)
      } else {
        await load('soft')
      }
      setConflicts([])
      toast(`Đã nhập lại lịch tháng ${data.month}/${data.year} (bản nháp).`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không nhập được file.', 'danger')
    } finally {
      setImporting(false)
    }
  }

  const publish = async () => {
    if (!schedule || !canEdit) return
    const ok = await confirm({
      title: `Chốt lịch tháng ${month}/${year}?`,
      message:
        violations.length > 0
          ? `Lịch còn ${violations.length} vi phạm ràng buộc cứng. Chốt sẽ công bố cho toàn bộ nhân viên.`
          : 'Sau khi chốt, toàn bộ nhân viên sẽ xem được lịch này.',
      confirmLabel: 'Chốt lịch',
      danger: violations.length > 0,
    })
    if (!ok) return
    setPublishing(true)
    markSelfWrite()
    try {
      await store.publish(schedule)
      setSchedule({ ...schedule, status: 'published' })
      toast(`Đã chốt lịch tháng ${month}/${year}.`)
    } finally {
      setPublishing(false)
    }
  }

  // bỏ dấu tiếng Việt để gõ "quan" vẫn khớp "Quân"
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
  const visibleEmployees = useMemo(() => {
    const q = normalize(debouncedQuery.trim())
    let list = employees
    if (q) list = list.filter((e) => normalize(e.name).includes(q) || normalize(e.code).includes(q))
    // lọc theo ca: chỉ giữ người có ít nhất một ngày làm ca đó trong tháng
    if (shiftFilter) list = list.filter((e) => (matrix[e.id] ?? []).some((s) => s === shiftFilter))
    return list
  }, [employees, debouncedQuery, shiftFilter, matrix])
  const filtering = debouncedQuery.trim() !== '' || shiftFilter !== null

  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
  const yearOptions = [year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i)
  /** so khớp lịch solver với lịch đọc lại từ backend: số ô khác nhau + nhân viên thiếu hàng */
  const countMatrixDiff = (a: ScheduleMatrix, b: ScheduleMatrix, emps: Employee[], days: number) => {
    let cells = 0
    const missing: string[] = []
    for (const e of emps) {
      const ra = a[e.id]
      const rb = b[e.id]
      if (!rb) {
        if (ra) missing.push(e.name)
        continue
      }
      for (let d = 0; d < days; d++) if ((ra?.[d] ?? 'OFF') !== (rb[d] ?? 'OFF')) cells++
    }
    return { cells, missing }
  }

  const stepMonth = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setMonth(d.getMonth() + 1)
    setYear(d.getFullYear())
  }
  const busy = running || saving || publishing || loading === 'hard'
  const hardLoading = loading === 'hard'

  return (
    <div className="page">
      <LoadingBar active={loading !== null || running || saving || publishing || exporting} />
      <PageHeader
        title="Lịch ca"
        lede={`${D} ngày · 3 ca/ngày · ≥${perShiftLabel(settings.min_per_shift)} người/ca · đi sớm 10' handover`}
        badge={
          <>
            {schedule && (
              <span className={`badge ${schedule.status === 'published' ? 'badge-published' : 'badge-draft'}`}>
                {schedule.status === 'published' ? 'Đã chốt' : 'Bản nháp'}
              </span>
            )}
            {isPast && <span className="badge">Tháng đã qua · chỉ xem</span>}
          </>
        }
        actions={
          isAdmin && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => generate(false)}
                disabled={busy || employees.length === 0 || isPast}
                title={isPast ? 'Tháng đã qua — chỉ xem' : undefined}
                data-loading={running || undefined}
              >
                {running && <Spinner size={14} />}
                {running ? 'Đang giải…' : saving ? 'Đang lưu…' : schedule ? 'Tạo lại lịch' : 'Tạo lịch tự động'}
              </button>
              {schedule?.status === 'draft' && (
                <button
                  className="btn btn-ghost"
                  onClick={publish}
                  disabled={busy || isPast}
                  title={isPast ? 'Tháng đã qua — chỉ xem' : undefined}
                  data-loading={publishing || undefined}
                >
                  {publishing && <Spinner size={14} />}
                  {publishing ? 'Đang chốt…' : 'Chốt lịch'}
                </button>
              )}
            </>
          )
        }
      />

      <div className="toolbar">
        <div className="month-nav" role="group" aria-label="Chọn tháng">
          <button type="button" aria-label="Tháng trước" onClick={() => stepMonth(-1)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="month-label">
            Tháng {month} / {year}
          </span>
          <button type="button" aria-label="Tháng sau" onClick={() => stepMonth(1)}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <AppSelect
            inputId="month-sel"
            aria-label="Tháng"
            width="7.5rem"
            options={monthOptions.map((m) => ({ value: m, label: `Tháng ${m}` }))}
            value={month}
            onChange={setMonth}
          />
          <AppSelect
            aria-label="Năm"
            width="6rem"
            options={yearOptions.map((y) => ({ value: y, label: String(y) }))}
            value={year}
            onChange={setYear}
          />
        </div>

        {isAdmin && (
          <>
            <span className="toolbar-sep hidden sm:block" />
            <button
              className="btn btn-ghost"
              onClick={() => setRangePick([monthStart, monthEnd])}
              disabled={busy || employees.length === 0 || isPast}
              title={isPast ? 'Tháng đã qua — chỉ xem' : undefined}
            >
              Xáo phương án khác
            </button>
          </>
        )}

        <span className="toolbar-spacer" />

        <div className="btn-group" role="group" aria-label="Xuất file">
          <button
            className="btn btn-ghost"
            disabled={!schedule || exporting}
            data-loading={exporting || undefined}
            onClick={async () => {
              setExporting(true)
              try {
                const { exportXlsx } = await loadExport()
                await exportXlsx(employees, matrix, month, year, settings.min_per_shift)
              } finally {
                setExporting(false)
              }
            }}
          >
            {exporting && <Spinner size={12} />}
            Excel
          </button>
          <button
            className="btn btn-ghost"
            disabled={!schedule}
            onClick={async () => {
              const { exportCsv } = await loadExport()
              exportCsv(employees, matrix, month, year, settings.min_per_shift)
            }}
          >
            CSV
          </button>
        </div>

        <div className="btn-group" role="group" aria-label="Sao lưu / nhập lại">
          <button className="btn btn-ghost" disabled={!schedule} onClick={backup} title="Tải file JSON sao lưu lịch tháng này">
            Sao lưu
          </button>
          {isAdmin && (
            <>
              <button
                className="btn btn-ghost"
                disabled={busy || importing || isPast}
                data-loading={importing || undefined}
                onClick={() => importRef.current?.click()}
                title={isPast ? 'Tháng đã qua — chỉ xem' : 'Nhập lại lịch từ file sao lưu JSON'}
              >
                {importing && <Spinner size={12} />}
                Nhập lại
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void importBackup(f)
                }}
              />
            </>
          )}
        </div>
      </div>

      {schedule && (
        <div className="toolbar">
          <label className="search" aria-label="Tìm theo tên nhân viên">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input placeholder="Tìm tên / mã nhân viên" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </label>
          <div className="filter-chips" role="group" aria-label="Lọc theo ca">
            {(['S1', 'S2', 'S3', 'OFF'] as Shift[]).map((s) => (
              <button
                key={s}
                type="button"
                className="filter-chip"
                aria-pressed={shiftFilter === s}
                onClick={() => setShiftFilter(shiftFilter === s ? null : s)}
                title={s === 'OFF' ? 'Chỉ nổi ô nghỉ' : `Chỉ nổi ô ca ${s}`}
              >
                <span className="swatch" style={{ background: `var(--shift-${s.toLowerCase()})` }} />
                {s}
              </button>
            ))}
          </div>
          {filtering && (
            <>
              <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}>
                {visibleEmployees.length}/{employees.length} nhân viên
                {shiftFilter ? ` · chỉ nổi ô ${shiftFilter}` : ''}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setQuery('')
                  setShiftFilter(null)
                }}
              >
                Bỏ lọc
              </button>
            </>
          )}
        </div>
      )}

      {notice && (
        <div className={`alert ${notice.tone === 'ok' ? 'alert-ok' : 'alert-danger'}`} role="alert">
          {notice.text}
          <button className="link-quiet" style={{ marginLeft: 8 }} onClick={() => setNotice(null)}>
            Đóng
          </button>
        </div>
      )}

      {schedule && !hardLoading && (
        <div className="stat-strip" style={{ ['--stat-cols' as string]: 5 }}>
          {(() => {
            const totals = employees.map((e) => (matrix[e.id] ?? []).filter((s) => s !== 'OFF').length)
            const lo = totals.length ? Math.min(...totals) : 0
            const hi = totals.length ? Math.max(...totals) : 0
            const cover = WORK_SHIFTS.every((s) =>
              Array.from(
                { length: D },
                (_, d) => employees.filter((e) => matrix[e.id]?.[d] === s).length >= settings.min_per_shift[s],
              ).every(Boolean),
            )
            const manualCount = schedule.manual.size
            return (
              <>
                <div className="stat">
                  <div className="k">Nhân viên</div>
                  <div className="v">{employees.length}</div>
                </div>
                <div className="stat">
                  <div className="k">Ca / người</div>
                  <div className="v">
                    {lo === hi ? lo : `${lo}–${hi}`}
                    <small>/ {D} ngày</small>
                  </div>
                </div>
                <div className="stat" data-tone={cover ? 'ok' : 'danger'}>
                  <div className="k">Độ phủ</div>
                  <div className="v">{cover ? 'ĐỦ' : 'THIẾU'}</div>
                </div>
                <div className="stat" data-tone={violations.length === 0 ? 'ok' : 'danger'}>
                  <div className="k">Vi phạm cứng</div>
                  <div className="v">{violations.length}</div>
                </div>
                <div className="stat">
                  <div className="k">Ô chỉnh tay</div>
                  <div className="v">{manualCount}</div>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="alert alert-danger" role="alert">
          <strong>Ràng buộc xung đột — không thể xếp lịch thỏa mãn 100%:</strong>
          <ul className="m-0 mt-1 pl-5">
            {conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {hardLoading ? (
        <GridSkeleton rows={Math.max(employees.length, 6)} days={D} />
      ) : schedule ? (
        <Busy
          busy={loading === 'soft' || saving || running}
          label={running ? 'Đang xếp lịch…' : saving ? 'Đang lưu lịch…' : 'Đang cập nhật…'}
        >
          <ScheduleGrid
            employees={employees}
            matrix={matrix}
            daysInMonth={D}
            month={month}
            year={year}
            minPerShift={settings.min_per_shift}
            violationMap={violationMap}
            violations={violations}
            manual={schedule.manual}
            onCellChange={onCellChange}
            readOnly={!canEdit}
            locked={isPast}
            swapTips={swapTips}
            visibleEmployees={visibleEmployees}
            shiftFilter={shiftFilter}
          />
        </Busy>
      ) : (
        <div className="card grid place-items-center gap-2 py-16 text-center">
          <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600 }}>
            Chưa có lịch cho tháng {month}/{year}
          </p>
          <p style={{ margin: 0, color: 'var(--color-ink-2)', fontSize: 'var(--text-sm)' }}>
            {isPast
              ? 'Tháng đã qua — không tạo lịch mới cho tháng này.'
              : isAdmin
                ? 'Bấm «Tạo lịch tự động» — solver chạy nền, khoảng vài giây.'
                : 'Lịch tháng này chưa được admin chốt. Vui lòng quay lại sau.'}
          </p>
        </div>
      )}

      <div
        className="flex flex-wrap gap-x-4 gap-y-1"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)' }}
      >
        {(
          [
            ['S1', `Sáng ${settings.shift_hours.S1}`],
            ['S2', `Chiều ${settings.shift_hours.S2}`],
            ['S3', `Đêm ${settings.shift_hours.S3}`],
            ['OFF', 'Nghỉ'],
          ] as const
        ).map(([s, label]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="swatch" style={{ background: `var(--shift-${s.toLowerCase()})` }} />
            <strong>{s}</strong> {label}
          </span>
        ))}
        {canEdit && (
          <span className="flex items-center gap-1.5">
            <span
              className="relative inline-block h-3 w-3 rounded-sm"
              style={{ border: '1px solid var(--color-line-strong)' }}
            >
              <span
                className="absolute right-0 top-0 h-1 w-1 rounded-full"
                style={{ background: 'var(--color-accent)' }}
              />
            </span>
            chấm xanh = chỉnh tay · bấm vào ô để đổi ca
          </span>
        )}
      </div>

      {schedule && !hardLoading && (
        <RuleChecklist employees={employees} matrix={matrix} settings={settings} violations={violations} />
      )}

      {rangePick && (
        <RangeDialog
          value={rangePick}
          minDate={monthStart}
          maxDate={monthEnd}
          month={month}
          year={year}
          published={schedule?.status === 'published'}
          onChange={setRangePick}
          onCancel={() => setRangePick(null)}
          onConfirm={() => {
            const r = toDayRange(rangePick)
            setRangePick(null)
            void generate(true, r, true)
          }}
        />
      )}
    </div>
  )
}

/** Popup chọn khoảng ngày cần xếp lại (react-daterange-picker) — mặc định cả tháng đang xem. */
function RangeDialog({
  value,
  minDate,
  maxDate,
  month,
  year,
  published,
  onChange,
  onCancel,
  onConfirm,
}: {
  value: [Date, Date]
  minDate: Date
  maxDate: Date
  month: number
  year: number
  published: boolean
  onChange: (v: [Date, Date]) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const D = maxDate.getDate()
  const from = value[0].getDate()
  const to = value[1].getDate()
  const whole = from <= 1 && to >= D
  // lịch chỉ mở khi người dùng bấm vào ô chọn — không tự mở / tự focus lúc popup hiện ra
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  // chỉ chọn trên lịch, không gõ tay: khóa các ô dd/mm/yyyy (readOnly, bỏ khỏi tab)
  useEffect(() => {
    pickerRef.current?.querySelectorAll<HTMLInputElement>('.react-daterange-picker__inputGroup input').forEach((el) => {
      el.readOnly = true
      el.tabIndex = -1
    })
  }, [value])
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Chọn khoảng ngày cần xếp"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onCancel()
      }}
    >
      <div className="modal range-modal">
        <div className="auth-head">
          <span>xáo phương án</span>
          <span className="eyebrow">
            tháng {month}/{year}
          </span>
        </div>
        <h2 style={{ fontSize: 'var(--text-md)' }}>Chọn khoảng ngày cần xếp lại</h2>
        <div className="field" ref={pickerRef} onClick={() => setOpen(true)}>
          <span className="field-label">Khoảng ngày</span>
          <DateRangePicker
            isOpen={open}
            onCalendarOpen={() => setOpen(true)}
            onCalendarClose={() => setOpen(false)}
            value={value}
            onChange={(v) => {
              if (Array.isArray(v) && v[0] instanceof Date && v[1] instanceof Date) onChange([v[0], v[1]])
            }}
            minDate={minDate}
            maxDate={maxDate}
            locale="vi-VN"
            format="dd/MM/y"
            dayPlaceholder="dd"
            monthPlaceholder="mm"
            yearPlaceholder="yyyy"
            clearIcon={null}
            calendarIcon={<CalendarIcon />}
            rangeDivider=" → "
            calendarAriaLabel="Mở lịch"
            calendarProps={{
              prevLabel: <Chevron dir="left" />,
              nextLabel: <Chevron dir="right" />,
              prev2Label: null,
              next2Label: null,
            }}
          />
        </div>
        <p className="confirm-msg" style={{ margin: 0 }}>
          {whole
            ? 'Cả tháng sẽ được xếp lại bằng một phương án khác.'
            : `Chỉ ngày ${from}–${to} được xếp lại; các ngày còn lại giữ nguyên.`}
        </p>
        <div className="alert alert-danger" role="alert">
          Ô chỉnh tay trong khoảng này sẽ mất.
          {published && ' Lịch đã chốt sẽ về trạng thái bản nháp.'}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onCancel}>
            Hủy
          </button>
          <button className={`btn ${published ? 'btn-danger-solid' : 'btn-primary'}`} onClick={onConfirm}>
            Xáo phương án
          </button>
        </div>
      </div>
    </div>
  )
}

/* icon nét mảnh 1.6px — cùng ngôn ngữ với các icon khác của app, thay icon mặc định (nét dày) của picker */
function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  )
}
