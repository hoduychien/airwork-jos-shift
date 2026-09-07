export type Shift = 'S1' | 'S2' | 'S3' | 'OFF'

export const WORK_SHIFTS = ['S1', 'S2', 'S3'] as const
export type WorkShift = (typeof WORK_SHIFTS)[number]

export interface Employee {
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
  /** ngày nghỉ cố định đăng ký cho tháng đang xem (1-based) */
  days_off: number[]
}

/** Thiết lập ràng buộc ca THEO THÁNG — tháng chưa cấu hình dùng giá trị mặc định trên hồ sơ */
export interface EmployeePrefs {
  prefer_night: boolean
  min_night_shifts: number
  no_s1: boolean
  no_s2: boolean
  no_s3: boolean
  max_shifts_per_month: number
}
export const PREF_KEYS = [
  'prefer_night',
  'min_night_shifts',
  'no_s1',
  'no_s2',
  'no_s3',
  'max_shifts_per_month',
] as const

export function prefsOf(e: Employee | EmployeePrefs): EmployeePrefs {
  return {
    prefer_night: e.prefer_night,
    min_night_shifts: e.min_night_shifts,
    no_s1: e.no_s1,
    no_s2: e.no_s2,
    no_s3: e.no_s3,
    max_shifts_per_month: e.max_shifts_per_month,
  }
}

/** ghép thiết lập tháng (nếu có) và ngày nghỉ của tháng vào danh sách nhân viên */
export function applyMonthData(
  employees: Employee[],
  prefs: Record<string, EmployeePrefs>,
  dayoffs: Record<string, number[]>,
): Employee[] {
  return employees.map((e) => ({ ...e, ...(prefs[e.id] ?? {}), days_off: dayoffs[e.id] ?? [] }))
}

/** số người cần có ở mỗi ca (S1/S2/S3) */
export type PerShift = Record<WorkShift, number>

export const DEFAULT_PER_SHIFT: PerShift = { S1: 2, S2: 2, S3: 2 }

/** tổng số người cần đi làm mỗi ngày = S1 + S2 + S3 */
export const needPerDay = (n: PerShift): number => n.S1 + n.S2 + n.S3

/** mức tối thiểu chung cho mọi ca — dùng để chuyển dữ liệu cũ (1 số) sang từng ca */
export const perShiftOf = (v: unknown): PerShift => {
  if (typeof v === 'number') return { S1: v, S2: v, S3: v }
  const o = (v ?? {}) as Partial<PerShift>
  const num = (x: unknown, dflt: number) => (typeof x === 'number' && x >= 0 ? x : dflt)
  return {
    S1: num(o.S1, DEFAULT_PER_SHIFT.S1),
    S2: num(o.S2, DEFAULT_PER_SHIFT.S2),
    S3: num(o.S3, DEFAULT_PER_SHIFT.S3),
  }
}

/** mô tả ngắn: "3 · 3 · 2" hoặc "2" nếu 3 ca bằng nhau */
export const perShiftLabel = (n: PerShift): string =>
  n.S1 === n.S2 && n.S2 === n.S3 ? String(n.S1) : `${n.S1}/${n.S2}/${n.S3}`

export interface Settings {
  /** số người tối thiểu mỗi ca — cài đặt cũ lưu 1 số, được chuyển qua perShiftOf khi đọc */
  min_per_shift: PerShift
  shift_hours: { S1: string; S2: string; S3: string }
  streak_min: number
  streak_max: number
  rest_min: number
  rest_max: number
}

export const DEFAULT_SETTINGS: Settings = {
  min_per_shift: { ...DEFAULT_PER_SHIFT },
  shift_hours: { S1: '6:00 – 14:00', S2: '14:00 – 22:00', S3: '22:00 – 6:00' },
  streak_min: 2,
  streak_max: 5,
  rest_min: 1,
  rest_max: 2,
}

/** chuẩn hóa settings đọc từ storage (dữ liệu cũ lưu min_per_shift là 1 số) */
export function normalizeSettings(raw: Partial<Settings> | undefined | null): Settings {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    min_per_shift: perShiftOf(r.min_per_shift),
    shift_hours: { ...DEFAULT_SETTINGS.shift_hours, ...((r.shift_hours as Settings['shift_hours']) ?? {}) },
  }
}

export interface Schedule {
  id: string
  month: number
  year: number
  status: 'draft' | 'published'
  min_per_shift: number
  created_at: string
}

/** matrix[employeeId][day-1] = Shift */
export type ScheduleMatrix = Record<string, Shift[]>

export interface CellOverride {
  employee_id: string
  day: number
  is_manual_override: boolean
}

export interface Violation {
  type:
    | 'coverage'
    | 'adjacent-switch'
    | 'streak-too-long'
    | 'streak-too-short'
    | 'off-too-long'
    | 'pref-no-shift'
    | 'pref-day-off'
    | 'max-shifts'
    | 'min-night'
    | 'balance'
  message: string
  employee_id?: string
  /** 1-based day the violation anchors to */
  day?: number
  shift?: Shift
}

export interface SolverInput {
  employees: Employee[]
  month: number
  year: number
  daysInMonth: number
  /** số người cần có ở từng ca, mỗi ngày */
  minPerShift: PerShift
  streakMin: number
  streakMax: number
  restMin: number
  restMax: number
  seed: number
  /**
   * Chỉ xếp lịch trong khoảng ngày [from..to] (1-based, gồm cả 2 đầu).
   * Ngày ngoài khoảng giữ nguyên theo `base` (lịch hiện có) hoặc OFF nếu chưa có lịch.
   */
  range?: { from: number; to: number }
  /** lịch hiện có — dùng để giữ các ngày ngoài `range` */
  base?: ScheduleMatrix
}

export interface SolverResult {
  ok: boolean
  matrix: ScheduleMatrix
  violations: Violation[]
  /** thông điệp chẩn đoán khi bài toán vô nghiệm */
  conflicts: string[]
}

export const SHIFT_LABELS: Record<Shift, string> = {
  S1: 'S1 · Ca sáng',
  S2: 'S2 · Ca chiều',
  S3: 'S3 · Ca đêm',
  OFF: 'OFF · Nghỉ',
}

export const WEEKDAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const WEEKDAY_FULL_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

/** 0 = CN ... 6 = T7 */
export function weekdayOf(day: number, month: number, year: number): number {
  return new Date(year, month - 1, day).getDay()
}

/** tháng đã qua (trước tháng hiện tại) → lịch chỉ xem, khóa mọi thao tác ghi */
export function isPastMonth(month: number, year: number, today: Date = new Date()): boolean {
  return year * 12 + month < today.getFullYear() * 12 + today.getMonth() + 1
}
