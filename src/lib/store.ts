import { supabase, isLocalMode } from './supabase'
import { SEED_EMPLOYEES, SEED_SCHEDULE_10_2026, decodeScheduleRow } from './seed'
import type { Employee, EmployeePrefs, ScheduleMatrix, Settings, Shift } from './types'
import { daysInMonth, normalizeSettings } from './types'
import { mergeDaysOff, type LeaveRequest, type LeaveStatus } from './leave'
import { applySwap, describeCell, overallStatus, type Decision, type Notification, type SwapRequest } from './swap'
import { listAccounts } from './auth'

/**
 * Data layer trừu tượng: SupabaseStore khi có cấu hình, LocalStore (localStorage)
 * cho chế độ demo. Cùng một interface nên UI không cần biết backend nào.
 */

export interface StoredSchedule {
  id: string
  month: number
  year: number
  status: 'draft' | 'published'
  matrix: ScheduleMatrix
  manual: Set<string> // `${employeeId}:${day}`
}

export interface Store {
  readonly mode: 'local' | 'supabase'
  listEmployees(): Promise<Employee[]>
  upsertEmployee(e: Employee): Promise<void>
  deleteEmployee(id: string): Promise<void>
  saveOrder(ids: string[]): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<void>
  getDayOffs(month: number, year: number): Promise<Record<string, number[]>>
  saveDayOffs(employeeId: string, month: number, year: number, days: number[]): Promise<void>
  /** thiết lập ràng buộc ca theo tháng (chỉ những người đã cấu hình riêng cho tháng đó) */
  getMonthPrefs(month: number, year: number): Promise<Record<string, EmployeePrefs>>
  saveMonthPrefs(employeeId: string, month: number, year: number, prefs: EmployeePrefs): Promise<void>
  clearMonthPrefs(employeeId: string, month: number, year: number): Promise<void>
  getSchedule(month: number, year: number): Promise<StoredSchedule | null>
  saveSchedule(s: StoredSchedule): Promise<StoredSchedule>
  setCell(s: StoredSchedule, employeeId: string, day: number, shift: Shift): Promise<void>
  publish(s: StoredSchedule): Promise<void>
  /** realtime: gọi cb khi lịch bị sửa từ nơi khác. Trả về hàm unsubscribe. */
  subscribe(scheduleId: string, cb: () => void): () => void
  // ---- xin nghỉ ----
  listLeaveRequests(month: number, year: number): Promise<LeaveRequest[]>
  createLeaveRequest(input: Pick<LeaveRequest, 'employee_id' | 'month' | 'year' | 'days' | 'reason'>): Promise<LeaveRequest>
  /** người gửi rút lại yêu cầu khi còn chờ duyệt */
  cancelLeaveRequest(id: string): Promise<void>
  /** PM/admin duyệt hoặc từ chối; duyệt → gộp các ngày vào ngày nghỉ cố định của tháng đó */
  decideLeaveRequest(id: string, status: Exclude<LeaveStatus, 'pending'>, note?: string): Promise<void>
  // ---- đổi ca ----
  listSwapRequests(month: number, year: number): Promise<SwapRequest[]>
  /** tạo yêu cầu; store tự gửi thông báo tới đồng nghiệp và PM/admin */
  createSwapRequest(input: SwapInput): Promise<SwapRequest>
  cancelSwapRequest(id: string): Promise<void>
  /**
   * đồng nghiệp (side = 'peer') hoặc PM/admin (side = 'pm') quyết định.
   * Đủ 2 bên đồng ý → đổi 2 ô trên lịch, đánh dấu chỉnh tay, trạng thái 'approved'.
   */
  decideSwapRequest(id: string, side: 'peer' | 'pm', status: Exclude<Decision, 'pending'>, note?: string): Promise<void>
  // ---- thông báo ----
  listNotifications(userId: string): Promise<Notification[]>
  markNotificationsRead(userId: string, ids?: string[]): Promise<void>
}

export type SwapInput = Pick<
  SwapRequest,
  'month' | 'year' | 'requester_id' | 'requester_day' | 'requester_shift' | 'partner_id' | 'partner_day' | 'partner_shift' | 'note'
>

// ---------------- Local (demo) ----------------
const LS = {
  employees: 'shift.employees',
  settings: 'shift.settings',
  seedVersion: 'shift.seedVersion',
  dayoffs: (m: number, y: number) => `shift.dayoffs.${y}-${m}`,
  prefs: (m: number, y: number) => `shift.prefs.${y}-${m}`,
  schedule: (m: number, y: number) => `shift.schedule.${y}-${m}`,
  leave: 'shift.leave',
  swaps: 'shift.swaps',
  notifications: 'shift.notifications',
}

/** Tăng số này khi seed thay đổi — localStorage cũ sẽ được ghi đè bằng seed mới. */
const SEED_VERSION = 2

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

class LocalStore implements Store {
  readonly mode = 'local' as const

  constructor() {
    this.ensureSeed()
  }

  /** Nạp seed (nhân viên + lịch tháng 10/2026 chốt) khi lần đầu chạy hoặc seed đổi phiên bản. */
  private ensureSeed() {
    if (lsGet<number>(LS.seedVersion, 0) >= SEED_VERSION) return
    lsSet(LS.employees, SEED_EMPLOYEES)
    const { month, year, status, rows } = SEED_SCHEDULE_10_2026
    const matrix = Object.fromEntries(Object.entries(rows).map(([empId, enc]) => [empId, decodeScheduleRow(enc)]))
    lsSet(LS.schedule(month, year), {
      id: `local-${year}-${month}`,
      status,
      matrix,
      manual: [],
    })
    lsSet(LS.seedVersion, SEED_VERSION)
  }

  async listEmployees(): Promise<Employee[]> {
    const list = lsGet<Employee[] | null>(LS.employees, null)
    if (list) return list.sort((a, b) => a.display_order - b.display_order)
    lsSet(LS.employees, SEED_EMPLOYEES)
    return SEED_EMPLOYEES
  }
  async upsertEmployee(e: Employee) {
    const list = await this.listEmployees()
    const i = list.findIndex((x) => x.id === e.id)
    if (i >= 0) list[i] = e
    else list.push(e)
    lsSet(LS.employees, list)
  }
  async deleteEmployee(id: string) {
    lsSet(
      LS.employees,
      (await this.listEmployees()).filter((x) => x.id !== id),
    )
  }
  async saveOrder(ids: string[]) {
    const list = await this.listEmployees()
    ids.forEach((id, i) => {
      const e = list.find((x) => x.id === id)
      if (e) e.display_order = i + 1
    })
    lsSet(LS.employees, list)
  }
  async getSettings() {
    // merge default để settings cũ trong localStorage không thiếu field mới
    return normalizeSettings(lsGet<Partial<Settings>>(LS.settings, {}))
  }
  async saveSettings(s: Settings) {
    lsSet(LS.settings, s)
  }
  async getDayOffs(month: number, year: number) {
    return lsGet<Record<string, number[]>>(LS.dayoffs(month, year), {})
  }
  async saveDayOffs(employeeId: string, month: number, year: number, days: number[]) {
    const all = await this.getDayOffs(month, year)
    all[employeeId] = days
    lsSet(LS.dayoffs(month, year), all)
  }
  async getMonthPrefs(month: number, year: number) {
    return lsGet<Record<string, EmployeePrefs>>(LS.prefs(month, year), {})
  }
  async saveMonthPrefs(employeeId: string, month: number, year: number, prefs: EmployeePrefs) {
    const all = await this.getMonthPrefs(month, year)
    all[employeeId] = prefs
    lsSet(LS.prefs(month, year), all)
  }
  async clearMonthPrefs(employeeId: string, month: number, year: number) {
    const all = await this.getMonthPrefs(month, year)
    delete all[employeeId]
    lsSet(LS.prefs(month, year), all)
  }
  async getSchedule(month: number, year: number): Promise<StoredSchedule | null> {
    const raw = lsGet<{ id: string; status: 'draft' | 'published'; matrix: ScheduleMatrix; manual: string[] } | null>(
      LS.schedule(month, year),
      null,
    )
    if (!raw) return null
    return { id: raw.id, month, year, status: raw.status, matrix: raw.matrix, manual: new Set(raw.manual) }
  }
  async saveSchedule(s: StoredSchedule) {
    lsSet(LS.schedule(s.month, s.year), {
      id: s.id,
      status: s.status,
      matrix: s.matrix,
      manual: [...s.manual],
    })
    return s
  }
  async setCell(s: StoredSchedule, employeeId: string, day: number, shift: Shift) {
    s.matrix[employeeId][day - 1] = shift
    s.manual.add(`${employeeId}:${day}`)
    await this.saveSchedule(s)
  }
  async publish(s: StoredSchedule) {
    s.status = 'published'
    await this.saveSchedule(s)
  }
  subscribe() {
    return () => {}
  }

  private allLeave(): LeaveRequest[] {
    return lsGet<LeaveRequest[]>(LS.leave, [])
  }
  async listLeaveRequests(month: number, year: number) {
    return this.allLeave().filter((r) => r.month === month && r.year === year)
  }
  async createLeaveRequest(input: Pick<LeaveRequest, 'employee_id' | 'month' | 'year' | 'days' | 'reason'>) {
    const req: LeaveRequest = {
      ...input,
      id: `leave-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    lsSet(LS.leave, [...this.allLeave(), req])
    return req
  }
  async cancelLeaveRequest(id: string) {
    const all = this.allLeave()
    const r = all.find((x) => x.id === id)
    if (!r) throw new Error('Yêu cầu không tồn tại.')
    if (r.status !== 'pending') throw new Error('Yêu cầu đã được xử lý, không rút lại được.')
    lsSet(LS.leave, all.filter((x) => x.id !== id))
  }
  async decideLeaveRequest(id: string, status: Exclude<LeaveStatus, 'pending'>, note?: string) {
    const all = this.allLeave()
    const r = all.find((x) => x.id === id)
    if (!r) throw new Error('Yêu cầu không tồn tại.')
    if (r.status !== 'pending') throw new Error('Yêu cầu đã được xử lý trước đó.')
    r.status = status
    r.decided_at = new Date().toISOString()
    r.decision_note = note?.trim() || null
    lsSet(LS.leave, all)
    if (status === 'approved') {
      const offs = await this.getDayOffs(r.month, r.year)
      await this.saveDayOffs(r.employee_id, r.month, r.year, mergeDaysOff(offs[r.employee_id] ?? [], r.days))
    }
  }

  // ---- đổi ca (demo) ----
  private allSwaps(): SwapRequest[] {
    return lsGet<SwapRequest[]>(LS.swaps, [])
  }
  private allNotifications(): Notification[] {
    return lsGet<Notification[]>(LS.notifications, [])
  }
  /** ghi thông báo cho danh sách username (bỏ trùng) */
  private async notify(userIds: string[], title: string, body: string, link: string) {
    const ids = [...new Set(userIds.filter(Boolean))]
    if (ids.length === 0) return
    const now = new Date().toISOString()
    const items: Notification[] = ids.map((user_id) => ({
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id,
      title,
      body,
      link,
      read: false,
      created_at: now,
    }))
    lsSet(LS.notifications, [...items, ...this.allNotifications()].slice(0, 500))
  }
  /** username của tài khoản gắn với nhân viên, và (tuỳ chọn) của mọi admin/PM */
  private async recipients(employeeIds: string[], includeManagers: boolean): Promise<string[]> {
    const accounts = await listAccounts()
    const out: string[] = []
    for (const a of accounts) {
      if (a.employeeId && employeeIds.includes(a.employeeId)) out.push(a.username)
      else if (includeManagers && (a.role === 'admin' || a.role === 'pm')) out.push(a.username)
    }
    return out
  }
  private async empName(id: string): Promise<string> {
    return (await this.listEmployees()).find((e) => e.id === id)?.name ?? id
  }
  async listSwapRequests(month: number, year: number) {
    return this.allSwaps().filter((r) => r.month === month && r.year === year)
  }
  async createSwapRequest(input: SwapInput) {
    const req: SwapRequest = {
      ...input,
      id: `swap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      peer_status: 'pending',
      pm_status: 'pending',
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    lsSet(LS.swaps, [...this.allSwaps(), req])
    const [a, b] = await Promise.all([this.empName(req.requester_id), this.empName(req.partner_id)])
    const body = `${describeCell(req.requester_day, req.requester_shift)} của ${a} ↔ ${describeCell(req.partner_day, req.partner_shift)} của ${b}`
    await this.notify(await this.recipients([req.partner_id], false), `${a} đề nghị đổi ca với bạn`, body, '/doi-ca')
    await this.notify(await this.recipients([], true), `${a} đề nghị đổi ca với ${b}`, `${body} — cần PM duyệt.`, '/doi-ca')
    return req
  }
  async cancelSwapRequest(id: string) {
    const all = this.allSwaps()
    const r = all.find((x) => x.id === id)
    if (!r) throw new Error('Yêu cầu không tồn tại.')
    if (r.status !== 'pending') throw new Error('Yêu cầu đã được xử lý, không rút lại được.')
    r.status = 'cancelled'
    lsSet(LS.swaps, all)
    const a = await this.empName(r.requester_id)
    await this.notify(
      await this.recipients([r.partner_id], true),
      `${a} đã rút yêu cầu đổi ca`,
      `${describeCell(r.requester_day, r.requester_shift)} ↔ ${describeCell(r.partner_day, r.partner_shift)}`,
      '/doi-ca',
    )
  }
  async decideSwapRequest(id: string, side: 'peer' | 'pm', status: Exclude<Decision, 'pending'>, note?: string) {
    const all = this.allSwaps()
    const r = all.find((x) => x.id === id)
    if (!r) throw new Error('Yêu cầu không tồn tại.')
    if (r.status !== 'pending') throw new Error('Yêu cầu đã được xử lý trước đó.')
    const now = new Date().toISOString()
    if (side === 'peer') {
      if (r.peer_status !== 'pending') throw new Error('Đồng nghiệp đã trả lời rồi.')
      r.peer_status = status
      r.peer_decided_at = now
    } else {
      if (r.pm_status !== 'pending') throw new Error('PM đã quyết định rồi.')
      r.pm_status = status
      r.pm_decided_at = now
    }
    if (note?.trim()) r.decision_note = note.trim()
    r.status = overallStatus(r.peer_status, r.pm_status)
    if (r.status === 'approved') {
      const sched = await this.getSchedule(r.month, r.year)
      if (!sched) throw new Error('Không tìm thấy lịch tháng này.')
      sched.matrix = applySwap(sched.matrix, r)
      sched.manual.add(`${r.requester_id}:${r.requester_day}`)
      sched.manual.add(`${r.partner_id}:${r.partner_day}`)
      await this.saveSchedule(sched)
      r.applied_at = now
    }
    lsSet(LS.swaps, all)

    const [a, b] = await Promise.all([this.empName(r.requester_id), this.empName(r.partner_id)])
    const pair = `${describeCell(r.requester_day, r.requester_shift)} của ${a} ↔ ${describeCell(r.partner_day, r.partner_shift)} của ${b}`
    if (r.status === 'approved') {
      await this.notify(await this.recipients([r.requester_id, r.partner_id], true), 'Đổi ca đã được duyệt — lịch đã cập nhật', pair, '/')
    } else if (r.status === 'rejected') {
      const who = side === 'peer' ? b : 'PM'
      await this.notify(await this.recipients([r.requester_id, r.partner_id], true), `${who} từ chối đổi ca`, pair, '/doi-ca')
    } else if (side === 'peer') {
      await this.notify(await this.recipients([r.requester_id], true), `${b} đã đồng ý đổi ca — chờ PM duyệt`, pair, '/doi-ca')
    } else {
      await this.notify(await this.recipients([r.requester_id, r.partner_id], false), `PM đã duyệt — chờ ${b} đồng ý`, pair, '/doi-ca')
    }
  }
  async listNotifications(userId: string) {
    return this.allNotifications().filter((n) => n.user_id === userId)
  }
  async markNotificationsRead(userId: string, ids?: string[]) {
    const all = this.allNotifications()
    for (const n of all) if (n.user_id === userId && (!ids || ids.includes(n.id))) n.read = true
    lsSet(LS.notifications, all)
  }
}

// ---------------- Supabase ----------------
interface EmployeeRow {
  id: string
  name: string
  code: string
  display_order: number
  prefer_night: boolean
  min_night_shifts: number
  no_s1: boolean
  no_s2: boolean
  no_s3: boolean
  max_shifts_per_month: number
  active: boolean
}

class SupabaseStore implements Store {
  readonly mode = 'supabase' as const
  private sb = supabase!

  async listEmployees(): Promise<Employee[]> {
    const { data, error } = await this.sb.from('employees').select('*').eq('active', true).order('display_order')
    if (error) throw error
    return (data as EmployeeRow[]).map((r) => ({ ...r, days_off: [] }))
  }
  async upsertEmployee(e: Employee) {
    const { days_off: _ignored, ...row } = e
    const { error } = await this.sb.from('employees').upsert(row)
    if (error) throw error
  }
  async deleteEmployee(id: string) {
    const { error } = await this.sb.from('employees').update({ active: false }).eq('id', id)
    if (error) throw error
  }
  async saveOrder(ids: string[]) {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await this.sb
        .from('employees')
        .update({ display_order: i + 1 })
        .eq('id', ids[i])
      if (error) throw error
    }
  }
  async getSettings(): Promise<Settings> {
    const { data, error } = await this.sb.from('settings').select('key, value')
    if (error) throw error
    const map = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]))
    return normalizeSettings(map['app'] as Partial<Settings> | undefined)
  }
  async saveSettings(s: Settings) {
    const { error } = await this.sb.from('settings').upsert({ key: 'app', value: s }, { onConflict: 'key' })
    if (error) throw error
  }
  async getDayOffs(month: number, year: number) {
    const { data, error } = await this.sb
      .from('day_off_requests')
      .select('employee_id, day')
      .eq('month', month)
      .eq('year', year)
    if (error) throw error
    const out: Record<string, number[]> = {}
    for (const r of data as { employee_id: string; day: number }[]) {
      ;(out[r.employee_id] ??= []).push(r.day)
    }
    return out
  }
  async saveDayOffs(employeeId: string, month: number, year: number, days: number[]) {
    const del = await this.sb
      .from('day_off_requests')
      .delete()
      .eq('employee_id', employeeId)
      .eq('month', month)
      .eq('year', year)
    if (del.error) throw del.error
    if (days.length > 0) {
      const { error } = await this.sb
        .from('day_off_requests')
        .insert(days.map((day) => ({ employee_id: employeeId, month, year, day })))
      if (error) throw error
    }
  }
  async getMonthPrefs(month: number, year: number) {
    const { data, error } = await this.sb
      .from('employee_month_settings')
      .select('employee_id, prefer_night, min_night_shifts, no_s1, no_s2, no_s3, max_shifts_per_month')
      .eq('month', month)
      .eq('year', year)
    if (error) throw error
    const out: Record<string, EmployeePrefs> = {}
    for (const r of (data ?? []) as ({ employee_id: string } & EmployeePrefs)[]) {
      const { employee_id, ...prefs } = r
      out[employee_id] = prefs
    }
    return out
  }
  async saveMonthPrefs(employeeId: string, month: number, year: number, prefs: EmployeePrefs) {
    const { error } = await this.sb
      .from('employee_month_settings')
      .upsert(
        { employee_id: employeeId, month, year, ...prefs, updated_at: new Date().toISOString() },
        { onConflict: 'employee_id,month,year' },
      )
    if (error) throw error
  }
  async clearMonthPrefs(employeeId: string, month: number, year: number) {
    const { error } = await this.sb
      .from('employee_month_settings')
      .delete()
      .eq('employee_id', employeeId)
      .eq('month', month)
      .eq('year', year)
    if (error) throw error
  }
  async getSchedule(month: number, year: number): Promise<StoredSchedule | null> {
    const { data: sched, error } = await this.sb
      .from('schedules')
      .select('*')
      .eq('month', month)
      .eq('year', year)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!sched) return null
    // PostgREST mặc định cắt ở 1000 dòng — nêu rõ khoảng để không mất ô khi team đông
    const { data: cells, error: e2 } = await this.sb
      .from('shift_assignments')
      .select('employee_id, day, shift, is_manual_override')
      .eq('schedule_id', sched.id)
      .range(0, 49999)
    if (e2) throw e2
    const D = daysInMonth(month, year)
    const matrix: ScheduleMatrix = {}
    const manual = new Set<string>()
    for (const c of cells as { employee_id: string; day: number; shift: Shift; is_manual_override: boolean }[]) {
      matrix[c.employee_id] ??= new Array<Shift>(D).fill('OFF')
      matrix[c.employee_id][c.day - 1] = c.shift
      if (c.is_manual_override) manual.add(`${c.employee_id}:${c.day}`)
    }
    return { id: sched.id, month, year, status: sched.status, matrix, manual }
  }
  async saveSchedule(s: StoredSchedule): Promise<StoredSchedule> {
    let id = s.id
    if (!id || id.startsWith('local')) {
      const { data: auth } = await this.sb.auth.getUser()
      const { data, error } = await this.sb
        .from('schedules')
        .insert({ month: s.month, year: s.year, status: s.status, created_by: auth.user?.id })
        .select()
        .single()
      if (error) throw error
      id = data.id
    }
    const D = daysInMonth(s.month, s.year)
    const rows = Object.entries(s.matrix).flatMap(([employee_id, row]) =>
      Array.from({ length: D }, (_, d) => ({
        schedule_id: id,
        employee_id,
        day: d + 1,
        shift: row[d],
        is_manual_override: s.manual.has(`${employee_id}:${d + 1}`),
      })),
    )
    const { error } = await this.sb
      .from('shift_assignments')
      .upsert(rows, { onConflict: 'schedule_id,employee_id,day' })
    if (error) throw error
    // dọn ô của nhân viên không còn trong lịch (đã xóa / vô hiệu) để đọc lại không lẫn dữ liệu cũ
    const keep = Object.keys(s.matrix)
    if (keep.length > 0) {
      const { error: e3 } = await this.sb
        .from('shift_assignments')
        .delete()
        .eq('schedule_id', id)
        .not('employee_id', 'in', `(${keep.join(',')})`)
      if (e3) throw e3
    }
    return { ...s, id }
  }
  async setCell(s: StoredSchedule, employeeId: string, day: number, shift: Shift) {
    s.matrix[employeeId][day - 1] = shift
    s.manual.add(`${employeeId}:${day}`)
    const { error } = await this.sb.from('shift_assignments').upsert(
      {
        schedule_id: s.id,
        employee_id: employeeId,
        day,
        shift,
        is_manual_override: true,
      },
      { onConflict: 'schedule_id,employee_id,day' },
    )
    if (error) throw error
  }
  async publish(s: StoredSchedule) {
    s.status = 'published'
    const { error } = await this.sb.from('schedules').update({ status: 'published' }).eq('id', s.id)
    if (error) throw error
  }
  subscribe(scheduleId: string, cb: () => void): () => void {
    const channel = this.sb
      .channel(`assignments-${scheduleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_assignments', filter: `schedule_id=eq.${scheduleId}` },
        cb,
      )
      .subscribe()
    return () => {
      void this.sb.removeChannel(channel)
    }
  }

  async listLeaveRequests(month: number, year: number) {
    const { data, error } = await this.sb
      .from('leave_requests')
      .select('id, employee_id, month, year, days, reason, status, created_at, decided_at, decision_note')
      .eq('month', month)
      .eq('year', year)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as LeaveRequest[]
  }
  async createLeaveRequest(input: Pick<LeaveRequest, 'employee_id' | 'month' | 'year' | 'days' | 'reason'>) {
    const { data, error } = await this.sb
      .from('leave_requests')
      .insert({ ...input, status: 'pending' })
      .select('id, employee_id, month, year, days, reason, status, created_at, decided_at, decision_note')
      .single()
    if (error) throw error
    return data as LeaveRequest
  }
  async cancelLeaveRequest(id: string) {
    const { error } = await this.sb.from('leave_requests').delete().eq('id', id).eq('status', 'pending')
    if (error) throw error
  }
  async decideLeaveRequest(id: string, status: Exclude<LeaveStatus, 'pending'>, note?: string) {
    // RPC security definer: đổi trạng thái + gộp vào day_off_requests trong một transaction
    const { error } = await this.sb.rpc('decide_leave_request', {
      p_id: id,
      p_status: status,
      p_note: note?.trim() || null,
    })
    if (error) throw error
  }

  async listSwapRequests(month: number, year: number) {
    const { data, error } = await this.sb
      .from('shift_swap_requests')
      .select('*')
      .eq('month', month)
      .eq('year', year)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as SwapRequest[]
  }
  async createSwapRequest(input: SwapInput) {
    // trigger trong DB gửi thông báo cho đồng nghiệp + admin/PM
    const { data, error } = await this.sb.from('shift_swap_requests').insert(input).select('*').single()
    if (error) throw error
    return data as SwapRequest
  }
  async cancelSwapRequest(id: string) {
    const { error } = await this.sb.rpc('cancel_swap_request', { p_id: id })
    if (error) throw error
  }
  async decideSwapRequest(id: string, side: 'peer' | 'pm', status: Exclude<Decision, 'pending'>, note?: string) {
    // RPC security definer: cập nhật quyết định, đủ 2 bên → đổi ô trên shift_assignments + thông báo
    const { error } = await this.sb.rpc('decide_swap_request', {
      p_id: id,
      p_side: side,
      p_status: status,
      p_note: note?.trim() || null,
    })
    if (error) throw error
  }
  async listNotifications(userId: string) {
    const { data, error } = await this.sb
      .from('notifications')
      .select('id, user_id, title, body, link, read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return (data ?? []) as Notification[]
  }
  async markNotificationsRead(userId: string, ids?: string[]) {
    let q = this.sb.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    if (ids) q = q.in('id', ids)
    const { error } = await q
    if (error) throw error
  }
}

export const store: Store = isLocalMode ? new LocalStore() : new SupabaseStore()
