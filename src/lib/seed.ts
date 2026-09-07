import type { Employee, Shift } from './types'

/**
 * Seed theo file Shift_plan_Thang10_2026_final.xlsx:
 * 9 nhân viên — QuangPK1 & ChienHD2 ưu tiên ca đêm (16 S3 + 2 S1 + 2 S2),
 * QuanPD7 không làm ca đêm.
 */
export const SEED_EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'QuangPK1', code: 'QuangPK1', display_order: 1, prefer_night: true, min_night_shifts: 16, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e2', name: 'VuNL4', code: 'VuNL4', display_order: 2, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e3', name: 'TruongPT16', code: 'TruongPT16', display_order: 3, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e4', name: 'HungLQ33', code: 'HungLQ33', display_order: 4, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e5', name: 'ChienHD2', code: 'ChienHD2', display_order: 5, prefer_night: true, min_night_shifts: 16, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e6', name: 'QuanPD7', code: 'QuanPD7', display_order: 6, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: true, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e7', name: 'AnhND191', code: 'AnhND191', display_order: 7, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e8', name: 'ThongDV3', code: 'ThongDV3', display_order: 8, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
  { id: 'e9', name: 'ThaiDTD1', code: 'ThaiDTD1', display_order: 9, prefer_night: false, min_night_shifts: 0, no_s1: false, no_s2: false, no_s3: false, max_shifts_per_month: 21, active: true, joined_at: null, left_at: null, days_off: [] },
]

/**
 * Lịch tháng 10/2026 chốt (final) từ file Excel — mỗi ký tự một ngày:
 * '1'=S1, '2'=S2, '3'=S3, '.'=OFF. Đúng 31 ký tự mỗi hàng.
 */
export const SEED_SCHEDULE_10_2026 = {
  month: 10,
  year: 2026,
  status: 'published' as const,
  rows: {
    e1: '11.22.33.333..33..333..33333..3',
    e2: '333.11.33.111..2222..2222..111.',
    e3: '33.22..22..333.2222.1111..1111.',
    e4: '2.333.11.22.11.11.11.222..33.22',
    e5: '..11.33.333.33333..22.3333..33.',
    e6: '.22..22..111.22.11.22.1111.22.1',
    e7: '.22.11111.22.11..333.33..2222.1',
    e8: '2.11.22.11.22.11.11.33..222.333',
    e9: '11.333.222..222.33.111..111..22',
  } as Record<string, string>,
}

const CHAR_TO_SHIFT: Record<string, Shift> = { '1': 'S1', '2': 'S2', '3': 'S3', '.': 'OFF' }

export function decodeScheduleRow(encoded: string): Shift[] {
  return encoded.split('').map((c) => CHAR_TO_SHIFT[c] ?? 'OFF')
}
