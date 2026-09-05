import type { Employee, ScheduleMatrix, Shift } from './types'
import { daysInMonth } from './types'

/**
 * Sao lưu / nhập lại lịch tháng dưới dạng JSON.
 * File chứa ma trận ca + danh sách nhân viên (id, mã, tên) tại thời điểm sao lưu để khi nhập lại
 * vẫn ghép được với nhân viên hiện tại: ưu tiên khớp theo id, không có thì khớp theo mã nhân viên.
 */

export const BACKUP_FORMAT = 'airwork-jos-shift/schedule'
export const BACKUP_VERSION = 1

export interface ScheduleBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  month: number
  year: number
  status: 'draft' | 'published'
  employees: { id: string; code: string; name: string }[]
  /** matrix[employeeId] = chuỗi 1 ký tự/ngày: 1=S1 2=S2 3=S3 .=OFF */
  rows: Record<string, string>
  /** ô chỉnh tay: `${employeeId}:${day}` */
  manual: string[]
}

const SHIFT_TO_CHAR: Record<Shift, string> = { S1: '1', S2: '2', S3: '3', OFF: '.' }
const CHAR_TO_SHIFT: Record<string, Shift> = { '1': 'S1', '2': 'S2', '3': 'S3', '.': 'OFF' }

export function buildBackup(opts: {
  month: number
  year: number
  status: 'draft' | 'published'
  employees: Employee[]
  matrix: ScheduleMatrix
  manual: Set<string>
}): ScheduleBackup {
  const D = daysInMonth(opts.month, opts.year)
  const rows: Record<string, string> = {}
  for (const e of opts.employees) {
    const row = opts.matrix[e.id]
    if (!row) continue
    rows[e.id] = Array.from({ length: D }, (_, d) => SHIFT_TO_CHAR[row[d] ?? 'OFF']).join('')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    month: opts.month,
    year: opts.year,
    status: opts.status,
    employees: opts.employees.filter((e) => rows[e.id]).map((e) => ({ id: e.id, code: e.code, name: e.name })),
    rows,
    manual: [...opts.manual],
  }
}

export function backupFilename(month: number, year: number): string {
  return `lich-ca-${year}-${String(month).padStart(2, '0')}.backup.json`
}

/** Đọc + kiểm tra file sao lưu. Ném Error tiếng Việt nếu file không hợp lệ. */
export function parseBackup(text: string): ScheduleBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('File không phải JSON hợp lệ.')
  }
  const b = data as Partial<ScheduleBackup>
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
    throw new Error('File không phải bản sao lưu lịch của airwork-jos-shift.')
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error(`Phiên bản sao lưu ${String(b.version)} mới hơn app hiện tại — hãy cập nhật app.`)
  }
  if (typeof b.month !== 'number' || b.month < 1 || b.month > 12 || typeof b.year !== 'number') {
    throw new Error('File thiếu tháng / năm.')
  }
  if (!b.rows || typeof b.rows !== 'object' || !Array.isArray(b.employees)) {
    throw new Error('File thiếu dữ liệu lịch.')
  }
  const D = daysInMonth(b.month, b.year)
  for (const [id, row] of Object.entries(b.rows)) {
    if (typeof row !== 'string' || row.length !== D || [...row].some((c) => !(c in CHAR_TO_SHIFT))) {
      throw new Error(`Dòng lịch của nhân viên ${id} không hợp lệ (cần đúng ${D} ký tự 1/2/3/.).`)
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    month: b.month,
    year: b.year,
    status: b.status === 'published' ? 'published' : 'draft',
    employees: b.employees.map((e) => ({ id: String(e.id), code: String(e.code ?? ''), name: String(e.name ?? '') })),
    rows: b.rows as Record<string, string>,
    manual: Array.isArray(b.manual) ? b.manual.map(String) : [],
  }
}

export interface RestorePlan {
  matrix: ScheduleMatrix
  manual: Set<string>
  /** nhân viên trong file khớp được với nhân viên hiện tại */
  matched: { from: string; to: Employee }[]
  /** nhân viên trong file không còn tồn tại → bỏ qua dòng đó */
  missing: { id: string; code: string; name: string }[]
  /** nhân viên hiện tại không có trong file → hàng toàn OFF */
  unmapped: Employee[]
}

/** Ghép dữ liệu sao lưu vào danh sách nhân viên hiện tại (theo id, rồi theo mã). */
export function planRestore(backup: ScheduleBackup, employees: Employee[]): RestorePlan {
  const D = daysInMonth(backup.month, backup.year)
  const byId = new Map(employees.map((e) => [e.id, e]))
  const byCode = new Map(employees.map((e) => [e.code.trim().toLowerCase(), e]))
  const matrix: ScheduleMatrix = Object.fromEntries(employees.map((e) => [e.id, new Array<Shift>(D).fill('OFF')]))
  const manual = new Set<string>()
  const matched: RestorePlan['matched'] = []
  const missing: RestorePlan['missing'] = []
  const used = new Set<string>()

  for (const src of backup.employees) {
    const target = byId.get(src.id) ?? byCode.get(src.code.trim().toLowerCase())
    const row = backup.rows[src.id]
    if (!target || !row || used.has(target.id)) {
      missing.push(src)
      continue
    }
    used.add(target.id)
    matrix[target.id] = [...row].map((c) => CHAR_TO_SHIFT[c] ?? 'OFF')
    matched.push({ from: src.id, to: target })
    for (const key of backup.manual) {
      const [id, day] = key.split(':')
      if (id === src.id && day) manual.add(`${target.id}:${day}`)
    }
  }
  const unmapped = employees.filter((e) => !used.has(e.id))
  return { matrix, manual, matched, missing, unmapped }
}
