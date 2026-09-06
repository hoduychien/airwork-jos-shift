import type { ScheduleMatrix, Shift } from './types'
import { SHIFT_LABELS } from './types'

/**
 * Đổi ca (shift swap) — quy tắc thuần, không phụ thuộc store/UI.
 *
 * - Chỉ đổi ca trong THÁNG HIỆN TẠI, từ hôm nay trở đi, trên lịch đã chốt.
 * - Người gửi chọn một ô (ngày, ca) của mình và một ô của đồng nghiệp. Hai ô đổi giá trị cho nhau.
 * - Cần ĐỒNG NGHIỆP đồng ý và PM/admin duyệt. Đủ cả hai → lịch được cập nhật, hai ô đánh dấu «đã đổi ca».
 * - Khi tạo / có quyết định → thông báo tới người liên quan (đồng nghiệp, PM, người gửi).
 */

export type Decision = 'pending' | 'approved' | 'rejected'
export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface SwapRequest {
  id: string
  month: number
  year: number
  requester_id: string
  requester_day: number
  /** ca của người gửi lúc tạo yêu cầu (snapshot) */
  requester_shift: Shift
  partner_id: string
  partner_day: number
  partner_shift: Shift
  note: string
  peer_status: Decision
  pm_status: Decision
  /** approved = đã đủ 2 bên duyệt và lịch đã cập nhật */
  status: SwapStatus
  created_at: string
  peer_decided_at?: string | null
  pm_decided_at?: string | null
  applied_at?: string | null
  decision_note?: string | null
}

export const SWAP_STATUS_LABELS: Record<SwapStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã đổi',
  rejected: 'Từ chối',
  cancelled: 'Đã rút',
}
export const DECISION_LABELS: Record<Decision, string> = {
  pending: 'Chờ',
  approved: 'Đồng ý',
  rejected: 'Từ chối',
}

export interface Notification {
  id: string
  /** username (demo) hoặc auth user id (Supabase) */
  user_id: string
  title: string
  body: string
  /** đường dẫn trong app để nhảy tới */
  link: string
  read: boolean
  created_at: string
}

export const cellKey = (employeeId: string, day: number) => `${employeeId}:${day}`

/** ngày còn đổi được: thuộc tháng hiện tại và ≥ hôm nay */
export function isSwapDayOpen(day: number, month: number, year: number, today: Date = new Date()): boolean {
  if (month !== today.getMonth() + 1 || year !== today.getFullYear()) return false
  return day >= today.getDate()
}

export function shortShift(s: Shift): string {
  return SHIFT_LABELS[s].split(' · ')[1] ?? s
}

/** "ngày 12 · Ca sáng (S1)" */
export function describeCell(day: number, shift: Shift): string {
  return `ngày ${day} · ${shift === 'OFF' ? 'Nghỉ' : `${shortShift(shift)} (${shift})`}`
}

/**
 * Kiểm tra yêu cầu mới. Trả về thông báo lỗi hoặc null.
 * `matrix` là lịch hiện tại để lấy ca thật của 2 ô.
 */
export function validateSwapRequest(
  input: {
    requester_id: string
    requester_day: number
    partner_id: string
    partner_day: number
  },
  matrix: ScheduleMatrix,
  month: number,
  year: number,
  pendingKeys: Set<string>,
  today: Date = new Date(),
): string | null {
  if (input.requester_id === input.partner_id) return 'Chọn một đồng nghiệp khác bạn.'
  if (!isSwapDayOpen(input.requester_day, month, year, today) || !isSwapDayOpen(input.partner_day, month, year, today))
    return 'Chỉ đổi ca trong tháng hiện tại, từ hôm nay trở đi.'
  const a = matrix[input.requester_id]?.[input.requester_day - 1]
  const b = matrix[input.partner_id]?.[input.partner_day - 1]
  if (!a || !b) return 'Không tìm thấy ca trên lịch đã chốt.'
  if (input.requester_day === input.partner_day && a === b) return 'Hai ca giống nhau cùng ngày — không có gì để đổi.'
  if (pendingKeys.has(cellKey(input.requester_id, input.requester_day)))
    return `Ca ${describeCell(input.requester_day, a)} của bạn đang nằm trong một yêu cầu chờ duyệt khác.`
  if (pendingKeys.has(cellKey(input.partner_id, input.partner_day)))
    return `Ca ${describeCell(input.partner_day, b)} của đồng nghiệp đang nằm trong một yêu cầu chờ duyệt khác.`
  return null
}

/** các ô đang bị giữ bởi yêu cầu chờ duyệt (để không tạo trùng) */
export function pendingCellKeys(list: SwapRequest[]): Set<string> {
  const s = new Set<string>()
  for (const r of list) {
    if (r.status !== 'pending') continue
    s.add(cellKey(r.requester_id, r.requester_day))
    s.add(cellKey(r.partner_id, r.partner_day))
  }
  return s
}

/**
 * Áp dụng đổi ca lên ma trận (trả về ma trận mới, không sửa tại chỗ).
 * Ném lỗi nếu ca hiện tại không còn khớp snapshot (lịch đã bị sửa sau khi gửi yêu cầu).
 */
export function applySwap(matrix: ScheduleMatrix, r: SwapRequest): ScheduleMatrix {
  const a = matrix[r.requester_id]?.[r.requester_day - 1]
  const b = matrix[r.partner_id]?.[r.partner_day - 1]
  if (a !== r.requester_shift || b !== r.partner_shift)
    throw new Error('Lịch đã thay đổi so với lúc gửi yêu cầu — không đổi ca được, hãy tạo yêu cầu mới.')
  const next: ScheduleMatrix = { ...matrix }
  next[r.requester_id] = [...matrix[r.requester_id]]
  next[r.partner_id] = [...matrix[r.partner_id]]
  next[r.requester_id][r.requester_day - 1] = r.partner_shift
  next[r.partner_id][r.partner_day - 1] = r.requester_shift
  return next
}

/** trạng thái tổng từ 2 quyết định */
export function overallStatus(peer: Decision, pm: Decision): SwapStatus {
  if (peer === 'rejected' || pm === 'rejected') return 'rejected'
  if (peer === 'approved' && pm === 'approved') return 'approved'
  return 'pending'
}

/** thông tin tooltip cho ô đã đổi ca: key ô → dòng mô tả */
export function swappedCellTips(
  list: SwapRequest[],
  nameOf: (id: string) => string,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of list) {
    if (r.status !== 'approved') continue
    const when = r.applied_at ? ` · duyệt ${fmtShort(r.applied_at)}` : ''
    // sau khi đổi: ô của người gửi mang ca cũ của đồng nghiệp và ngược lại
    map.set(
      cellKey(r.requester_id, r.requester_day),
      `Đã đổi ca với ${nameOf(r.partner_id)}: ${r.requester_shift} → ${r.partner_shift} (lấy ${describeCell(r.partner_day, r.partner_shift)} của họ)${when}`,
    )
    map.set(
      cellKey(r.partner_id, r.partner_day),
      `Đã đổi ca với ${nameOf(r.requester_id)}: ${r.partner_shift} → ${r.requester_shift} (lấy ${describeCell(r.requester_day, r.requester_shift)} của họ)${when}`,
    )
  }
  return map
}

export function fmtShort(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** chờ duyệt lên đầu, rồi mới nhất trước */
export function sortSwapRequests(list: SwapRequest[]): SwapRequest[] {
  const rank: Record<SwapStatus, number> = { pending: 0, approved: 1, rejected: 1, cancelled: 1 }
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || b.created_at.localeCompare(a.created_at))
}
