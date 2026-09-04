import { describe, it, expect } from 'vitest'
import { restHoursBetween, validateMatrix } from './validate'
import { SEED_EMPLOYEES, SEED_SCHEDULE_10_2026, decodeScheduleRow } from '../seed'
import type { ScheduleMatrix, Shift } from '../types'

const D = 31

function baseOpts(matrix: ScheduleMatrix) {
  return {
    employees: SEED_EMPLOYEES,
    matrix,
    daysInMonth: D,
    minPerShift: 2,
    streakMin: 2,
    streakMax: 5,
    restMax: 2,
    skipBalance: true,
  }
}

function emptyMatrix(): ScheduleMatrix {
  return Object.fromEntries(SEED_EMPLOYEES.map((e) => [e.id, new Array<Shift>(D).fill('OFF')]))
}

describe('restHoursBetween — giờ nghỉ giữa 2 ngày liền kề', () => {
  it('S2→S1 chỉ nghỉ 8h', () => expect(restHoursBetween('S2', 'S1')).toBe(8))
  it('S3→S2 chỉ nghỉ 8h', () => expect(restHoursBetween('S3', 'S2')).toBe(8))
  it('S3→S1 nghỉ 0h', () => expect(restHoursBetween('S3', 'S1')).toBe(0))
  it('S1→S2 nghỉ 24h', () => expect(restHoursBetween('S1', 'S2')).toBe(24))
  it('cùng ca luôn nghỉ 16h', () => {
    expect(restHoursBetween('S1', 'S1')).toBe(16)
    expect(restHoursBetween('S2', 'S2')).toBe(16)
    expect(restHoursBetween('S3', 'S3')).toBe(16)
  })
})

describe('validateMatrix — bắt từng loại vi phạm', () => {
  it('bắt chuyển ca khác nhau giữa 2 ngày liền kề', () => {
    const m = emptyMatrix()
    m['e1'][0] = 'S3'
    m['e1'][1] = 'S3'
    m['e1'][2] = 'S1' // S3→S1: 0h nghỉ
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'adjacent-switch' && x.employee_id === 'e1' && x.day === 3)).toBe(true)
  })

  it('bắt chuỗi làm quá 5 ngày', () => {
    const m = emptyMatrix()
    for (let d = 5; d < 11; d++) m['e2'][d] = 'S1' // 6 ngày
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'streak-too-long' && x.employee_id === 'e2')).toBe(true)
  })

  it('bắt chuỗi làm 1 ngày lẻ loi giữa tháng', () => {
    const m = emptyMatrix()
    m['e3'][10] = 'S2'
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'streak-too-short' && x.employee_id === 'e3')).toBe(true)
  })

  it('không bắt chuỗi ngắn chạm biên tháng', () => {
    const m = emptyMatrix()
    m['e4'][0] = 'S1' // ngày 1 — có thể nối tiếp tháng trước
    m['e4'][30] = 'S2' // ngày 31 — có thể nối sang tháng sau
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'streak-too-short' && x.employee_id === 'e4')).toBe(false)
  })

  it('nghỉ liên tục quá 2 ngày được phép — không còn là vi phạm', () => {
    const m = emptyMatrix()
    // e1 làm 10-12, nghỉ 13-17 (5 ngày liên tục), làm 18-19
    for (const d of [9, 10, 11]) m['e1'][d] = 'S1'
    for (const d of [17, 18]) m['e1'][d] = 'S1'
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'off-too-long')).toBe(false)
  })

  it('bắt vi phạm cấm ca và ngày nghỉ đăng ký', () => {
    const m = emptyMatrix()
    m['e6'][3] = 'S3' // e6 (QuanPD7) đăng ký không làm ca đêm
    m['e6'][4] = 'S3'
    const emps = SEED_EMPLOYEES.map((e) => (e.id === 'e7' ? { ...e, days_off: [8] } : e))
    m['e7'][7] = 'S1'
    m['e7'][8] = 'S1'
    const v = validateMatrix({ ...baseOpts(m), employees: emps })
    expect(v.some((x) => x.type === 'pref-no-shift' && x.employee_id === 'e6')).toBe(true)
    expect(v.some((x) => x.type === 'pref-day-off' && x.employee_id === 'e7' && x.day === 8)).toBe(true)
  })

  it('bắt thiếu độ phủ từng ca từng ngày', () => {
    const m = emptyMatrix()
    const v = validateMatrix(baseOpts(m))
    // ma trận toàn OFF → thiếu cả 3 ca × 31 ngày
    expect(v.filter((x) => x.type === 'coverage')).toHaveLength(3 * D)
  })

  it('quota ca đêm là ưu tiên mềm — làm ít hơn số đăng ký không bị coi là vi phạm', () => {
    const m = emptyMatrix()
    // e5 (ChienHD2) đăng ký min 16 ca đêm nhưng chỉ có 3 — vẫn hợp lệ
    // miễn là có đủ ≥2 ca S1 và ≥2 ca S2
    for (const d of [0, 1, 2]) m['e5'][d] = 'S3'
    for (const d of [4, 5]) m['e5'][d] = 'S1'
    for (const d of [7, 8]) m['e5'][d] = 'S2'
    const v = validateMatrix(baseOpts(m))
    expect(v.some((x) => x.type === 'min-night' && x.employee_id === 'e5')).toBe(false)
  })

  it('người ưu tiên ca đêm vẫn phải có ≥2 ca S1 và ≥2 ca S2', () => {
    const m = emptyMatrix()
    // e5 chỉ toàn ca đêm, không có S1/S2 nào
    for (const d of [0, 1, 2, 3]) m['e5'][d] = 'S3'
    const v = validateMatrix(baseOpts(m))
    const mine = v.filter((x) => x.type === 'min-night' && x.employee_id === 'e5')
    expect(mine.some((x) => x.message.includes('S1'))).toBe(true)
    expect(mine.some((x) => x.message.includes('S2'))).toBe(true)
  })

  it('bắt vượt tổng ca tối đa', () => {
    const m = emptyMatrix()
    const emps = SEED_EMPLOYEES.map((e) => (e.id === 'e1' ? { ...e, max_shifts_per_month: 4 } : e))
    for (let d = 0; d < 5; d++) m['e1'][d] = 'S1'
    const v = validateMatrix({ ...baseOpts(m), employees: emps })
    expect(v.some((x) => x.type === 'max-shifts' && x.employee_id === 'e1')).toBe(true)
  })

  it('lịch tháng 10/2026 từ file Shift_plan final là hợp lệ 100%', () => {
    const { rows } = SEED_SCHEDULE_10_2026
    const matrix: ScheduleMatrix = Object.fromEntries(
      Object.entries(rows).map(([id, enc]) => {
        const row = decodeScheduleRow(enc)
        expect(row).toHaveLength(31)
        return [id, row]
      }),
    )
    const v = validateMatrix({ ...baseOpts(matrix), skipBalance: false })
    expect(v).toHaveLength(0)
    // đúng số liệu file: QuangPK1 & ChienHD2 có 16 S3 + 2 S1 + 2 S2, QuanPD7 không có S3
    for (const id of ['e1', 'e5']) {
      expect(matrix[id].filter((s) => s === 'S3')).toHaveLength(16)
      expect(matrix[id].filter((s) => s === 'S1')).toHaveLength(2)
      expect(matrix[id].filter((s) => s === 'S2')).toHaveLength(2)
    }
    expect(matrix['e6'].filter((s) => s === 'S3')).toHaveLength(0)
  })

  it('bắt mất cân bằng tổng ca > 1', () => {
    const m = emptyMatrix()
    for (let d = 0; d < 4; d++) m['e1'][d] = 'S1' // e1: 4 ca, người khác: 0
    const v = validateMatrix({ ...baseOpts(m), skipBalance: false })
    expect(v.some((x) => x.type === 'balance')).toBe(true)
  })
})
