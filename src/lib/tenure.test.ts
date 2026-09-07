import { describe, expect, it } from 'vitest'
import { employeesInMonth, hasLeft, worksInMonth } from './types'

const base = { active: true, joined_at: null as string | null, left_at: null as string | null }

describe('worksInMonth — ngày vào / nghỉ việc quyết định dòng trên lịch tháng', () => {
  it('không có ngày vào/nghỉ → có mặt ở mọi tháng', () => {
    expect(worksInMonth(base, 1, 2020)).toBe(true)
    expect(worksInMonth(base, 12, 2030)).toBe(true)
  })
  it('người mới vào giữa tháng 9 → không có ở tháng 8, có ở tháng 9 và 10', () => {
    const e = { ...base, joined_at: '2026-09-15' }
    expect(worksInMonth(e, 8, 2026)).toBe(false)
    expect(worksInMonth(e, 9, 2026)).toBe(true)
    expect(worksInMonth(e, 10, 2026)).toBe(true)
  })
  it('người nghỉ giữa tháng 9 → vẫn có ở tháng 8 và 9, không có ở tháng 10', () => {
    const e = { ...base, active: false, left_at: '2026-09-15' }
    expect(worksInMonth(e, 8, 2026)).toBe(true)
    expect(worksInMonth(e, 9, 2026)).toBe(true)
    expect(worksInMonth(e, 10, 2026)).toBe(false)
  })
  it('dữ liệu cũ đã xóa (active=false, không có ngày nghỉ) → ẩn ở mọi tháng', () => {
    expect(worksInMonth({ ...base, active: false }, 9, 2026)).toBe(false)
  })
  it('employeesInMonth lọc đúng, hasLeft theo hôm nay', () => {
    const list = [
      { ...base, id: 'a' },
      { ...base, id: 'b', joined_at: '2026-10-01' },
      { ...base, id: 'c', active: false, left_at: '2026-08-31' },
    ]
    expect(employeesInMonth(list as never, 9, 2026).map((e) => e.id)).toEqual(['a'])
    expect(employeesInMonth(list as never, 10, 2026).map((e) => e.id)).toEqual(['a', 'b'])
    expect(hasLeft(list[2], new Date(2026, 8, 7))).toBe(true)
    expect(hasLeft({ ...base, left_at: '2026-12-31' }, new Date(2026, 8, 7))).toBe(false)
  })
})
