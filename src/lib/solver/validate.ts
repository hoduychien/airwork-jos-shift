import type {
  Employee,
  PerShift,
  ScheduleMatrix,
  Shift,
  Violation,
} from '../types'
import { WORK_SHIFTS, carryOf } from '../types'

export interface ValidateOptions {
  employees: Employee[]
  matrix: ScheduleMatrix
  daysInMonth: number
  /** số người cần có ở từng ca */
  minPerShift: PerShift
  streakMin: number
  streakMax: number
  restMax: number
  /** bỏ qua kiểm tra cân bằng tổng ca (dùng khi đang chỉnh tay dở) */
  skipBalance?: boolean
  /** vài ngày cuối tháng trước của từng người — kiểm tra chỗ nối giữa 2 tháng */
  prevTail?: Record<string, Shift[]>
}

const SHIFT_VI: Record<Shift, string> = {
  S1: 'ca sáng (S1)',
  S2: 'ca chiều (S2)',
  S3: 'ca đêm (S3)',
  OFF: 'nghỉ',
}

/** Số giờ nghỉ giữa ca X hôm trước và ca Y hôm sau (2 ngày liền kề). */
export function restHoursBetween(prev: Shift, next: Shift): number {
  const END: Record<string, number> = { S1: 14, S2: 22, S3: 30 } // giờ kết thúc tính từ 0h ngày trước
  const START: Record<string, number> = { S1: 6, S2: 14, S3: 22 }
  if (prev === 'OFF' || next === 'OFF') return Infinity
  return START[next] + 24 - END[prev]
}

/**
 * Kiểm tra toàn bộ ràng buộc cứng trên một ma trận lịch.
 * Trả về danh sách vi phạm — mảng rỗng nghĩa là lịch hợp lệ.
 */
export function validateMatrix(opts: ValidateOptions): Violation[] {
  // restMax không dùng ở đây nữa — nghỉ dài là hợp lệ, restMax chỉ định hướng solver
  const { employees, matrix, daysInMonth: D, minPerShift, streakMin, streakMax, prevTail } = opts
  const out: Violation[] = []

  for (const emp of employees) {
    const row = matrix[emp.id]
    if (!row) continue
    const offSet = new Set(emp.days_off)

    // 0) nối với tháng trước: ngày cuối tháng trước → ngày 1 phải cùng ca (hoặc nghỉ),
    //    và chuỗi làm kéo dài qua tháng không được vượt streakMax
    const carry = carryOf(prevTail?.[emp.id])
    if (carry && row[0] !== 'OFF') {
      if (row[0] !== carry.shift) {
        const rest = restHoursBetween(carry.shift, row[0])
        out.push({
          type: 'adjacent-switch',
          employee_id: emp.id,
          day: 1,
          shift: row[0],
          message: `${emp.name}: cuối tháng trước làm ${carry.shift}, ngày 1 làm ${row[0]} — ${rest < 16 ? `chỉ nghỉ ${rest}h (< 16h)` : 'đổi ca mà không có ngày nghỉ đệm'}. Hai ngày làm liên tiếp phải cùng một ca.`,
        })
      } else {
        let k = 0
        while (k < D && row[k] === carry.shift) k++
        if (carry.run + k > streakMax) {
          out.push({
            type: 'streak-too-long',
            employee_id: emp.id,
            day: 1,
            message: `${emp.name}: làm ${carry.run + k} ngày liên tục nối từ tháng trước (${carry.run} ngày cuối tháng trước + ${k} ngày đầu tháng) — vượt tối đa ${streakMax} ngày.`,
          })
        }
      }
    }

    // 1) chuyển ca ngày liền kề phải cùng ca (đảm bảo nghỉ >= 16h)
    for (let d = 0; d < D - 1; d++) {
      const a = row[d]
      const b = row[d + 1]
      if (a !== 'OFF' && b !== 'OFF' && a !== b) {
        const rest = restHoursBetween(a, b)
        const reason =
          rest < 16
            ? `chỉ nghỉ ${rest}h (< 16h)`
            : 'đổi ca mà không có ngày nghỉ đệm'
        out.push({
          type: 'adjacent-switch',
          employee_id: emp.id,
          day: d + 2,
          shift: b,
          message: `${emp.name}: chuyển ${a}→${b} giữa ngày ${d + 1} và ${d + 2} — ${reason}. Hai ngày làm liên tiếp phải cùng một ca.`,
        })
      }
    }

    // 2) độ dài chuỗi làm việc và chuỗi nghỉ
    let d = 0
    while (d < D) {
      const isWork = row[d] !== 'OFF'
      let end = d
      while (end < D && (row[end] !== 'OFF') === isWork) end++
      const len = end - d
      const touchesEdge = d === 0 || end === D
      if (isWork) {
        // chuỗi đầu tháng nối từ tháng trước đã được chấm ở mục 0
        if (len > streakMax && !(d === 0 && carry && row[0] === carry.shift)) {
          out.push({
            type: 'streak-too-long',
            employee_id: emp.id,
            day: d + 1,
            message: `${emp.name}: làm ${len} ngày liên tục (ngày ${d + 1}–${end}) — vượt tối đa ${streakMax} ngày.`,
          })
        }
        if (len < streakMin && !touchesEdge) {
          out.push({
            type: 'streak-too-short',
            employee_id: emp.id,
            day: d + 1,
            message: `${emp.name}: chuỗi làm chỉ ${len} ngày (ngày ${d + 1}) — tối thiểu ${streakMin} ngày liên tục cùng một ca.`,
          })
        }
      }
      // nghỉ liên tục dài quá restMax KHÔNG còn là vi phạm — nhân viên được phép
      // nghỉ nhiều ngày liền (restMax chỉ là mục tiêu mềm khi solver xếp lịch)
      d = end
    }

    // 3) preferences: cấm ca
    for (let day = 0; day < D; day++) {
      const s = row[day]
      if (
        (s === 'S1' && emp.no_s1) ||
        (s === 'S2' && emp.no_s2) ||
        (s === 'S3' && emp.no_s3)
      ) {
        out.push({
          type: 'pref-no-shift',
          employee_id: emp.id,
          day: day + 1,
          shift: s,
          message: `${emp.name}: được xếp ${SHIFT_VI[s]} ngày ${day + 1} nhưng đã đăng ký KHÔNG làm ca này.`,
        })
      }
      if (s !== 'OFF' && offSet.has(day + 1)) {
        out.push({
          type: 'pref-day-off',
          employee_id: emp.id,
          day: day + 1,
          shift: s,
          message: `${emp.name}: ngày ${day + 1} đã đăng ký nghỉ cố định nhưng vẫn bị xếp ${SHIFT_VI[s]}.`,
        })
      }
    }

    // 4) tổng ca tối đa + quota ca đêm
    const total = row.filter((s) => s !== 'OFF').length
    if (total > emp.max_shifts_per_month) {
      out.push({
        type: 'max-shifts',
        employee_id: emp.id,
        message: `${emp.name}: ${total} ca/tháng — vượt mức tối đa ${emp.max_shifts_per_month}.`,
      })
    }
    if (emp.prefer_night && !emp.no_s3) {
      // quota ca đêm là ƯU TIÊN MỀM: làm ít hơn số đã đăng ký không tính là vi phạm
      // (solver vẫn cố gắng đạt tối đa quota khi xếp lịch)
      // người ưu tiên ca đêm vẫn phải có 2-3 ca sáng và 2-3 ca chiều để không quên việc
      if (emp.min_night_shifts > 0) {
        const s1 = row.filter((s) => s === 'S1').length
        const s2 = row.filter((s) => s === 'S2').length
        if (!emp.no_s1 && s1 < 2) {
          out.push({
            type: 'min-night',
            employee_id: emp.id,
            message: `${emp.name}: chỉ có ${s1} ca sáng — người ưu tiên ca đêm vẫn cần 2-3 ca S1/tháng.`,
          })
        }
        if (!emp.no_s2 && s2 < 2) {
          out.push({
            type: 'min-night',
            employee_id: emp.id,
            message: `${emp.name}: chỉ có ${s2} ca chiều — người ưu tiên ca đêm vẫn cần 2-3 ca S2/tháng.`,
          })
        }
      }
    }
  }

  // 5) độ phủ mỗi ngày mỗi ca
  for (let day = 0; day < D; day++) {
    for (const s of WORK_SHIFTS) {
      let n = 0
      for (const emp of employees) {
        if (matrix[emp.id]?.[day] === s) n++
      }
      if (n < minPerShift[s]) {
        out.push({
          type: 'coverage',
          day: day + 1,
          shift: s,
          message: `Ngày ${day + 1}: ${SHIFT_VI[s]} chỉ có ${n}/${minPerShift[s]} người.`,
        })
      }
    }
  }

  // 6) cân bằng tổng ca (max − min ≤ 1)
  if (!opts.skipBalance && employees.length > 1) {
    const totals = employees.map((e) => ({
      emp: e,
      n: (matrix[e.id] ?? []).filter((s) => s !== 'OFF').length,
    }))
    const max = Math.max(...totals.map((t) => t.n))
    const min = Math.min(...totals.map((t) => t.n))
    if (max - min > 1) {
      const hi = totals.find((t) => t.n === max)!
      const lo = totals.find((t) => t.n === min)!
      out.push({
        type: 'balance',
        message: `Chênh lệch tổng ca ${max - min} (> 1): ${hi.emp.name} ${max} ca, ${lo.emp.name} ${min} ca.`,
      })
    }
  }

  return out
}

/** Gom vi phạm về từng ô để highlight: key = `${employeeId}:${day}` */
export function violationCellMap(
  violations: Violation[],
  employees: Employee[],
  matrix: ScheduleMatrix,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const push = (key: string, msg: string) => {
    const arr = map.get(key) ?? []
    if (!arr.includes(msg)) arr.push(msg)
    map.set(key, arr)
  }
  for (const v of violations) {
    if (v.employee_id && v.day) {
      push(`${v.employee_id}:${v.day}`, v.message)
    } else if (v.type === 'coverage' && v.day && v.shift) {
      // tô các ô đang giữ ca đó trong ngày thiếu người là không đúng —
      // coverage gắn vào cột (hàng summary), nhưng vẫn map để tooltip cột dùng
      push(`day:${v.day}:${v.shift}`, v.message)
    } else if (v.employee_id) {
      // vi phạm cấp-người (max-shifts, min-night): gắn vào mọi ô làm việc của người đó? — chỉ gắn vào tên
      push(`emp:${v.employee_id}`, v.message)
    }
  }
  // streak: tô cả chuỗi thay vì chỉ ngày đầu
  for (const v of violations) {
    if ((v.type === 'streak-too-long' || v.type === 'off-too-long') && v.employee_id && v.day) {
      const row = matrix[v.employee_id]
      if (!row) continue
      const isWork = v.type === 'streak-too-long'
      let d = v.day - 1
      while (d < row.length && (row[d] !== 'OFF') === isWork) {
        push(`${v.employee_id}:${d + 1}`, v.message)
        d++
      }
    }
  }
  void employees
  return map
}
