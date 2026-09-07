import type { Employee, PerShift, ScheduleMatrix, WorkShift } from '../types'
import { WORK_SHIFTS } from '../types'

/**
 * Rule chia đều ca (áp dụng cho mọi nhân viên KHÔNG được xếp làm ca đêm):
 *  - gom nhân viên theo tập ca được phép làm (vd: làm cả 3 ca / không S3 / không S1);
 *    trong cùng một nhóm, số ca mỗi loại giữa người nhiều nhất và ít nhất chênh ≤ FAIR_SPREAD.
 *  - mỗi người được làm cả S1 lẫn S2 thì |S1 − S2| ≤ FAIR_SPREAD
 *    (người không làm S3 → S1 và S2 chia đều cho họ).
 *    Khi số người cần ở S1 ≠ S2 (need), S1/S2 được so theo TỶ LỆ need
 *    (vd need 3/2 → 9 S1 và 6 S2 là cân).
 */
export const FAIR_SPREAD = 2

export const allowedShiftsOf = (e: Employee): WorkShift[] =>
  WORK_SHIFTS.filter(
    (s) => !((s === 'S1' && e.no_s1) || (s === 'S2' && e.no_s2) || (s === 'S3' && e.no_s3)),
  )

/** nhân viên được xếp làm ca đêm — không thuộc phạm vi rule chia đều */
export const isNightEmployee = (e: Employee): boolean => e.prefer_night && !e.no_s3

export type ShiftCount = Record<WorkShift, number>

export function countShifts(row: readonly string[] | undefined): ShiftCount {
  const c: ShiftCount = { S1: 0, S2: 0, S3: 0 }
  for (const s of row ?? []) if (s === 'S1' || s === 'S2' || s === 'S3') c[s]++
  return c
}

export interface FairnessGroup {
  /** tập ca được phép (vd 'S1,S2') hoặc 'night' cho nhóm ưu tiên ca đêm */
  key: string
  allowed: WorkShift[]
  members: Employee[]
  /** true → chỉ tính vào điểm mềm (không coi là vi phạm rule): nhóm ưu tiên đêm có quota khác nhau */
  softOnly?: boolean
}

/** gom nhân viên không làm đêm theo tập ca được phép */
export function fairnessGroups(employees: Employee[]): FairnessGroup[] {
  const map = new Map<string, FairnessGroup>()
  for (const e of employees) {
    const allowed = allowedShiftsOf(e)
    if (allowed.length === 0) continue
    // người ưu tiên đêm: đều nhau giữa họ (S1/S2/S3) nhưng chỉ ở mức mềm — quota mỗi người có thể khác
    const key = isNightEmployee(e) ? 'night' : allowed.join(',')
    const g = map.get(key) ?? { key, allowed, members: [], softOnly: isNightEmployee(e) }
    g.members.push(e)
    map.set(key, g)
  }
  return [...map.values()]
}

export interface FairnessResult {
  /** phần vượt ngưỡng cho phép — 0 nghĩa là rule ĐẠT */
  hard: number
  /** tổng chênh lệch thô — để tie-break giữa các phương án đều đạt */
  soft: number
  messages: string[]
  /** các cặp (id) đang lệch nhau nhất — gợi ý cho bước đánh bóng */
  pairs: [string, string][]
}

/** lệch S1 − S2 của một người, quy về thang "ca" theo tỷ lệ need S1:S2 */
export function s1s2Diff(c: ShiftCount, need?: PerShift): number {
  if (!need || need.S1 === need.S2 || need.S1 <= 0 || need.S2 <= 0) return Math.abs(c.S1 - c.S2)
  return Math.abs(c.S1 * need.S2 - c.S2 * need.S1) / Math.max(need.S1, need.S2)
}

export function evaluateFairness(
  employees: Employee[],
  countOf: (e: Employee) => ShiftCount,
  need?: PerShift,
): FairnessResult {
  let hard = 0
  let soft = 0
  const messages: string[] = []
  const pairs: [string, string][] = []
  for (const g of fairnessGroups(employees)) {
    const counts = g.members.map((e) => ({ e, c: countOf(e) }))
    if (counts.length > 1) {
      for (const t of g.allowed) {
        const hi = counts.reduce((a, b) => (b.c[t] > a.c[t] ? b : a))
        const lo = counts.reduce((a, b) => (b.c[t] < a.c[t] ? b : a))
        const spread = hi.c[t] - lo.c[t]
        if (!g.softOnly) hard += Math.max(0, spread - FAIR_SPREAD)
        soft += spread
        if (spread > 0) pairs.push([hi.e.id, lo.e.id])
        if (spread > FAIR_SPREAD && !g.softOnly) {
          messages.push(
            `Ca ${t} chia chưa đều: ${hi.e.name} ${hi.c[t]} ca vs ${lo.e.name} ${lo.c[t]} ca (chênh ${spread} > ${FAIR_SPREAD}).`,
          )
        }
      }
    }
    if (g.allowed.includes('S1') && g.allowed.includes('S2')) {
      for (const { e, c } of counts) {
        const diff = s1s2Diff(c, need)
        if (!g.softOnly) hard += Math.max(0, diff - FAIR_SPREAD)
        soft += diff * 0.3
        if (diff > FAIR_SPREAD && !g.softOnly) {
          messages.push(
            `${e.name}: ${c.S1} ca S1 vs ${c.S2} ca S2 — lệch ${Math.round(diff * 10) / 10} (> ${FAIR_SPREAD}).`,
          )
          // ghép với người trong nhóm lệch ngược chiều nhất
          const other = counts.reduce((a, b) =>
            (b.c.S1 - b.c.S2) * (c.S1 - c.S2) < (a.c.S1 - a.c.S2) * (c.S1 - c.S2) ? b : a,
          )
          if (other.e.id !== e.id) pairs.push([e.id, other.e.id])
        }
      }
    }
  }
  return { hard, soft, messages, pairs }
}

export function evaluateFairnessMatrix(
  employees: Employee[],
  matrix: ScheduleMatrix,
  need?: PerShift,
): FairnessResult {
  return evaluateFairness(employees, (e) => countShifts(matrix[e.id]), need)
}

/** tóm tắt khoảng số ca mỗi loại theo từng nhóm — hiển thị khi rule đạt */
export function fairnessSummary(employees: Employee[], matrix: ScheduleMatrix): string[] {
  const label: Record<string, string> = {
    'S1,S2,S3': 'Làm cả 3 ca',
    'S1,S2': 'Không S3',
    'S1,S3': 'Không S2',
    'S2,S3': 'Không S1',
    night: 'Ưu tiên ca đêm',
  }
  return fairnessGroups(employees).map((g) => {
    const ranges = g.allowed.map((t) => {
      const ns = g.members.map((e) => countShifts(matrix[e.id])[t])
      const lo = Math.min(...ns)
      const hi = Math.max(...ns)
      return `${t}: ${lo === hi ? lo : `${lo}–${hi}`}`
    })
    return `${label[g.key] ?? `Chỉ ${g.key}`} (${g.members.length} người) · ${ranges.join(' · ')} ca/người`
  })
}

/**
 * Đánh bóng chia đều bằng cách HOÁN ĐỔI ĐOẠN LỊCH giữa 2 nhân viên không làm đêm:
 * đổi chéo đoạn ngày giữa 2 ranh giới cắt sao cho chuyển tiếp qua ranh giới vẫn hợp lệ
 * (cùng ca hoặc một bên OFF → nghỉ ≥16h giữ nguyên). Độ phủ từng ngày giữ nguyên theo cấu
 * trúc; chỉ cần kiểm tra lại độ dài chuỗi, ngày nghỉ cố định, ca được phép, ca tối đa và
 * cân bằng tổng ca (±1).
 * Iterated local search: xuống dốc (chỉ nhận cải thiện) → lắc ngẫu nhiên 1-2 hoán đổi → lặp,
 * giữ lại bản tốt nhất. Trả về số hoán đổi đã áp dụng.
 */
export function fairnessPolish(
  employees: Employee[],
  matrix: ScheduleMatrix,
  daysInMonth: number,
  streak: { streakMin: number; streakMax: number; restMax: number },
  rng: () => number = Math.random,
  deadline = Infinity,
  need?: PerShift,
): number {
  const D = daysInMonth
  // người làm đêm cũng tham gia, nhưng chỉ đổi đoạn KHÔNG chứa S3 và vẫn giữ ≥2 ca S1/S2
  const cands = employees.filter((e) => matrix[e.id] && allowedShiftsOf(e).length > 0)
  if (cands.length < 2) return 0
  const allowed = new Map(cands.map((e) => [e.id, new Set(allowedShiftsOf(e))]))
  const offSet = new Map(cands.map((e) => [e.id, new Set(e.days_off)]))
  const totals = new Map(employees.map((e) => [e.id, (matrix[e.id] ?? []).filter((s) => s !== 'OFF').length]))
  const counts = new Map(cands.map((e) => [e.id, countShifts(matrix[e.id])]))

  // mọi chuỗi làm liên tục của row phải có độ dài trong [streakMin, streakMax];
  // chuỗi nghỉ giữa tháng (không chạm biên, không chứa ngày nghỉ đăng ký) không quá restMax
  const streaksOk = (row: readonly string[], e: Employee): boolean => {
    const off = offSet.get(e.id)!
    let run = 0
    let rest = 0
    let restHasRequested = false
    for (let d = 0; d <= D; d++) {
      const working = d < D && row[d] !== 'OFF'
      if (working) {
        if (rest > 0 && rest > streak.restMax && !restHasRequested && rest !== d) return false
        rest = 0
        restHasRequested = false
        run++
      } else {
        if (run > 0 && (run < streak.streakMin || run > streak.streakMax)) return false
        run = 0
        if (d < D) {
          rest++
          if (off.has(d + 1)) restHasRequested = true
        }
      }
    }
    return true
  }
  const evalNow = () =>
    evaluateFairness(employees, (e) => counts.get(e.id) ?? countShifts(matrix[e.id]), need)
  const score = () => {
    const f = evalNow()
    return f.hard * 1000 + f.soft
  }

  interface Move {
    ea: Employee
    eb: Employee
    lo: number
    hi: number
    da: ShiftCount
    db: ShiftCount
    ta: number
    tb: number
  }
  /** kiểm tra khả thi đoạn [lo, hi) giữa a và b (chưa xét độ dài chuỗi) */
  const checkMove = (ea: Employee, eb: Employee, lo: number, hi: number): Move | null => {
    const ra = matrix[ea.id]
    const rb = matrix[eb.id]
    const da: ShiftCount = { S1: 0, S2: 0, S3: 0 }
    const db: ShiftCount = { S1: 0, S2: 0, S3: 0 }
    let same = true
    for (let d = lo; d < hi; d++) {
      const sa = ra[d]
      const sb = rb[d]
      if (sa !== sb) same = false
      if (sb !== 'OFF') {
        if (offSet.get(ea.id)!.has(d + 1) || !allowed.get(ea.id)!.has(sb)) return null
        db[sb]++
      }
      if (sa !== 'OFF') {
        if (offSet.get(eb.id)!.has(d + 1) || !allowed.get(eb.id)!.has(sa)) return null
        da[sa]++
      }
    }
    if (same) return null
    for (const [e, lose, gain] of [[ea, da, db], [eb, db, da]] as const) {
      if (!isNightEmployee(e)) continue
      if (lose.S3 !== gain.S3) return null
      const c = counts.get(e.id)!
      if (!e.no_s1 && c.S1 - lose.S1 + gain.S1 < 2) return null
      if (!e.no_s2 && c.S2 - lose.S2 + gain.S2 < 2) return null
    }
    const wa = da.S1 + da.S2 + da.S3
    const wb = db.S1 + db.S2 + db.S3
    const ta = totals.get(ea.id)! - wa + wb
    const tb = totals.get(eb.id)! - wb + wa
    if (ta > ea.max_shifts_per_month || tb > eb.max_shifts_per_month) return null
    if (wa !== wb) {
      let mx = Math.max(ta, tb)
      let mn = Math.min(ta, tb)
      for (const e of employees) {
        if (e.id === ea.id || e.id === eb.id) continue
        const t = totals.get(e.id)!
        if (t > mx) mx = t
        if (t < mn) mn = t
      }
      if (mx - mn > 1) return null
    }
    return { ea, eb, lo, hi, da, db, ta, tb }
  }
  const swapRows = (m: Move) => {
    const ra = matrix[m.ea.id]
    const rb = matrix[m.eb.id]
    for (let d = m.lo; d < m.hi; d++) {
      const t = ra[d]
      ra[d] = rb[d]
      rb[d] = t
    }
  }
  /** áp dụng move nếu accept(score mới) và chuỗi hợp lệ; trả về score mới hoặc null */
  const tryApply = (m: Move, accept: (next: number) => boolean): number | null => {
    const ca = counts.get(m.ea.id)!
    const cb = counts.get(m.eb.id)!
    counts.set(m.ea.id, { S1: ca.S1 - m.da.S1 + m.db.S1, S2: ca.S2 - m.da.S2 + m.db.S2, S3: ca.S3 - m.da.S3 + m.db.S3 })
    counts.set(m.eb.id, { S1: cb.S1 - m.db.S1 + m.da.S1, S2: cb.S2 - m.db.S2 + m.da.S2, S3: cb.S3 - m.db.S3 + m.da.S3 })
    const next = score()
    if (accept(next)) {
      swapRows(m)
      if (streaksOk(matrix[m.ea.id], m.ea) && streaksOk(matrix[m.eb.id], m.eb)) {
        totals.set(m.ea.id, m.ta)
        totals.set(m.eb.id, m.tb)
        return next
      }
      swapRows(m)
    }
    counts.set(m.ea.id, ca)
    counts.set(m.eb.id, cb)
    return null
  }
  // ranh giới cắt "sau ngày d": sau khi đổi chéo, chuyển tiếp d→d+1 ở cả 2 row phải hợp lệ
  // (cùng ca hoặc một bên OFF) — bao gồm mọi ngày hai người trùng giá trị và hơn thế
  const pairOk = (x: string, y: string) => x === 'OFF' || y === 'OFF' || x === y
  const cutsOf = (ea: Employee, eb: Employee): number[] => {
    const ra = matrix[ea.id]
    const rb = matrix[eb.id]
    const cuts: number[] = [-1]
    for (let d = 0; d < D - 1; d++) {
      if (pairOk(ra[d], rb[d + 1]) && pairOk(rb[d], ra[d + 1])) cuts.push(d)
    }
    cuts.push(D - 1)
    return cuts
  }

  let cur = score()
  let swaps = 0
  // xuống dốc: quét mọi cặp × mọi đoạn, nhận cải thiện đầu tiên, lặp tới khi hết cải thiện
  const descend = () => {
    let improved = true
    while (improved && cur > 0 && Date.now() < deadline) {
      improved = false
      for (let a = 0; a < cands.length && !improved; a++) {
        for (let b = a + 1; b < cands.length && !improved; b++) {
          const cuts = cutsOf(cands[a], cands[b])
          for (let ci = 0; ci < cuts.length - 1 && !improved; ci++) {
            for (let cj = ci + 1; cj < cuts.length && !improved; cj++) {
              const m = checkMove(cands[a], cands[b], cuts[ci] + 1, cuts[cj] + 1)
              if (!m) continue
              const next = tryApply(m, (n) => n < cur - 1e-9)
              if (next !== null) {
                cur = next
                swaps++
                improved = true
              }
            }
          }
        }
      }
    }
  }

  descend()
  let best = { score: cur, rows: cands.map((e) => matrix[e.id].slice()) }
  const restoreBest = () => {
    cands.forEach((e, i) => {
      matrix[e.id] = best.rows[i].slice()
      counts.set(e.id, countShifts(matrix[e.id]))
      totals.set(e.id, matrix[e.id].filter((s) => s !== 'OFF').length)
    })
    cur = best.score
  }
  // iterated local search: lắc 1-2 hoán đổi ngẫu nhiên (không tệ hơn bản tốt nhất quá
  // 2 bậc hard) rồi xuống dốc lại; giữ bản tốt nhất
  const byId = new Map(cands.map((e) => [e.id, e]))
  for (let iter = 0; iter < 200 && best.score >= 1 && Date.now() < deadline; iter++) {
    const kicks = 1 + Math.floor(rng() * 2)
    let kicked = 0
    const hot = evalNow().pairs
    for (let k = 0; k < kicks * 20 && kicked < kicks; k++) {
      let ea: Employee | undefined
      let eb: Employee | undefined
      if (hot.length > 0 && rng() < 0.6) {
        // nhắm vào cặp đang lệch nhau (một người nhiều, một người ít cùng loại ca)
        const [x, y] = hot[Math.floor(rng() * hot.length)]
        ea = byId.get(x)
        eb = byId.get(y)
      } else {
        const a = Math.floor(rng() * cands.length)
        const b = Math.floor(rng() * cands.length)
        if (a === b) continue
        ea = cands[a]
        eb = cands[b]
      }
      if (!ea || !eb || ea === eb) continue
      const cuts = cutsOf(ea, eb)
      const ci = Math.floor(rng() * (cuts.length - 1))
      const cj = ci + 1 + Math.floor(rng() * (cuts.length - 1 - ci))
      const m = checkMove(ea, eb, cuts[ci] + 1, cuts[cj] + 1)
      if (!m) continue
      const limit = Math.floor(best.score / 1000) * 1000 + 2000
      const next = tryApply(m, (n) => n < limit)
      if (next !== null) {
        cur = next
        kicked++
      }
    }
    if (kicked === 0) continue
    descend()
    if (cur < best.score - 1e-9) {
      best = { score: cur, rows: cands.map((e) => matrix[e.id].slice()) }
    } else {
      restoreBest()
    }
  }
  if (cur > best.score + 1e-9) restoreBest()
  return swaps
}
