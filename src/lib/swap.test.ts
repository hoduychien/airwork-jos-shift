import { describe, expect, it } from 'vitest'
import {
  applySwap,
  isSwapDayOpen,
  overallStatus,
  pendingCellKeys,
  swappedCellTips,
  validateSwapRequest,
  type SwapRequest,
} from './swap'
import type { ScheduleMatrix } from './types'

const today = new Date(2026, 8, 6) // 6/9/2026
const matrix: ScheduleMatrix = {
  a: ['S1', 'S1', 'OFF', 'S2', 'S2', 'S1', 'S1', 'S3', 'S3', 'OFF'],
  b: ['S3', 'S3', 'S1', 'S1', 'OFF', 'S2', 'S2', 'S1', 'S1', 'OFF'],
}
const mk = (over: Partial<SwapRequest> = {}): SwapRequest => ({
  id: 'r1',
  month: 9,
  year: 2026,
  requester_id: 'a',
  requester_day: 7,
  requester_shift: 'S1',
  partner_id: 'b',
  partner_day: 7,
  partner_shift: 'S2',
  note: '',
  peer_status: 'pending',
  pm_status: 'pending',
  status: 'pending',
  created_at: '2026-09-05T08:00:00Z',
  ...over,
})

describe('isSwapDayOpen', () => {
  it('chỉ tháng hiện tại, từ hôm nay', () => {
    expect(isSwapDayOpen(6, 9, 2026, today)).toBe(true)
    expect(isSwapDayOpen(5, 9, 2026, today)).toBe(false)
    expect(isSwapDayOpen(30, 9, 2026, today)).toBe(true)
    expect(isSwapDayOpen(1, 10, 2026, today)).toBe(false)
  })
})

describe('validateSwapRequest', () => {
  const base = { requester_id: 'a', requester_day: 7, partner_id: 'b', partner_day: 7 }
  it('hợp lệ', () => {
    expect(validateSwapRequest(base, matrix, 9, 2026, new Set(), today)).toBeNull()
  })
  it('không tự đổi với mình, không đổi ngày đã qua, không đổi ca giống nhau', () => {
    expect(validateSwapRequest({ ...base, partner_id: 'a' }, matrix, 9, 2026, new Set(), today)).toMatch(/khác bạn/)
    expect(validateSwapRequest({ ...base, requester_day: 2 }, matrix, 9, 2026, new Set(), today)).toMatch(/hôm nay/)
    // ngày 8: a=S3, b=S1 khác nhau → ok; ngày 1 ở tháng 10 → không mở
    expect(validateSwapRequest(base, matrix, 10, 2026, new Set(), today)).toMatch(/tháng hiện tại/)
    expect(validateSwapRequest({ ...base, requester_day: 9, partner_day: 9 }, { a: matrix.a, b: matrix.a }, 9, 2026, new Set(), today)).toMatch(
      /giống nhau/,
    )
  })
  it('ô đang chờ duyệt ở yêu cầu khác thì chặn', () => {
    const pending = pendingCellKeys([mk()])
    expect(validateSwapRequest({ ...base, partner_day: 8 }, matrix, 9, 2026, pending, today)).toMatch(/của bạn đang nằm/)
  })
})

describe('applySwap', () => {
  it('hoán đổi 2 ô, không sửa ma trận gốc', () => {
    const next = applySwap(matrix, mk())
    expect(next.a[6]).toBe('S2')
    expect(next.b[6]).toBe('S1')
    expect(matrix.a[6]).toBe('S1')
  })
  it('lịch đã đổi so với snapshot → lỗi', () => {
    expect(() => applySwap(matrix, mk({ requester_shift: 'S3' }))).toThrow(/đã thay đổi/)
  })
})

describe('overallStatus / swappedCellTips', () => {
  it('cần cả hai đồng ý; một bên từ chối là từ chối', () => {
    expect(overallStatus('approved', 'pending')).toBe('pending')
    expect(overallStatus('approved', 'approved')).toBe('approved')
    expect(overallStatus('rejected', 'approved')).toBe('rejected')
  })
  it('tooltip chỉ cho yêu cầu đã đổi, gắn vào đúng 2 ô', () => {
    const tips = swappedCellTips([mk({ status: 'approved', applied_at: '2026-09-06T02:00:00Z' }), mk({ id: 'r2' })], (id) =>
      id.toUpperCase(),
    )
    expect(tips.size).toBe(2)
    expect(tips.get('a:7')).toMatch(/Đã đổi ca với B: S1 → S2/)
    expect(tips.get('b:7')).toMatch(/Đã đổi ca với A: S2 → S1/)
  })
})
