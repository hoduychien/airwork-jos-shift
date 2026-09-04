import { supabase, isLocalMode } from './supabase'
import { SEED_EMPLOYEES, SEED_SCHEDULE_10_2026, decodeScheduleRow } from './seed'
import type { Employee, EmployeePrefs, ScheduleMatrix, Settings, Shift } from './types'
import { DEFAULT_SETTINGS, daysInMonth } from './types'

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
}

// ---------------- Local (demo) ----------------
const LS = {
  employees: 'shift.employees',
  settings: 'shift.settings',
  seedVersion: 'shift.seedVersion',
  dayoffs: (m: number, y: number) => `shift.dayoffs.${y}-${m}`,
  prefs: (m: number, y: number) => `shift.prefs.${y}-${m}`,
  schedule: (m: number, y: number) => `shift.schedule.${y}-${m}`,
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
    return { ...DEFAULT_SETTINGS, ...lsGet<Partial<Settings>>(LS.settings, {}) }
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
    return { ...DEFAULT_SETTINGS, ...(map['app'] as Partial<Settings> | undefined) }
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
}

export const store: Store = isLocalMode ? new LocalStore() : new SupabaseStore()
