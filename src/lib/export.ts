import ExcelJS from 'exceljs'
import type { Employee, ScheduleMatrix, Shift } from './types'
import { WEEKDAY_VI, WORK_SHIFTS, daysInMonth, weekdayOf } from './types'

const FILL: Record<Shift, string> = {
  S1: 'FFFFFF00', // vàng
  S2: 'FF92D050', // xanh lá
  S3: 'FFED7D31', // cam
  OFF: 'FFF2F2F2', // xám nhạt
}
const WEEKEND_FILL = 'FFFFF2CC'

function summaryRows(employees: Employee[], matrix: ScheduleMatrix, D: number, minPer: number) {
  const counts = WORK_SHIFTS.map((s) =>
    Array.from({ length: D }, (_, d) => employees.filter((e) => matrix[e.id]?.[d] === s).length),
  )
  const check = Array.from({ length: D }, (_, d) =>
    WORK_SHIFTS.every((_, i) => counts[i][d] >= minPer) ? 'OK' : 'LOW',
  )
  return { counts, check }
}

export async function exportXlsx(
  employees: Employee[],
  matrix: ScheduleMatrix,
  month: number,
  year: number,
  minPer: number,
): Promise<void> {
  const D = daysInMonth(month, year)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`T${month}-${year}`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] })

  // hàng 1: thứ; hàng 2: ngày
  const head1 = ['Mã NV', 'Họ tên']
  const head2 = ['', '']
  for (let d = 1; d <= D; d++) {
    head1.push(WEEKDAY_VI[weekdayOf(d, month, year)])
    head2.push(String(d))
  }
  head1.push('S1', 'S2', 'S3', 'OFF', 'Tổng')
  head2.push('', '', '', '', '')
  ws.addRow(head1)
  ws.addRow(head2)

  for (const e of employees) {
    const row = matrix[e.id] ?? []
    const s1 = row.filter((s) => s === 'S1').length
    const s2 = row.filter((s) => s === 'S2').length
    const s3 = row.filter((s) => s === 'S3').length
    const off = row.filter((s) => s === 'OFF').length
    ws.addRow([e.code, e.name, ...row.map((s) => (s === 'OFF' ? 'OFF' : s)), s1, s2, s3, off, s1 + s2 + s3])
  }

  const { counts, check } = summaryRows(employees, matrix, D, minPer)
  WORK_SHIFTS.forEach((s, i) => ws.addRow(['', `Số người ${s}`, ...counts[i]]))
  ws.addRow(['', 'Kiểm tra', ...check])

  // style
  ws.getColumn(1).width = 8
  ws.getColumn(2).width = 20
  for (let c = 3; c <= 2 + D; c++) ws.getColumn(c).width = 4.5
  for (let c = 3 + D; c <= 7 + D; c++) ws.getColumn(c).width = 6

  const border = {
    top: { style: 'thin' as const },
    bottom: { style: 'thin' as const },
    left: { style: 'thin' as const },
    right: { style: 'thin' as const },
  }

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    for (let c = 1; c <= 7 + D; c++) {
      const cell = row.getCell(c)
      cell.border = border
      cell.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle' }
      if (r <= 2) {
        cell.font = { bold: true, size: 9 }
        if (c >= 3 && c <= 2 + D) {
          const wd = weekdayOf(c - 2, month, year)
          if (wd === 0 || wd === 6) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKEND_FILL } }
          }
        }
      } else if (r <= 2 + employees.length && c >= 3 && c <= 2 + D) {
        const v = String(cell.value ?? '')
        const shift: Shift = v === 'S1' || v === 'S2' || v === 'S3' ? (v as Shift) : 'OFF'
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[shift] } }
        cell.font = { size: 9, bold: shift !== 'OFF' }
        if (shift === 'OFF') cell.value = ''
      } else if (r > 2 + employees.length) {
        cell.font = { size: 9, italic: c === 2 }
        if (String(cell.value) === 'LOW') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }
          cell.font = { size: 9, bold: true, color: { argb: 'FF9C0006' } }
        }
      } else {
        cell.font = { size: 10 }
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf]), `lich-ca-${year}-${String(month).padStart(2, '0')}.xlsx`)
}

export function exportCsv(
  employees: Employee[],
  matrix: ScheduleMatrix,
  month: number,
  year: number,
  minPer: number,
): void {
  const D = daysInMonth(month, year)
  const lines: string[] = []
  lines.push(['Mã NV', 'Họ tên', ...Array.from({ length: D }, (_, d) => WEEKDAY_VI[weekdayOf(d + 1, month, year)]), 'S1', 'S2', 'S3', 'OFF', 'Tổng'].join(','))
  lines.push(['', '', ...Array.from({ length: D }, (_, d) => String(d + 1)), '', '', '', '', ''].join(','))
  for (const e of employees) {
    const row = matrix[e.id] ?? []
    const s1 = row.filter((s) => s === 'S1').length
    const s2 = row.filter((s) => s === 'S2').length
    const s3 = row.filter((s) => s === 'S3').length
    const off = row.filter((s) => s === 'OFF').length
    lines.push([e.code, `"${e.name}"`, ...row, s1, s2, s3, off, s1 + s2 + s3].join(','))
  }
  const { counts, check } = summaryRows(employees, matrix, D, minPer)
  WORK_SHIFTS.forEach((s, i) => lines.push(['', `So nguoi ${s}`, ...counts[i]].join(',')))
  lines.push(['', 'Kiem tra', ...check].join(','))
  // BOM để Excel đọc đúng UTF-8 tiếng Việt
  download(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `lich-ca-${year}-${String(month).padStart(2, '0')}.csv`)
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
