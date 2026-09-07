import { describe, expect, it } from 'vitest'
import { solve } from './solver'
import { SEED_EMPLOYEES } from '../seed'
import type { ScheduleMatrix, Shift } from '../types'

// lịch cũ hợp lệ về chuỗi: mỗi người 4 ngày một ca rồi nghỉ 1 ngày, lệch pha & khác ca giữa các người
// (chỗ nối với khoảng xếp lại được solver tôn trọng: ngày đầu khoảng phải nghỉ hoặc cùng ca với ngày trước đó)
const base = (): ScheduleMatrix =>
  Object.fromEntries(
    SEED_EMPLOYEES.map((e, i) => [
      e.id,
      Array.from({ length: 31 }, (_, d): Shift => ((d + i) % 5 === 4 ? 'OFF' : (['S1', 'S2', 'S3'] as const)[i % 3])),
    ]),
  )

describe('solver — xếp theo khoảng ngày', () => {
  it('chỉ đổi các ngày trong khoảng, ngày ngoài khoảng giữ nguyên lịch cũ', () => {
    const old = base()
    const r = solve({
      employees: SEED_EMPLOYEES,
      month: 10,
      year: 2026,
      daysInMonth: 31,
      minPerShift: { S1: 2, S2: 2, S3: 2 },
      streakMin: 2,
      streakMax: 5,
      restMin: 1,
      restMax: 2,
      seed: 7,
      range: { from: 10, to: 20 },
      base: old,
    })
    for (const e of SEED_EMPLOYEES) {
      const row = r.matrix[e.id]
      expect(row).toHaveLength(31)
      for (let d = 0; d < 31; d++) {
        if (d < 9 || d > 19) expect(row[d]).toBe(old[e.id][d])
      }
    }
    // trong khoảng: mỗi ngày đủ ≥ 2 người / ca
    for (let d = 9; d < 20; d++) {
      for (const s of ['S1', 'S2', 'S3'] as const) {
        const n = SEED_EMPLOYEES.filter((e) => r.matrix[e.id][d] === s).length
        expect(n).toBeGreaterThanOrEqual(2)
      }
    }
  }, 60000)

  it('không có lịch cũ → ngoài khoảng là OFF', () => {
    const r = solve({
      employees: SEED_EMPLOYEES,
      month: 10,
      year: 2026,
      daysInMonth: 31,
      minPerShift: { S1: 2, S2: 2, S3: 2 },
      streakMin: 2,
      streakMax: 5,
      restMin: 1,
      restMax: 2,
      seed: 3,
      range: { from: 25, to: 31 },
    })
    for (const e of SEED_EMPLOYEES) for (let d = 0; d < 24; d++) expect(r.matrix[e.id][d]).toBe('OFF')
  }, 60000)
})
