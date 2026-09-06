/**
 * Xin nghỉ (leave request) — quy tắc thuần, không phụ thuộc store/UI.
 *
 * - Chỉ nhận xin nghỉ cho THÁNG SAU (tháng kế tiếp tháng hiện tại). Tháng này đã có lịch,
 *   muốn nghỉ thì đi đường «Đổi ca».
 * - PM/admin duyệt → các ngày được duyệt gộp vào ngày nghỉ cố định của tháng đó
 *   (bảng day_off_requests), solver tự tôn trọng khi «Tạo lịch tự động».
 */

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: string
  employee_id: string
  month: number
  year: number
  /** ngày 1-based, đã sắp xếp tăng dần */
  days: number[]
  reason: string
  status: LeaveStatus
  created_at: string
  decided_at?: string | null
  decision_note?: string | null
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
}

export interface MonthRef {
  month: number
  year: number
}

/** tháng kế tiếp của `today` — tháng duy nhất được mở xin nghỉ */
export function leaveTarget(today: Date = new Date()): MonthRef {
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 1)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const d = new Date(ref.year, ref.month - 1 + delta, 1)
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.month === b.month && a.year === b.year
}

export type LeaveMonthState = 'past' | 'current' | 'open' | 'future'

/**
 * Trạng thái của một tháng đối với xin nghỉ:
 *  - current: tháng này → không nhận xin nghỉ, hướng sang Đổi ca
 *  - open: tháng sau → nhận xin nghỉ
 *  - future: xa hơn tháng sau → chưa mở
 *  - past: đã qua
 */
export function leaveMonthState(ref: MonthRef, today: Date = new Date()): LeaveMonthState {
  const cur = { month: today.getMonth() + 1, year: today.getFullYear() }
  const idx = (r: MonthRef) => r.year * 12 + r.month
  const diff = idx(ref) - idx(cur)
  if (diff < 0) return 'past'
  if (diff === 0) return 'current'
  if (diff === 1) return 'open'
  return 'future'
}

/** gộp ngày được duyệt vào ngày nghỉ cố định hiện có — không trùng, tăng dần */
export function mergeDaysOff(existing: number[], add: number[]): number[] {
  return [...new Set([...existing, ...add])].sort((a, b) => a - b)
}

export function normalizeDays(days: number[], daysInMonth: number): number[] {
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= daysInMonth))].sort((a, b) => a - b)
}

/**
 * Kiểm tra yêu cầu mới của một nhân viên: phải có ít nhất 1 ngày, không trùng ngày đã
 * nghỉ cố định, không trùng ngày đang chờ duyệt. Trả về thông báo lỗi hoặc null.
 */
export function validateLeaveRequest(
  days: number[],
  fixedOff: number[],
  pendingDays: number[],
): string | null {
  if (days.length === 0) return 'Chọn ít nhất một ngày muốn nghỉ.'
  const dupFixed = days.filter((d) => fixedOff.includes(d))
  if (dupFixed.length) return `Ngày ${dupFixed.join(', ')} đã là ngày nghỉ cố định.`
  const dupPending = days.filter((d) => pendingDays.includes(d))
  if (dupPending.length) return `Ngày ${dupPending.join(', ')} đang chờ duyệt trong yêu cầu khác.`
  return null
}

/** chờ duyệt lên đầu, rồi mới nhất trước */
export function sortLeaveRequests(list: LeaveRequest[]): LeaveRequest[] {
  const rank: Record<LeaveStatus, number> = { pending: 0, approved: 1, rejected: 1 }
  return [...list].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.created_at.localeCompare(a.created_at),
  )
}
