import { describe, expect, it } from 'vitest'
import {
  leaveMonthState,
  leaveTarget,
  mergeDaysOff,
  normalizeDays,
  shiftMonth,
  sortLeaveRequests,
  validateLeaveRequest,
  type LeaveRequest,
} from './leave'
import { isPastMonth } from './types'

describe('leaveTarget / leaveMonthState', () => {
  it('tháng sau là tháng duy nhất mở xin nghỉ, kể cả qua năm', () => {
    expect(leaveTarget(new Date(2026, 8, 6))).toEqual({ month: 10, year: 2026 })
    expect(leaveTarget(new Date(2026, 11, 31))).toEqual({ month: 1, year: 2027 })
  })
  it('phân loại tháng: past / current / open / future', () => {
    const today = new Date(2026, 8, 6)
    expect(leaveMonthState({ month: 8, year: 2026 }, today)).toBe('past')
    expect(leaveMonthState({ month: 9, year: 2026 }, today)).toBe('current')
    expect(leaveMonthState({ month: 10, year: 2026 }, today)).toBe('open')
    expect(leaveMonthState({ month: 11, year: 2026 }, today)).toBe('future')
    expect(leaveMonthState({ month: 1, year: 2027 }, new Date(2026, 11, 15))).toBe('open')
  })
  it('shiftMonth qua ranh giới năm', () => {
    expect(shiftMonth({ month: 12, year: 2026 }, 1)).toEqual({ month: 1, year: 2027 })
    expect(shiftMonth({ month: 1, year: 2027 }, -1)).toEqual({ month: 12, year: 2026 })
  })
})

describe('mergeDaysOff / normalizeDays', () => {
  it('gộp không trùng, tăng dần', () => {
    expect(mergeDaysOff([5, 12], [12, 3, 20])).toEqual([3, 5, 12, 20])
    expect(mergeDaysOff([], [2, 1])).toEqual([1, 2])
  })
  it('loại ngày ngoài tháng và trùng', () => {
    expect(normalizeDays([31, 0, 4, 4, 2.5, 15], 30)).toEqual([4, 15])
  })
})

describe('validateLeaveRequest', () => {
  it('bắt buộc có ngày', () => {
    expect(validateLeaveRequest([], [], [])).toMatch(/ít nhất một ngày/)
  })
  it('không cho trùng ngày nghỉ cố định hoặc đang chờ duyệt', () => {
    expect(validateLeaveRequest([3, 4], [4], [])).toMatch(/Ngày 4 đã là ngày nghỉ cố định/)
    expect(validateLeaveRequest([3, 4], [], [3])).toMatch(/Ngày 3 đang chờ duyệt/)
    expect(validateLeaveRequest([3, 4], [10], [11])).toBeNull()
  })
})

describe('sortLeaveRequests', () => {
  const mk = (id: string, status: LeaveRequest['status'], created_at: string): LeaveRequest => ({
    id,
    employee_id: 'e1',
    month: 10,
    year: 2026,
    days: [1],
    reason: '',
    status,
    created_at,
  })
  it('chờ duyệt lên đầu, mới nhất trước', () => {
    const sorted = sortLeaveRequests([
      mk('a', 'approved', '2026-09-03T00:00:00Z'),
      mk('b', 'pending', '2026-09-01T00:00:00Z'),
      mk('c', 'pending', '2026-09-02T00:00:00Z'),
      mk('d', 'rejected', '2026-09-04T00:00:00Z'),
    ])
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a'])
  })
})

describe('isPastMonth', () => {
  it('tháng trước tháng hiện tại là đã qua, tháng này và sau thì không', () => {
    const today = new Date(2026, 8, 6)
    expect(isPastMonth(8, 2026, today)).toBe(true)
    expect(isPastMonth(12, 2025, today)).toBe(true)
    expect(isPastMonth(9, 2026, today)).toBe(false)
    expect(isPastMonth(10, 2026, today)).toBe(false)
  })
})
