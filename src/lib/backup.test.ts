import { describe, expect, it } from 'vitest'
import { buildBackup, parseBackup, planRestore } from './backup'
import { SEED_EMPLOYEES, SEED_SCHEDULE_10_2026, decodeScheduleRow } from './seed'
import type { ScheduleMatrix } from './types'

const matrix = (): ScheduleMatrix =>
  Object.fromEntries(Object.entries(SEED_SCHEDULE_10_2026.rows).map(([id, enc]) => [id, decodeScheduleRow(enc)]))

describe('sao lưu / nhập lại lịch', () => {
  it('sao lưu rồi nhập lại cho ra đúng ma trận và ô chỉnh tay', () => {
    const b = buildBackup({
      month: 10,
      year: 2026,
      status: 'published',
      employees: SEED_EMPLOYEES,
      matrix: matrix(),
      manual: new Set(['e1:3', 'e5:20']),
    })
    expect(b.rows.e1).toBe(SEED_SCHEDULE_10_2026.rows.e1)
    const parsed = parseBackup(JSON.stringify(b))
    const plan = planRestore(parsed, SEED_EMPLOYEES)
    expect(plan.matched).toHaveLength(9)
    expect(plan.missing).toHaveLength(0)
    expect(plan.unmapped).toHaveLength(0)
    expect(plan.matrix).toEqual(matrix())
    expect([...plan.manual].sort()).toEqual(['e1:3', 'e5:20'])
  })

  it('khớp theo mã nhân viên khi id đổi; người không còn thì bỏ qua, người mới thì toàn OFF', () => {
    const b = buildBackup({ month: 10, year: 2026, status: 'draft', employees: SEED_EMPLOYEES, matrix: matrix(), manual: new Set() })
    const current = [
      { ...SEED_EMPLOYEES[0], id: 'new-id-quang' }, // id đổi, mã giữ → khớp theo mã
      ...SEED_EMPLOYEES.slice(2, 9), // bỏ e2 (VuNL4)
      { ...SEED_EMPLOYEES[1], id: 'e10', code: 'Moi1', name: 'Moi1' }, // người mới
    ]
    const plan = planRestore(parseBackup(JSON.stringify(b)), current)
    expect(plan.matrix['new-id-quang']).toEqual(decodeScheduleRow(SEED_SCHEDULE_10_2026.rows.e1))
    expect(plan.missing.map((m) => m.code)).toEqual(['VuNL4'])
    expect(plan.unmapped.map((e) => e.code)).toEqual(['Moi1'])
    expect(plan.matrix.e10.every((s) => s === 'OFF')).toBe(true)
  })

  it('từ chối file không hợp lệ', () => {
    expect(() => parseBackup('không phải json')).toThrow(/JSON/)
    expect(() => parseBackup('{"format":"khac"}')).toThrow(/sao lưu/)
    expect(() =>
      parseBackup(JSON.stringify({ format: 'airwork-jos-shift/schedule', version: 1, month: 10, year: 2026, employees: [], rows: { e1: '12' } })),
    ).toThrow(/31 ký tự/)
  })
})
