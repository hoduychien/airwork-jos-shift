import { describe, expect, it } from 'vitest'
import { solve } from './solver'
import { validateMatrix } from './validate'
import { SEED_EMPLOYEES } from '../seed'
import type { Shift, SolverInput } from '../types'
import { PREV_TAIL_DAYS, carryOf } from '../types'

const base = (over: Partial<SolverInput> = {}): SolverInput => ({
  employees: SEED_EMPLOYEES.map((e) => ({ ...e, days_off: [] })),
  month: 10,
  year: 2026,
  daysInMonth: 31,
  minPerShift: { S1: 2, S2: 2, S3: 2 },
  streakMin: 2,
  streakMax: 5,
  restMin: 1,
  restMax: 2,
  seed: 11,
  ...over,
})

const tailOf = (m: Record<string, Shift[]>) =>
  Object.fromEntries(Object.entries(m).map(([id, row]) => [id, row.slice(-PREV_TAIL_DAYS)]))

describe('carryOf', () => {
  it('đọc ca và số ngày liền ở cuối tháng trước', () => {
    expect(carryOf(['S1', 'OFF', 'S3', 'S3', 'S3'])).toEqual({ shift: 'S3', run: 3 })
    expect(carryOf(['S3', 'S3', 'OFF'])).toBeNull()
    expect(carryOf([])).toBeNull()
  })
})

describe('validateMatrix — chỗ nối với tháng trước', () => {
  const emp = { ...SEED_EMPLOYEES[1], days_off: [] }
  const opts = { employees: [emp], daysInMonth: 5, minPerShift: { S1: 0, S2: 0, S3: 0 }, streakMin: 2, streakMax: 5, restMax: 2, skipBalance: true }
  it('cuối tháng trước S3, ngày 1 S1 → đổi ca sát nhau', () => {
    const v = validateMatrix({ ...opts, matrix: { [emp.id]: ['S1', 'S1', 'OFF', 'OFF', 'OFF'] }, prevTail: { [emp.id]: ['S3', 'S3'] } })
    expect(v.some((x) => x.type === 'adjacent-switch' && x.day === 1)).toBe(true)
  })
  it('4 ngày S2 cuối tháng trước + 2 ngày S2 đầu tháng → chuỗi 6 ngày quá dài', () => {
    const v = validateMatrix({ ...opts, matrix: { [emp.id]: ['S2', 'S2', 'OFF', 'OFF', 'OFF'] }, prevTail: { [emp.id]: ['S2', 'S2', 'S2', 'S2'] } })
    expect(v.some((x) => x.type === 'streak-too-long' && x.day === 1)).toBe(true)
  })
  it('nghỉ ngày 1 hoặc nối cùng ca trong giới hạn → hợp lệ', () => {
    const v1 = validateMatrix({ ...opts, matrix: { [emp.id]: ['OFF', 'S1', 'S1', 'OFF', 'OFF'] }, prevTail: { [emp.id]: ['S3', 'S3', 'S3'] } })
    const v2 = validateMatrix({ ...opts, matrix: { [emp.id]: ['S3', 'S3', 'OFF', 'OFF', 'OFF'] }, prevTail: { [emp.id]: ['S3', 'S3', 'S3'] } })
    expect(v1.filter((x) => x.day === 1)).toHaveLength(0)
    expect(v2.filter((x) => x.day === 1)).toHaveLength(0)
  })
})

describe('solver — nối lịch qua tháng (prevTail)', () => {
  const oct = solve(base())
  expect(oct.ok).toBe(true)
  const prevTail = tailOf(oct.matrix)
  const nov = base({ month: 11, daysInMonth: 30, seed: 5, prevTail })
  let r = solve(nov)
  if (!r.ok) r = solve({ ...nov, seed: 77 })

  it('tháng sau giải được và không vi phạm kể cả chỗ nối', () => {
    expect(r.ok).toBe(true)
    expect(r.violations).toHaveLength(0)
  })

  it('ngày 1 tháng sau nghỉ hoặc cùng ca với ngày cuối tháng trước; chuỗi nối ≤ streakMax', () => {
    for (const e of nov.employees) {
      const carry = carryOf(prevTail[e.id])
      const row = r.matrix[e.id]
      if (!carry) continue
      if (row[0] !== 'OFF') {
        expect(row[0]).toBe(carry.shift)
        let k = 0
        while (k < row.length && row[k] === carry.shift) k++
        expect(carry.run + k).toBeLessThanOrEqual(5)
      }
    }
  })

  it('cuối tháng trước đã làm đủ 5 ngày liền → ngày 1 bắt buộc nghỉ', () => {
    const e = nov.employees[1]
    const forced = { ...prevTail, [e.id]: ['OFF', 'OFF', 'S1', 'S1', 'S1', 'S1', 'S1'] as Shift[] }
    const r2 = solve({ ...nov, prevTail: forced, seed: 9 })
    expect(r2.matrix[e.id][0]).toBe('OFF')
  })
})
