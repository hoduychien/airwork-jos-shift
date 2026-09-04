import { describe, it, expect } from 'vitest'
import { solve } from './solver'
import { restHoursBetween } from './validate'
import { SEED_EMPLOYEES } from '../seed'
import type { Employee, SolverInput, SolverResult } from '../types'
import { WORK_SHIFTS } from '../types'
import { evaluateFairnessMatrix, fairnessGroups } from './fairness'

const D = 31

function makeInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    employees: SEED_EMPLOYEES.map((e) => ({ ...e, days_off: [...e.days_off] })),
    month: 1,
    year: 2026,
    daysInMonth: D,
    minPerShift: 2,
    streakMin: 2,
    streakMax: 5,
    restMin: 1,
    restMax: 2,
    seed: 42,
    ...overrides,
  }
}

function solveOk(input: SolverInput): SolverResult {
  // solver ngẫu nhiên hóa: cho phép vài seed trước khi kết luận
  let last: SolverResult | null = null
  for (const seed of [input.seed, 7, 123, 2024]) {
    last = solve({ ...input, seed })
    if (last.ok) return last
  }
  return last!
}

describe('solver — ràng buộc cứng (mục 1.2)', () => {
  const input = makeInput()
  const result = solveOk(input)
  const { matrix } = result
  const emps = input.employees

  it('tìm được lịch hợp lệ với seed data (9 người, N=2)', () => {
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('không có chuyển ca khác nhau giữa 2 ngày làm liền kề', () => {
    for (const e of emps) {
      const row = matrix[e.id]
      for (let d = 0; d < D - 1; d++) {
        if (row[d] !== 'OFF' && row[d + 1] !== 'OFF') {
          expect(row[d]).toBe(row[d + 1])
        }
      }
    }
  })

  it('nghỉ giữa 2 ngày làm liền kề luôn ≥ 16h', () => {
    for (const e of emps) {
      const row = matrix[e.id]
      for (let d = 0; d < D - 1; d++) {
        if (row[d] !== 'OFF' && row[d + 1] !== 'OFF') {
          expect(restHoursBetween(row[d], row[d + 1])).toBeGreaterThanOrEqual(16)
        }
      }
    }
  })

  it('chuỗi làm việc 2-5 ngày (chuỗi giữa tháng), không quá 5 ngày ở mọi vị trí', () => {
    for (const e of emps) {
      const row = matrix[e.id]
      let d = 0
      while (d < D) {
        if (row[d] !== 'OFF') {
          let end = d
          while (end < D && row[end] !== 'OFF') end++
          const len = end - d
          expect(len).toBeLessThanOrEqual(5)
          if (d > 0 && end < D) expect(len).toBeGreaterThanOrEqual(2)
          d = end
        } else d++
      }
    }
  })

  it('chuỗi nghỉ không quá 2 ngày (trừ đầu/cuối tháng và ngày nghỉ đăng ký)', () => {
    for (const e of emps) {
      const row = matrix[e.id]
      const offSet = new Set(e.days_off)
      let d = 0
      while (d < D) {
        if (row[d] === 'OFF') {
          let end = d
          while (end < D && row[end] === 'OFF') end++
          const len = end - d
          const edge = d === 0 || end === D
          const requested = Array.from({ length: len }, (_, k) => d + 1 + k).some((x) => offSet.has(x))
          if (!edge && !requested) expect(len).toBeLessThanOrEqual(2)
          d = end
        } else d++
      }
    }
  })

  it('độ phủ: mỗi ngày mỗi ca có tối thiểu 2 người', () => {
    for (let d = 0; d < D; d++) {
      for (const s of WORK_SHIFTS) {
        const n = emps.filter((e) => matrix[e.id][d] === s).length
        expect(n).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('cân bằng: chênh lệch tổng ca giữa mọi người ≤ 1, không ai vượt max 21', () => {
    const totals = emps.map((e) => matrix[e.id].filter((s) => s !== 'OFF').length)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1)
    emps.forEach((e, i) => expect(totals[i]).toBeLessThanOrEqual(e.max_shifts_per_month))
  })
})

describe('solver — preferences (mục 1.3)', () => {
  const input = makeInput()
  const result = solveOk(input)
  const { matrix } = result
  const emps = input.employees

  it('người "không làm ca đêm" không có ca S3 nào', () => {
    const noNight = emps.filter((e) => e.no_s3)
    expect(noNight.length).toBeGreaterThan(0)
    for (const e of noNight) {
      expect(matrix[e.id].filter((s) => s === 'S3')).toHaveLength(0)
    }
  })

  it('người ưu tiên ca đêm đạt tối thiểu 16 ca S3 và vẫn có ≥2 ca S1, ≥2 ca S2', () => {
    const night = emps.filter((e) => e.prefer_night)
    expect(night.length).toBe(2)
    for (const e of night) {
      const row = matrix[e.id]
      expect(row.filter((s) => s === 'S3').length).toBeGreaterThanOrEqual(16)
      expect(row.filter((s) => s === 'S1').length).toBeGreaterThanOrEqual(2)
      expect(row.filter((s) => s === 'S2').length).toBeGreaterThanOrEqual(2)
    }
  })

  it('tôn trọng ngày nghỉ cố định đã đăng ký', () => {
    const withOffs = makeInput()
    withOffs.employees[0].days_off = [5, 6, 20]
    withOffs.employees[1].days_off = [14, 15]
    const r = solveOk(withOffs)
    expect(r.ok).toBe(true)
    expect(r.matrix[withOffs.employees[0].id][4]).toBe('OFF')
    expect(r.matrix[withOffs.employees[0].id][5]).toBe('OFF')
    expect(r.matrix[withOffs.employees[0].id][19]).toBe('OFF')
    expect(r.matrix[withOffs.employees[1].id][13]).toBe('OFF')
    expect(r.matrix[withOffs.employees[1].id][14]).toBe('OFF')
  })

  it('cấm ca S1/S2 được tôn trọng', () => {
    const inp = makeInput()
    // dùng người không có ràng buộc sẵn (e6 đã no_s3, e1/e5 ưu tiên đêm)
    inp.employees[1].no_s1 = true
    inp.employees[7].no_s2 = true
    const r = solveOk(inp)
    expect(r.matrix[inp.employees[1].id].filter((s) => s === 'S1')).toHaveLength(0)
    expect(r.matrix[inp.employees[7].id].filter((s) => s === 'S2')).toHaveLength(0)
  })
})

describe('solver — phát hiện vô nghiệm', () => {
  it('cảnh báo khi quá nhiều người không làm ca đêm', () => {
    const emps: Employee[] = SEED_EMPLOYEES.map((e) => ({ ...e, no_s3: true, prefer_night: false, min_night_shifts: 0 }))
    const r = solve(makeInput({ employees: emps }))
    expect(r.ok).toBe(false)
    expect(r.conflicts.some((c) => c.includes('S3'))).toBe(true)
  })

  it('cảnh báo khi tổng công suất không đủ', () => {
    const emps = SEED_EMPLOYEES.slice(0, 4).map((e) => ({ ...e }))
    const r = solve(makeInput({ employees: emps }))
    expect(r.ok).toBe(false)
    expect(r.conflicts.length).toBeGreaterThan(0)
  })

  it('cảnh báo khi một người bị chặn cả 3 ca', () => {
    const emps = SEED_EMPLOYEES.map((e) => ({ ...e }))
    emps[0] = { ...emps[0], no_s1: true, no_s2: true, no_s3: true }
    const r = solve(makeInput({ employees: emps }))
    expect(r.conflicts.some((c) => c.includes(emps[0].name))).toBe(true)
  })

  it('shuffle với seed khác cho ra phương án khác', () => {
    const r1 = solve(makeInput({ seed: 1 }))
    const r2 = solve(makeInput({ seed: 99 }))
    const flat = (m: Record<string, string[]>) => Object.values(m).flat().join('')
    expect(flat(r1.matrix)).not.toBe(flat(r2.matrix))
  })

  it('tháng 30 ngày cũng giải được', () => {
    const r = solveOk(makeInput({ month: 4, daysInMonth: 30 }))
    expect(r.ok).toBe(true)
  })
})

describe('solver — chia đều ca cho nhân viên không làm đêm (rule chia đều)', () => {
  const input = makeInput({ month: 10, daysInMonth: 31, seed: 1 })
  const r = solveOk(input)

  it('giải được và rule chia đều đạt (hard = 0) hoặc chỉ lệch nhẹ', () => {
    expect(r.ok).toBe(true)
    const fair = evaluateFairnessMatrix(input.employees, r.matrix)
    expect(fair.hard).toBeLessThanOrEqual(2)
  })

  it('trong nhóm làm cả 3 ca: mỗi loại ca chênh ≤ 3 giữa các người', () => {
    const g = fairnessGroups(input.employees).find((x) => x.key === 'S1,S2,S3')!
    expect(g.members.length).toBeGreaterThan(1)
    for (const t of WORK_SHIFTS) {
      const ns = g.members.map((e) => r.matrix[e.id].filter((s) => s === t).length)
      expect(Math.max(...ns) - Math.min(...ns)).toBeLessThanOrEqual(3)
    }
  })

  it('người không làm S3 được chia đều S1 và S2 (|S1 − S2| ≤ 3)', () => {
    const noS3 = input.employees.filter((e) => e.no_s3 && !e.no_s1 && !e.no_s2)
    expect(noS3.length).toBeGreaterThan(0)
    for (const e of noS3) {
      const row = r.matrix[e.id]
      const s1 = row.filter((s) => s === 'S1').length
      const s2 = row.filter((s) => s === 'S2').length
      expect(row.filter((s) => s === 'S3').length).toBe(0)
      expect(Math.abs(s1 - s2)).toBeLessThanOrEqual(3)
    }
  })
})
