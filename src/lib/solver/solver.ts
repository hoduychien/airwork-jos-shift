import type {
  Employee,
  PerShift,
  ScheduleMatrix,
  Shift,
  SolverInput,
  SolverResult,
  WorkShift,
} from '../types'
import { WORK_SHIFTS, carryOf, needPerDay } from '../types'
import { evaluateFairness, evaluateFairnessMatrix, fairnessPolish, isNightEmployee, allowedShiftsOf } from './fairness'
import { validateMatrix } from './validate'

/**
 * Solver chia ca dạng constraint-based:
 *  - Pha 1: sinh pattern làm/nghỉ cho từng người (chuỗi làm 2-5 ngày, nghỉ 1-2 ngày,
 *    tôn trọng ngày nghỉ cố định, tổng ca cân bằng ±1) bằng DFS ngẫu nhiên hóa
 *    + greedy phủ các ngày còn thiếu người.
 *  - Pha 2: gán ca (S1/S2/S3) cho từng block bằng greedy + local search sửa lỗi.
 *  - Lặp lại nhiều lần (restart) với seed khác nhau, giữ phương án ít vi phạm nhất.
 *
 * Vì mỗi block chỉ có MỘT ca và các block cách nhau ít nhất 1 ngày nghỉ,
 * ràng buộc "2 ngày làm liên tiếp phải cùng ca" (nghỉ ≥ 16h) tự động thỏa mãn.
 */

// ---------- PRNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

/** thống kê debug (không dùng trong production UI) */
export const debugStats = { strictNodes: [] as number[], relaxedNodes: [] as number[], exactWins: 0, fallbacks: 0 }

function shuffled<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- feasibility diagnostics ----------
function diagnose(input: SolverInput): string[] {
  const { employees, daysInMonth: D, minPerShift } = input
  const conflicts: string[] = []
  const perDay = needPerDay(minPerShift)
  const needTotal = perDay * D

  const cap = (e: Employee) => Math.min(e.max_shifts_per_month, D - e.days_off.length)
  const capTotal = employees.reduce((s, e) => s + cap(e), 0)
  if (capTotal < needTotal) {
    conflicts.push(
      `Tổng công suất ${capTotal} ca < ${needTotal} ca cần thiết (${minPerShift.S1} + ${minPerShift.S2} + ${minPerShift.S3} người/ngày × ${D} ngày). Tăng số nhân viên, tăng "số ca tối đa/tháng" hoặc giảm số người mỗi ca.`,
    )
  }

  for (const s of WORK_SHIFTS) {
    const allowed = employees.filter(
      (e) => !((s === 'S1' && e.no_s1) || (s === 'S2' && e.no_s2) || (s === 'S3' && e.no_s3)),
    )
    if (allowed.length < minPerShift[s]) {
      conflicts.push(
        `Chỉ có ${allowed.length} người được phép làm ${s} nhưng mỗi ngày cần tối thiểu ${minPerShift[s]} người. Bỏ bớt ràng buộc "không làm ${s}" hoặc giảm số người ca ${s}.`,
      )
    } else {
      const capAllowed = allowed.reduce((sum, e) => sum + cap(e), 0)
      if (capAllowed < minPerShift[s] * D) {
        conflicts.push(
          `Nhóm được phép làm ${s} (${allowed.length} người) chỉ gánh được tối đa ${capAllowed} ca, cần ${minPerShift[s] * D} ca ${s}/tháng.`,
        )
      }
    }
  }

  for (let d = 1; d <= D; d++) {
    const avail = employees.filter((e) => !e.days_off.includes(d)).length
    if (avail < perDay) {
      conflicts.push(
        `Ngày ${d}: chỉ còn ${avail} người có thể đi làm (do nghỉ cố định) — cần ${perDay} người/ngày.`,
      )
    }
  }

  for (const e of employees) {
    if (e.no_s1 && e.no_s2 && e.no_s3) {
      conflicts.push(`${e.name}: bị chặn cả 3 ca — không thể xếp lịch cho người này.`)
    }
    if (e.prefer_night && e.no_s3) {
      conflicts.push(`${e.name}: vừa "ưu tiên ca đêm" vừa "không làm ca đêm" — mâu thuẫn.`)
    }
    if (e.prefer_night && e.min_night_shifts + 4 > e.max_shifts_per_month) {
      conflicts.push(
        `${e.name}: tối thiểu ${e.min_night_shifts} ca đêm + 2 ca S1 + 2 ca S2 vượt mức tối đa ${e.max_shifts_per_month} ca/tháng.`,
      )
    }
  }

  return conflicts
}

// ---------- phase 1: work/off patterns ----------
interface Block {
  empIdx: number
  start: number // 0-based
  len: number
}

/**
 * Sinh pattern làm/nghỉ cho một người bằng DFS ngẫu nhiên hóa.
 * Trả về mảng boolean work[D] có đúng `target` ngày làm (hoặc best-effort gần nhất).
 */
/** Chia `total` ngày thành các block độ dài [min..max], ưu tiên độ dài `pref`. */
export function splitLens(total: number, pref: number, min = 2, max = 5): number[] {
  const lens: number[] = []
  let rem = total
  while (rem > 0) {
    let take = Math.min(pref, rem)
    // tránh để lại phần dư < min
    if (rem - take > 0 && rem - take < min) {
      take = rem - min
      if (take < min) take = rem // total < min*2: một block duy nhất
    }
    if (take > max) take = max
    if (take < min && rem >= min) take = min
    lens.push(take)
    rem -= take
  }
  return lens
}

function buildPattern(
  D: number,
  target: number,
  fixedOff: Set<number>, // 1-based days
  colDeficit: number[], // perDay - colCount[d], càng cao càng nên phủ
  opts: {
    streakMin: number
    streakMax: number
    restMin: number
    restMax: number
    /** ép đúng dãy độ dài block (dùng cho người ưu tiên ca đêm) */
    fixedLens?: number[]
    /** số ngày đã làm liền ở cuối tháng trước (0 = ngày cuối tháng trước nghỉ) */
    carryRun?: number
  },
  rng: Rng,
  preferSmallTailBlocks: boolean,
): boolean[] | null {
  const { streakMin, streakMax, restMin, restMax } = opts
  const carryRun = opts.carryRun ?? 0
  let best: boolean[] | null = null
  let bestScore = -Infinity
  let nodes = 0
  const NODE_LIMIT = 6000

  const isOffDay = (d0: number) => fixedOff.has(d0 + 1)

  function finishScore(pattern: boolean[], rem: number): number {
    let s = -rem * 1000
    for (let d = 0; d < D; d++) if (pattern[d]) s += Math.max(colDeficit[d], -1)
    return s
  }

  function dfs(p: number, rem: number, pattern: boolean[], blkIdx: number): void {
    if (nodes++ > NODE_LIMIT) return
    if (p >= D || rem === 0) {
      // phần còn lại nghỉ hết — chạm biên cuối tháng nên được miễn giới hạn nghỉ
      const sc = finishScore(pattern, rem)
      if (sc > bestScore) {
        bestScore = sc
        best = pattern.slice()
      }
      if (rem === 0) return
      return
    }

    // liệt kê các lựa chọn (gap nghỉ g, block làm L)
    // đang dở chuỗi từ tháng trước mà đã đủ streakMax → ngày 1 bắt buộc nghỉ
    const gMin = p === 0 ? (carryRun >= streakMax ? restMin : 0) : restMin
    const gCap = Math.min(D - p, restMax + 10)
    const choices: { g: number; L: number; score: number }[] = []

    for (let g = gMin; g <= gCap; g++) {
      // gap dài quá restMax chỉ hợp lệ nếu chứa ngày nghỉ cố định hoặc ở đầu tháng
      if (g > restMax && p !== 0) {
        let hasFixed = false
        for (let d = p; d < p + g; d++) if (isOffDay(d)) hasFixed = true
        if (!hasFixed) break
      }
      const s = p + g // ngày bắt đầu block
      if (s >= D) break
      // block nối tiếp chuỗi tháng trước (bắt đầu ngày 0): chỉ được kéo thêm streakMax − carryRun ngày
      const cont = s === 0 && carryRun > 0
      const maxL = Math.min(cont ? streakMax - carryRun : streakMax, D - s, rem)
      const forcedL = opts.fixedLens?.[blkIdx]
      for (let L = 1; L <= maxL; L++) {
        // block nối tiếp không tính vào dãy block ép sẵn
        if (!cont && forcedL !== undefined && L !== Math.min(forcedL, maxL)) continue
        const end = s + L
        // block không được chứa ngày nghỉ cố định
        let blocked = false
        for (let d = s; d < end; d++) {
          if (isOffDay(d)) {
            blocked = true
            break
          }
        }
        if (blocked) break // kéo dài thêm cũng dính, dừng
        // block ngắn hơn streakMin chỉ được phép khi chạm cuối tháng (hoặc nối đủ với tháng trước)
        if (L < streakMin && end < D && !(cont && carryRun + L >= streakMin)) continue
        // prune: phần target còn lại phải nhét vừa số ngày còn lại của tháng
        const remLeft = rem - L
        if (remLeft > 0) {
          const minDaysNeeded =
            remLeft + Math.max(0, Math.ceil(remLeft / streakMax) - 1) * restMin + restMin
          if (D - end < minDaysNeeded) continue
        }
        // ngày ngay sau block phải nghỉ được (luôn được — gap kế tiếp ≥ restMin)
        let score = 0
        for (let d = s; d < end; d++)
          score += (colDeficit[d] > 0 ? colDeficit[d] * 6 : -10) + rng() * 0.5
        score -= g > restMax ? 0 : 0
        // ưu tiên block nhỏ ở cuối cho người ưu tiên ca đêm (để dễ chèn 2-3 ca S1/S2)
        if (preferSmallTailBlocks) {
          // người ưu tiên ca đêm: block giữa cỡ 4-5 (dồn S3), chốt bằng 2 block nhỏ 2-3
          // (một S1, một S2) để đủ "2-3 ca sáng + 2-3 ca chiều"
          const remAfter = rem - L
          if (remAfter > 0 && remAfter < streakMin) score -= 50
          if (rem > 6 && L === 4) score += 6
          if (rem <= 6 && L > 3) score -= 30
          if (rem >= 4 && rem <= 6 && L >= 2 && L <= 3) score += 6
        } else {
          const remAfter = rem - L
          if (remAfter > 0 && remAfter < streakMin) score -= 50
          // block 3-4 ngày cho nhiều điểm cắt hơn → pha tô ca dễ xoay xở hơn
          if (L === 3 || L === 4) score += 3
          if (L === 5) score -= 2
        }
        choices.push({ g, L, score })
      }
    }

    // hết đường: chốt pattern hiện tại (best effort)
    if (choices.length === 0) {
      const sc = finishScore(pattern, rem)
      if (sc > bestScore) {
        bestScore = sc
        best = pattern.slice()
      }
      return
    }

    choices.sort((a, b) => b.score - a.score)
    const tryN = Math.min(choices.length, 4)
    for (let i = 0; i < tryN; i++) {
      const { g, L } = choices[i]
      const s = p + g
      for (let d = s; d < s + L; d++) pattern[d] = true
      dfs(s + L, rem - L, pattern, s === 0 && carryRun > 0 ? blkIdx : blkIdx + 1)
      for (let d = s; d < s + L; d++) pattern[d] = false
      if (bestScore >= -0.001 && best && countWork(best) === target) {
        // đã có nghiệm đạt target với điểm dương — vẫn thử thêm 1 nhánh cho đa dạng
        if (i >= 1) return
      }
    }
  }

  function countWork(p: boolean[]): number {
    return p.reduce((s, w) => s + (w ? 1 : 0), 0)
  }

  dfs(0, target, new Array<boolean>(D).fill(false), 0)
  return best
}

/** Block lens có cho phép chọn 2 block làm S1/S2 mà phần còn lại vẫn đủ quota đêm không. */
function designable(pattern: boolean[], quota: number): boolean {
  const lens: number[] = []
  let d = 0
  while (d < pattern.length) {
    if (pattern[d]) {
      let e = d
      while (e < pattern.length && pattern[e]) e++
      lens.push(e - d)
      d = e
    } else d++
  }
  const total = lens.reduce((s, l) => s + l, 0)
  for (let i = 0; i < lens.length; i++) {
    for (let j = i + 1; j < lens.length; j++) {
      if (lens[i] >= 2 && lens[j] >= 2 && total - lens[i] - lens[j] >= quota) return true
    }
  }
  return false
}

/** Trích các block làm việc liên tục từ pattern boolean. */
function extractBlocks(patterns: boolean[][], D: number): Block[] {
  const blocks: Block[] = []
  patterns.forEach((row, empIdx) => {
    let d = 0
    while (d < D) {
      if (row[d]) {
        let end = d
        while (end < D && row[end]) end++
        blocks.push({ empIdx, start: d, len: end - d })
        d = end
      } else d++
    }
  })
  return blocks
}

// ---------- phase 2: shift assignment ----------
interface Phase2Result {
  shiftOf: (Shift | null)[]
  cost: number
}

function assignShifts(
  blocks: Block[],
  employees: Employee[],
  D: number,
  minPer: PerShift,
  rng: Rng,
  initialShifts?: (Shift | null)[],
): Phase2Result {
  const allowedOf = (e: Employee): WorkShift[] =>
    WORK_SHIFTS.filter(
      (s) => !((s === 'S1' && e.no_s1) || (s === 'S2' && e.no_s2) || (s === 'S3' && e.no_s3)),
    )
  // block bắt đầu ngày 0 của người đang dở chuỗi từ tháng trước: bắt buộc cùng ca với ngày cuối tháng trước
  const allowedFor = (bi: number): WorkShift[] => {
    const b = blocks[bi]
    const e = employees[b.empIdx]
    const a = allowedOf(e)
    if (b.start === 0 && e.carry_in) return a.filter((x) => x === e.carry_in!.shift)
    return a
  }
  const empIndex = new Map(employees.map((e, i) => [e.id, i]))
  const blocksOfEmp: number[][] = employees.map(() => [])
  blocks.forEach((b, i) => blocksOfEmp[b.empIdx].push(i))
  for (const list of blocksOfEmp) list.sort((a, b) => blocks[a].start - blocks[b].start)

  // phần chia công bằng từng loại ca cho nhóm không ràng buộc — mọi nhánh gán ca
  // (exact, greedy, polish) đều bám theo để chia đều S1/S2/S3
  const targetsFromBlocks = employees.map((_, i) =>
    blocksOfEmp[i].reduce((s, bi) => s + blocks[bi].len, 0),
  )
  const fairShare = computeFairShare(employees, targetsFromBlocks, D, minPer)

  // người ưu tiên ca đêm: chỉ định trước 2 block (nhỏ, ưu tiên 2-3 ngày) làm S1/S2
  // sao cho các block còn lại vẫn đủ quota ca đêm — tránh greedy "nuốt" hết vào S3
  const designatedNonNight = new Set<number>()
  employees.forEach((e, i) => {
    if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return
    const list = blocksOfEmp[i]
    const total = list.reduce((s, bi) => s + blocks[bi].len, 0)
    let bestPair: [number, number] | null = null
    let bestScore = Infinity
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const la = blocks[list[a]].len
        const lb = blocks[list[b]].len
        const rest = total - la - lb
        const sizePenalty = (l: number) => (l >= 2 && l <= 3 ? 0 : Math.abs(l - 3) * 3 + (l < 2 ? 10 : 0))
        // hụt quota đêm bị phạt cực nặng — chỉ chấp nhận khi không còn cặp nào tốt hơn
        const shortfall = Math.max(0, e.min_night_shifts - rest)
        const score = shortfall * 1000 + sizePenalty(la) + sizePenalty(lb) + Math.max(0, rest - e.min_night_shifts)
        if (score < bestScore) {
          bestScore = score
          bestPair = [list[a], list[b]]
        }
      }
    }
    if (bestPair) {
      designatedNonNight.add(bestPair[0])
      designatedNonNight.add(bestPair[1])
    }
  })

  // người KHÔNG ràng buộc: chỉ định 1 block có độ dài sát fair share S3 làm "block đêm"
  // — cả phần S3 của họ gói gọn một block thì spread S3 chỉ còn chênh độ dài block
  const designatedS3 = new Set<number>()
  employees.forEach((e, i) => {
    if (e.prefer_night || e.no_s1 || e.no_s2 || e.no_s3) return
    const list = blocksOfEmp[i]
    if (list.length === 0) return
    let bestBi = list[0]
    let bestDiff = Infinity
    for (const bi of list) {
      const diff = Math.abs(blocks[bi].len - fairShare[i].S3)
      if (diff < bestDiff) {
        bestDiff = diff
        bestBi = bi
      }
    }
    designatedS3.add(bestBi)
  })

  const shiftOf: (Shift | null)[] = new Array(blocks.length).fill(null)
  // count[s][d]
  const count: Record<WorkShift, number[]> = {
    S1: new Array<number>(D).fill(0),
    S2: new Array<number>(D).fill(0),
    S3: new Array<number>(D).fill(0),
  }
  const perEmp: Record<WorkShift, number>[] = employees.map(() => ({ S1: 0, S2: 0, S3: 0 }))

  const apply = (bi: number, s: WorkShift, sign: 1 | -1) => {
    const b = blocks[bi]
    for (let d = b.start; d < b.start + b.len; d++) count[s][d] += sign
    perEmp[b.empIdx][s] += sign * b.len
  }

  // hàm chi phí toàn cục (soft objectives + phạt vi phạm cứng)
  const costOf = (): number => {
    let c = 0
    for (const s of WORK_SHIFTS) {
      for (let d = 0; d < D; d++) {
        const deficit = minPer[s] - count[s][d]
        if (deficit > 0) c += deficit * deficit * 100
      }
    }
    employees.forEach((e, i) => {
      if (e.prefer_night && !e.no_s3) {
        const short = e.min_night_shifts - perEmp[i].S3
        if (short > 0) c += short * 400
        if (!e.no_s1 && perEmp[i].S1 < 2) c += (2 - perEmp[i].S1) * 80
        if (!e.no_s2 && perEmp[i].S2 < 2) c += (2 - perEmp[i].S2) * 80
      }
    })
    // rule chia đều: từng loại ca trong từng nhóm nhân viên không làm đêm + |S1−S2| mỗi người
    const fair = evaluateFairness(employees, (e) => perEmp[empIndex.get(e.id)!], minPer)
    c += fair.hard * 12 + fair.soft * 0.3
    return c
  }

  // hoán đổi màu 2 block TRÙNG KHỚP phạm vi ngày của 2 người khác nhau —
  // coverage bất biến theo cấu trúc, là lối thoát duy nhất để chia đều từng
  // loại ca khi mọi ngày đều sát nút chỉ tiêu người (flip đơn lẻ luôn bị chặn)
  const alignedPairs: [number, number][] = []
  {
    const byRange = new Map<string, number[]>()
    blocks.forEach((b, i) => {
      const k = `${b.start}:${b.len}`
      const arr = byRange.get(k) ?? []
      arr.push(i)
      byRange.set(k, arr)
    })
    for (const arr of byRange.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) alignedPairs.push([arr[i], arr[j]])
      }
    }
  }
  const tryAlignedSwap = (curCost: number): number | null => {
    // 70% chọn cặp trùng phạm vi (coverage bất biến), 30% cặp bất kỳ —
    // costOf phạt thiếu độ phủ ×100 nên swap tạo lỗ luôn bị từ chối
    let bi: number
    let bj: number
    if (alignedPairs.length > 0 && rng() < 0.7) {
      ;[bi, bj] = alignedPairs[Math.floor(rng() * alignedPairs.length)]
    } else {
      bi = Math.floor(rng() * blocks.length)
      bj = Math.floor(rng() * blocks.length)
      if (bi === bj) return null
    }
    const si = shiftOf[bi]
    const sj = shiftOf[bj]
    if (!si || !sj || si === sj || si === 'OFF' || sj === 'OFF') return null
    if (!allowedFor(bi).includes(sj as WorkShift) || !allowedFor(bj).includes(si as WorkShift)) return null
    apply(bi, si as WorkShift, -1)
    apply(bj, sj as WorkShift, -1)
    apply(bi, sj as WorkShift, 1)
    apply(bj, si as WorkShift, 1)
    const after = costOf()
    // chấp nhận ngang giá ~25% và tệ hơn chút ít ~6% (annealing nhẹ) để thoát cực trị
    if (
      after < curCost ||
      (after === curCost && curCost > 0 && rng() < 0.25) ||
      (after < curCost + 3 && curCost > 0 && rng() < 0.06)
    ) {
      shiftOf[bi] = sj
      shiftOf[bj] = si
      return after
    }
    apply(bi, sj as WorkShift, -1)
    apply(bj, si as WorkShift, -1)
    apply(bi, si as WorkShift, 1)
    apply(bj, sj as WorkShift, 1)
    return null
  }

  // quét 2-opt xác định: thử đổi màu từng block + hoán đổi mọi cặp block,
  // chỉ nhận cải thiện chặt — hội tụ nhanh, vét sạch những gì stochastic bỏ sót
  const sweep2opt = (): number => {
    let cost = costOf()
    for (let sweep = 0; sweep < 6 && cost > 0; sweep++) {
      let improved = false
      for (let bi = 0; bi < blocks.length; bi++) {
        const si = shiftOf[bi]
        if (!si || si === 'OFF') continue
        // flip đơn
        for (const s of allowedFor(bi)) {
          if (s === si) continue
          apply(bi, si as WorkShift, -1)
          apply(bi, s, 1)
          const c2 = costOf()
          if (c2 < cost) {
            shiftOf[bi] = s
            cost = c2
            improved = true
            break
          }
          apply(bi, s, -1)
          apply(bi, si as WorkShift, 1)
        }
        const siNow = shiftOf[bi]
        if (!siNow || siNow === 'OFF') continue
        // hoán đổi cặp
        for (let bj = bi + 1; bj < blocks.length; bj++) {
          const sj = shiftOf[bj]
          if (!sj || sj === 'OFF' || sj === siNow) continue
          if (!allowedFor(bi).includes(sj as WorkShift) || !allowedFor(bj).includes(siNow as WorkShift)) continue
          apply(bi, siNow as WorkShift, -1)
          apply(bj, sj as WorkShift, -1)
          apply(bi, sj as WorkShift, 1)
          apply(bj, siNow as WorkShift, 1)
          const c2 = costOf()
          if (c2 < cost) {
            shiftOf[bi] = sj
            shiftOf[bj] = siNow
            cost = c2
            improved = true
            break
          }
          apply(bi, sj as WorkShift, -1)
          apply(bj, siNow as WorkShift, -1)
          apply(bi, siNow as WorkShift, 1)
          apply(bj, sj as WorkShift, 1)
        }
      }
      if (!improved) break
    }
    return cost
  }

  // ---- hạ tầng chain-repair (augmenting path, có rollback) — dùng chung 2 nhánh ----
  // mức vi phạm preference của một người — chain repair không được làm TỆ HƠN
  const prefViol = (empIdx: number): number => {
    const e = employees[empIdx]
    if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return 0
    return (
      Math.max(0, e.min_night_shifts - perEmp[empIdx].S3) * 10 +
      (e.no_s1 ? 0 : Math.max(0, 2 - perEmp[empIdx].S1)) +
      (e.no_s2 ? 0 : Math.max(0, 2 - perEmp[empIdx].S2))
    )
  }
  const snapshot = () => ({
    shiftOf: shiftOf.slice(),
    count: { S1: count.S1.slice(), S2: count.S2.slice(), S3: count.S3.slice() },
    perEmp: perEmp.map((x) => ({ ...x })),
  })
  const restore = (s: ReturnType<typeof snapshot>) => {
    for (let i = 0; i < shiftOf.length; i++) shiftOf[i] = s.shiftOf[i]
    for (const k of WORK_SHIFTS) for (let d = 0; d < D; d++) count[k][d] = s.count[k][d]
    s.perEmp.forEach((x, i) => {
      perEmp[i].S1 = x.S1
      perEmp[i].S2 = x.S2
      perEmp[i].S3 = x.S3
    })
  }
  function fixDeficit(day: number, sNeed: WorkShift, depth: number, visited: Set<number>): boolean {
    if (count[sNeed][day] >= minPer[sNeed]) return true
    if (depth > 6) return false
    for (const bi of shuffled(blocks.map((_, i) => i), rng)) {
      const b = blocks[bi]
      if (visited.has(bi)) continue
      if (day < b.start || day >= b.start + b.len) continue
      const sOld = shiftOf[bi]
      if (sOld === null || sOld === sNeed || sOld === 'OFF') continue
      if (!allowedFor(bi).includes(sNeed)) continue
      const violBefore = prefViol(b.empIdx)
      const snap = snapshot()
      apply(bi, sOld as WorkShift, -1)
      apply(bi, sNeed, 1)
      shiftOf[bi] = sNeed
      visited.add(bi)
      let ok = prefViol(b.empIdx) <= violBefore
      if (ok) {
        for (let k = b.start; k < b.start + b.len && ok; k++) {
          if (count[sOld as WorkShift][k] < minPer[sOld as WorkShift]) {
            ok = fixDeficit(k, sOld as WorkShift, depth + 1, visited)
          }
        }
      }
      if (ok) return true
      restore(snap)
      visited.delete(bi)
    }
    return false
  }
  const runDeficitPasses = (passes: number) => {
    for (let pass = 0; pass < passes; pass++) {
      let anyDeficit = false
      for (const s of WORK_SHIFTS) {
        for (let d = 0; d < D; d++) {
          if (count[s][d] < minPer[s]) {
            anyDeficit = true
            fixDeficit(d, s, 0, new Set())
          }
        }
      }
      if (!anyDeficit) break
    }
  }

  // vá preference người ưu tiên ca đêm: thiếu quota S3, hoặc thiếu 2 ca S1/S2 bắt buộc
  const fixPreferNight = () => {
    employees.forEach((e, ei) => {
      if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return

      // 1) thiếu quota đêm: flip các block ngoài cặp chỉ định về S3, vá coverage dây chuyền
      if (perEmp[ei].S3 < e.min_night_shifts) {
        const candidates = blocksOfEmp[ei]
          .filter((bi) => {
            const sOld = shiftOf[bi]
            if (sOld === null || sOld === 'OFF' || sOld === 'S3') return false
            if (designatedNonNight.has(bi)) return false
            return true
          })
          .sort((a, b) => blocks[b].len - blocks[a].len)
        for (const bi of candidates) {
          if (perEmp[ei].S3 >= e.min_night_shifts) break
          const sOld = shiftOf[bi] as WorkShift
          const snap = snapshot()
          apply(bi, sOld, -1)
          apply(bi, 'S3', 1)
          shiftOf[bi] = 'S3'
          let ok = true
          const b = blocks[bi]
          for (let k = b.start; k < b.start + b.len && ok; k++) {
            if (count[sOld][k] < minPer[sOld]) ok = fixDeficit(k, sOld, 0, new Set([bi]))
          }
          if (!ok) restore(snap)
        }
      }

      // 2) thiếu ca S1/S2 bắt buộc: flip một block nhỏ sang ca thiếu, giữ quota đêm
      for (const sNeed of ['S1', 'S2'] as WorkShift[]) {
        if ((sNeed === 'S1' && e.no_s1) || (sNeed === 'S2' && e.no_s2)) continue
        if (perEmp[ei][sNeed] >= 2) continue
        const candidates = blocksOfEmp[ei]
          .filter((bi) => {
            const sOld = shiftOf[bi]
            if (sOld === null || sOld === 'OFF' || sOld === sNeed) return false
            if (sOld === 'S3' && perEmp[ei].S3 - blocks[bi].len < e.min_night_shifts) return false
            if (sOld !== 'S3' && perEmp[ei][sOld as WorkShift] - blocks[bi].len < 2) return false
            return true
          })
          .sort((a, b) => blocks[a].len - blocks[b].len)
        for (const bi of candidates) {
          const sOld = shiftOf[bi] as WorkShift
          const snap = snapshot()
          apply(bi, sOld, -1)
          apply(bi, sNeed, 1)
          shiftOf[bi] = sNeed
          let ok = true
          const b = blocks[bi]
          for (let k = b.start; k < b.start + b.len && ok; k++) {
            if (count[sOld][k] < minPer[sOld]) ok = fixDeficit(k, sOld, 0, new Set([bi]))
          }
          if (ok && perEmp[ei][sNeed] >= 2) break
          restore(snap)
        }
      }
    })
  }

  // ---- chế độ repair: nhận sẵn phương án từ integrated builder, chỉ vá và đánh bóng ----
  if (initialShifts) {
    initialShifts.forEach((s, bi) => {
      if (s && s !== 'OFF') {
        shiftOf[bi] = s
        apply(bi, s as WorkShift, 1)
      }
    })
    runDeficitPasses(3)
    fixPreferNight()
    runDeficitPasses(2)
    // đánh bóng soft objectives (chia đều ca, cân bằng cá nhân) — không phá coverage
    let cost = costOf()
    const noDeficitIn = (bi: number): boolean => {
      const b = blocks[bi]
      for (let d = b.start; d < b.start + b.len; d++) {
        for (const t of WORK_SHIFTS) if (count[t][d] < minPer[t]) return false
      }
      return true
    }
    for (let iter = 0; iter < 2000 && cost > 0; iter++) {
      if (rng() < 0.5) {
        // flip 1 block
        const bi = Math.floor(rng() * blocks.length)
        const cur = shiftOf[bi]
        if (cur === null || cur === 'OFF') continue
        for (const s of shuffled(allowedFor(bi), rng)) {
          if (s === cur) continue
          apply(bi, cur as WorkShift, -1)
          apply(bi, s, 1)
          const c2 = costOf()
          if (noDeficitIn(bi) && c2 < cost) {
            shiftOf[bi] = s
            cost = c2
            break
          }
          apply(bi, s, -1)
          apply(bi, cur as WorkShift, 1)
        }
      } else {
        // swap ca giữa 2 block của 2 người — trung hòa coverage trên phần chồng lấn,
        // là move chính để chia đều các loại ca giữa các nhân viên
        const bi = Math.floor(rng() * blocks.length)
        const bj = Math.floor(rng() * blocks.length)
        const si = shiftOf[bi]
        const sj = shiftOf[bj]
        if (bi === bj || si === null || sj === null || si === sj || si === 'OFF' || sj === 'OFF') continue
        if (!allowedFor(bi).includes(sj as WorkShift) || !allowedFor(bj).includes(si as WorkShift)) continue
        apply(bi, si as WorkShift, -1)
        apply(bj, sj as WorkShift, -1)
        apply(bi, sj as WorkShift, 1)
        apply(bj, si as WorkShift, 1)
        const c2 = costOf()
        if (noDeficitIn(bi) && noDeficitIn(bj) && c2 < cost) {
          shiftOf[bi] = sj
          shiftOf[bj] = si
          cost = c2
        } else {
          apply(bi, sj as WorkShift, -1)
          apply(bj, si as WorkShift, -1)
          apply(bi, si as WorkShift, 1)
          apply(bj, sj as WorkShift, 1)
        }
      }
    }
    return { shiftOf, cost: costOf() }
  }

  // ---- pha 2a: backtracking chính xác theo ngày ----
  // Duyệt block theo ngày bắt đầu; khi con trỏ ngày vượt qua ngày d, mọi block phủ d
  // đã được gán → kiểm tra đủ 2 người/ca tại d, sai thì quay lui.
  const backtrackAssign = (relaxed: boolean, capSlack = 2): (Shift | null)[] | null => {
    const n = blocks.length
    const order = blocks
      .map((_, i) => i)
      .sort((a, b) => blocks[a].start - blocks[b].start || blocks[a].len - blocks[b].len)
    const assign: (WorkShift | null)[] = new Array(n).fill(null)
    const cnt: Record<WorkShift, number[]> = {
      S1: new Array<number>(D).fill(0),
      S2: new Array<number>(D).fill(0),
      S3: new Array<number>(D).fill(0),
    }
    const per: Record<WorkShift, number>[] = employees.map(() => ({ S1: 0, S2: 0, S3: 0 }))
    // số block CHƯA gán phủ từng ngày — dùng để prune sớm
    const remCover = new Array<number>(D).fill(0)
    for (const b of blocks) for (let d = b.start; d < b.start + b.len; d++) remCover[d]++

    // domain tĩnh của từng block (xấp xỉ, bỏ qua ràng buộc cặp designated động)
    const staticDom: WorkShift[][] = blocks.map((b, bi) => {
      const e = employees[b.empIdx]
      const allowed = allowedFor(bi)
      if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) {
        if (designatedNonNight.has(bi)) return (['S1', 'S2'] as WorkShift[]).filter((s) => allowed.includes(s))
        return relaxed ? allowed : allowed.includes('S3') ? ['S3'] : []
      }
      return allowed
    })
    // remCS[s][d]: số block CHƯA gán, phủ ngày d, có thể nhận ca s — prune nguồn cung theo ca
    const remCS: Record<WorkShift, number[]> = {
      S1: new Array<number>(D).fill(0),
      S2: new Array<number>(D).fill(0),
      S3: new Array<number>(D).fill(0),
    }
    blocks.forEach((b, bi) => {
      for (const s of staticDom[bi]) for (let d = b.start; d < b.start + b.len; d++) remCS[s][d]++
    })
    const takeBlock = (bi: number, sign: 1 | -1) => {
      const b = blocks[bi]
      for (const s of staticDom[bi]) for (let d = b.start; d < b.start + b.len; d++) remCS[s][d] -= sign
      for (let d = b.start; d < b.start + b.len; d++) remCover[d] -= sign
    }
    // ngày nào không thể đủ người ngay từ pattern thì bỏ qua kiểm tra (phase 1 sẽ bị validator bắt)
    const dayCheckable = new Array<boolean>(D).fill(true)
    const perDay = needPerDay(minPer)
    for (let d = 0; d < D; d++) if (remCover[d] < perDay) dayCheckable[d] = false

    const dayOk = (d: number) =>
      !dayCheckable[d] || WORK_SHIFTS.every((s) => cnt[s][d] >= minPer[s])

    let nodes = 0
    const LIMIT = 150000

    const domainOf = (bi: number): WorkShift[] => {
      const e = employees[blocks[bi].empIdx]
      const allowed = allowedFor(bi)
      if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) {
        if (designatedNonNight.has(bi)) {
          // cặp block chỉ định: mỗi loại một block
          const sibling = blocksOfEmp[blocks[bi].empIdx].find(
            (x) => x !== bi && designatedNonNight.has(x) && assign[x] !== null,
          )
          const dom = (['S1', 'S2'] as WorkShift[]).filter((s) => allowed.includes(s))
          if (sibling !== undefined) return dom.filter((s) => s !== assign[sibling])
          return dom
        }
        // chế độ chặt: block ngoài cặp chỉ định bắt buộc S3 (bảo toàn quota);
        // chế độ nới: cho phép ca khác khi cần — quota sẽ được vá ở bước sau
        return relaxed ? allowed : allowed.includes('S3') ? ['S3'] : []
      }
      return allowed
    }

    const dfs = (i: number, vp: number): boolean => {
      if (nodes++ > LIMIT) return false
      const upTo = i < n ? blocks[order[i]].start : D
      for (let d = vp; d < upTo; d++) if (!dayOk(d)) return false
      if (i === n) return true
      const bi = order[i]
      const b = blocks[bi]
      const dom = domainOf(bi)
      if (dom.length === 0) {
        // người này không làm được ca nào — bỏ block (thành OFF), hiếm gặp
        takeBlock(bi, 1)
        const ok = dfs(i + 1, upTo)
        takeBlock(bi, -1)
        return ok
      }
      // value ordering: ca đang thiếu nhiều nhất trong phạm vi block trước
      const scored = dom
        .map((s) => {
          let sc = rng() * 2
          for (let d = b.start; d < b.start + b.len; d++) {
            const deficit = minPer[s] - cnt[s][d]
            if (deficit > 0) sc += deficit * 8
            else sc -= 2
          }
          const e = employees[b.empIdx]
          const hasQuota = e.prefer_night && !e.no_s3 && e.min_night_shifts > 0
          if (hasQuota) {
            // còn thiếu quota đêm → S3 gần như bắt buộc (backtracking vẫn được phép
            // thử ca khác khi mọi nhánh S3 thất bại)
            if (s === 'S3' && per[b.empIdx].S3 < e.min_night_shifts) sc += 500
          } else if (!isNightEmployee(e)) {
            // không làm đêm: bám fair share từng loại ca ngay từ lúc gán —
            // vượt phần chia công bằng bị phạt nặng
            sc -=
              Math.max(0, per[b.empIdx][s] + b.len - fairShare[b.empIdx][s]) * 6 +
              per[b.empIdx][s] * 0.4
            // gói toàn bộ S3 của họ vào block chỉ định (spread S3 = chênh độ dài block)
            if (s === 'S3' && !e.no_s1 && !e.no_s2) sc += designatedS3.has(bi) ? 100 : -100
          } else {
            sc -= per[b.empIdx][s] * 1.2 // cân bằng cá nhân
          }
          return { s, sc }
        })
        .sort((a, z) => z.sc - a.sc)

      for (const { s } of scored) {
        // chế độ chặt: người không làm đêm không được vượt fair share quá capSlack ca
        // (cận quasi-cứng — biến chia đều thành ràng buộc của chính exact search;
        // nếu vô nghiệm thì các lần thử sau nới cận / relaxed bỏ cận này)
        if (!relaxed && !isNightEmployee(employees[b.empIdx])) {
          if (per[b.empIdx][s] + b.len > fairShare[b.empIdx][s] + capSlack) continue
        }
        // gán thử rồi prune: mỗi ngày trong block, mỗi ca phải còn đủ nguồn cung
        for (let d = b.start; d < b.start + b.len; d++) cnt[s][d]++
        takeBlock(bi, 1)
        let feasible = true
        for (let d = b.start; d < b.start + b.len && feasible; d++) {
          if (!dayCheckable[d]) continue
          let needMore = 0
          for (const t of WORK_SHIFTS) {
            const deficit = minPer[t] - cnt[t][d]
            if (deficit > 0) {
              // nguồn cung riêng của ca t tại ngày d phải đủ bù
              if (remCS[t][d] < deficit) {
                feasible = false
                break
              }
              needMore += deficit
            }
          }
          // tổng thiếu không được vượt số block chưa gán còn phủ ngày này
          if (feasible && needMore > remCover[d]) feasible = false
        }
        if (feasible) {
          per[b.empIdx][s] += b.len
          assign[bi] = s
          if (dfs(i + 1, upTo)) return true
          assign[bi] = null
          per[b.empIdx][s] -= b.len
        }
        takeBlock(bi, -1)
        for (let d = b.start; d < b.start + b.len; d++) cnt[s][d]--
      }
      return false
    }

    const ok = dfs(0, 0)
    ;(relaxed ? debugStats.relaxedNodes : debugStats.strictNodes).push(nodes)
    return ok ? assign.slice() : null
  }

  // thử strict (bảo toàn quota đêm bằng domain) nhiều lần, giữ bản CÔNG BẰNG nhất
  // (rng jitter làm mỗi lần ra một coloring khác — chọn theo costOf thay vì bản đầu tiên)
  let exact: (Shift | null)[] | null = null
  {
    let exactCost = Infinity
    for (let t = 0; t < 10; t++) {
      // 5 lần đầu siết cận fair share (+1), sau đó nới (+2)
      const cand = backtrackAssign(false, t < 5 ? 1 : 2)
      if (!cand) continue
      cand.forEach((s, bi) => {
        if (s && s !== 'OFF') apply(bi, s as WorkShift, 1)
      })
      const c = costOf()
      cand.forEach((s, bi) => {
        if (s && s !== 'OFF') apply(bi, s as WorkShift, -1)
      })
      if (c < exactCost) {
        exactCost = c
        exact = cand
      }
      if (c === 0) break
    }
    if (!exact) exact = backtrackAssign(true)
  }
  if (exact) debugStats.exactWins++
  else debugStats.fallbacks++
  if (exact) {
    // áp kết quả chính xác vào state chung rồi tinh chỉnh soft objectives
    exact.forEach((s, bi) => {
      if (s && s !== 'OFF') {
        shiftOf[bi] = s
        apply(bi, s as WorkShift, 1)
      }
    })
    let cost = costOf()
    for (let iter = 0; iter < 20000 && cost > 0; iter++) {
      // hoán đổi block trùng phạm vi (coverage bất biến) — chìa khóa chia đều ca
      if (rng() < 0.6) {
        const c2 = tryAlignedSwap(cost)
        if (c2 !== null) cost = c2
        continue
      }
      const bi = Math.floor(rng() * blocks.length)
      const cur = shiftOf[bi]
      if (cur === null || cur === 'OFF') continue
      for (const s of shuffled(allowedFor(bi), rng)) {
        if (s === cur) continue
        apply(bi, cur as WorkShift, -1)
        apply(bi, s, 1)
        // tuyệt đối không tạo lỗ độ phủ mới
        const b = blocks[bi]
        let breaks = false
        for (let d = b.start; d < b.start + b.len && !breaks; d++) {
          if (count[cur as WorkShift][d] < minPer[cur as WorkShift]) breaks = true
        }
        const c2 = costOf()
        if (!breaks && c2 < cost) {
          shiftOf[bi] = s
          cost = c2
          break
        }
        apply(bi, s, -1)
        apply(bi, cur as WorkShift, 1)
      }
    }
    // nhánh relaxed có thể còn hụt quota đêm / thiếu S1/S2 — vá bằng chain repair
    fixPreferNight()
    runDeficitPasses(2)
    cost = sweep2opt()
    return { shiftOf, cost }
  }

  // ---- pha 2b (fallback best-effort): greedy + local search + chain repair ----
  const order = blocks.map((_, i) => i).sort((a, b) => blocks[a].start - blocks[b].start)
  for (const bi of order) {
    const b = blocks[bi]
    const emp = employees[b.empIdx]
    const allowed = allowedFor(bi)
    if (allowed.length === 0) continue

    let bestS: WorkShift = allowed[0]
    let bestScore = -Infinity
    for (const s of allowed) {
      let score = rng() * 0.8
      for (let d = b.start; d < b.start + b.len; d++) {
        const deficit = minPer[s] - count[s][d]
        if (deficit > 0) score += deficit * 12
        else score -= 3 // đã đủ người, dồn thêm là phí
      }
      if (emp.prefer_night && !emp.no_s3 && emp.min_night_shifts > 0) {
        if (designatedNonNight.has(bi)) {
          // block đã chỉ định làm S1/S2 — mỗi loại một block
          if (s === 'S3') score -= 800
          else if (perEmp[b.empIdx][s] === 0) score += 250
          else score -= 100
        } else {
          if (s === 'S3') score += 250
          else score -= 800
        }
      } else if (emp.prefer_night) {
        if (s === 'S3') score += 20
      } else {
        // không làm đêm → bám fair share từng loại ca + xoay vòng ca
        score -=
          Math.max(0, perEmp[b.empIdx][s] + b.len - fairShare[b.empIdx][s]) * 6 +
          perEmp[b.empIdx][s] * 0.4
        if (s === 'S3' && !emp.no_s1 && !emp.no_s2) score += designatedS3.has(bi) ? 100 : -100
        const prev = blocksOfEmp[b.empIdx].filter((i) => blocks[i].start < b.start).pop()
        if (prev !== undefined && shiftOf[prev] === s) score -= 4
      }
      if (score > bestScore) {
        bestScore = score
        bestS = s
      }
    }
    shiftOf[bi] = bestS
    apply(bi, bestS, 1)
  }

  // vá coverage ngay sau greedy — local search phía sau chỉ tối ưu soft cost,
  // không tạo lại thiếu hụt vì coverage chiếm trọng số chi phí lớn nhất
  runDeficitPasses(3)

  // local search: đổi ca 1 block hoặc hoán đổi ca giữa 2 block nếu giảm chi phí
  let cost = costOf()
  const MAX_ITER = 2500
  for (let iter = 0; iter < MAX_ITER && cost > 0; iter++) {
    let improved = false

    if (rng() < 0.35) {
      // move 0: hoán đổi block trùng phạm vi — coverage bất biến, chia đều ca
      const c2 = tryAlignedSwap(cost)
      if (c2 !== null) {
        cost = c2
        improved = true
      }
    } else if (rng() < 0.5) {
      // move 1: đổi ca của một block
      const bi = Math.floor(rng() * blocks.length)
      const cur = shiftOf[bi]
      if (cur === null || cur === 'OFF') continue
      const allowed = allowedFor(bi)
      for (const s of shuffled(allowed, rng)) {
        if (s === cur) continue
        apply(bi, cur as WorkShift, -1)
        apply(bi, s, 1)
        const c2 = costOf()
        // chấp nhận move ngang giá 30% số lần để thoát cực trị địa phương
        if (c2 < cost || (c2 === cost && cost > 0 && rng() < 0.3)) {
          shiftOf[bi] = s
          cost = c2
          improved = true
          break
        }
        apply(bi, s, -1)
        apply(bi, cur as WorkShift, 1)
      }
    } else {
      // move 2: hoán đổi ca giữa 2 block của 2 người khác nhau
      const bi = Math.floor(rng() * blocks.length)
      const bj = Math.floor(rng() * blocks.length)
      const si = shiftOf[bi]
      const sj = shiftOf[bj]
      if (bi !== bj && si !== null && sj !== null && si !== sj && si !== 'OFF' && sj !== 'OFF') {
        if (allowedFor(bi).includes(sj as WorkShift) && allowedFor(bj).includes(si as WorkShift)) {
          apply(bi, si as WorkShift, -1)
          apply(bj, sj as WorkShift, -1)
          apply(bi, sj as WorkShift, 1)
          apply(bj, si as WorkShift, 1)
          const c2 = costOf()
          if (c2 < cost || (c2 === cost && cost > 0 && rng() < 0.3)) {
            shiftOf[bi] = sj
            shiftOf[bj] = si
            cost = c2
            improved = true
          } else {
            apply(bi, sj as WorkShift, -1)
            apply(bj, si as WorkShift, -1)
            apply(bi, si as WorkShift, 1)
            apply(bj, sj as WorkShift, 1)
          }
        }
      }
    }

    if (!improved && iter % 500 === 499 && cost > 0) {
      // lắc nhẹ: đổi ngẫu nhiên 1 block để thoát cực trị địa phương
      const bj = Math.floor(rng() * blocks.length)
      const cj = shiftOf[bj]
      const allowedJ = allowedFor(bj)
      if (cj !== null && allowedJ.length > 1) {
        const alt = allowedJ[Math.floor(rng() * allowedJ.length)]
        if (alt !== cj) {
          apply(bj, cj as WorkShift, -1)
          apply(bj, alt, 1)
          shiftOf[bj] = alt
          cost = costOf()
        }
      }
    }
  }

  // vá coverage lần cuối sau local search
  runDeficitPasses(4)
  fixPreferNight()

  cost = sweep2opt()

  return { shiftOf, cost }
}

// ---------- integrated builder: đặt block VÀ chọn ca cùng lúc, từng người một ----------

/**
 * Phần chia công bằng từng loại ca cho TỪNG nhân viên không làm đêm:
 * cầu S3 còn lại (sau khi nhóm ca đêm gánh quota) chia đều cho những người được làm S3,
 * phần còn lại của mỗi người chia đều cho các ca còn được phép (S1/S2).
 * (ví dụ 9 người, 2 người đêm ôm 32 S3 → người làm cả 3 ca ~8 S1, 8 S2, 4-5 S3;
 *  người không làm S3 ~10 S1, 10 S2)
 */
function computeFairShare(
  employees: Employee[],
  targets: number[],
  daysInMonth: number,
  need: PerShift,
): Record<WorkShift, number>[] {
  const share: Record<WorkShift, number>[] = employees.map(() => ({ S1: 0, S2: 0, S3: 0 }))
  // chia phần ca ngày (S1/S2) theo tỷ lệ số người cần ở mỗi ca
  const daySplit = (total: number, shifts: WorkShift[]): Record<WorkShift, number> => {
    const w = shifts.map((x) => Math.max(0, need[x]))
    const sum = w.reduce((a, b) => a + b, 0)
    const out: Record<WorkShift, number> = { S1: 0, S2: 0, S3: 0 }
    shifts.forEach((x, k) => (out[x] = sum > 0 ? (total * w[k]) / sum : total / shifts.length))
    return out
  }
  let s3Left = need.S3 * daysInMonth
  const s3Sharers: number[] = []
  employees.forEach((e, i) => {
    const t = targets[i]
    const allowed = allowedShiftsOf(e)
    if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) {
      const s3 = Math.min(e.min_night_shifts, Math.max(0, t - 4))
      share[i].S3 = s3
      const dayShifts = (['S1', 'S2'] as WorkShift[]).filter((x) => allowed.includes(x))
      const split = daySplit(t - s3, dayShifts)
      share[i].S1 = split.S1
      share[i].S2 = split.S2
      s3Left -= s3
    } else if (allowed.length === 1) {
      share[i][allowed[0]] = t
      if (allowed[0] === 'S3') s3Left -= t
    } else if (allowed.includes('S3')) {
      s3Sharers.push(i)
    }
  })
  const s3Each = s3Sharers.length > 0 ? Math.max(0, s3Left) / s3Sharers.length : 0
  employees.forEach((e, i) => {
    const allowed = allowedShiftsOf(e)
    if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) return
    if (allowed.length <= 1) return
    const s3 = allowed.includes('S3') ? Math.min(s3Each, targets[i]) : 0
    share[i].S3 = s3
    const dayShifts = allowed.filter((x) => x !== 'S3')
    const split = daySplit(targets[i] - s3, dayShifts)
    for (const x of dayShifts) share[i][x] = split[x]
  })
  return share
}
/**
 * Xây lịch cho một người bằng DFS: mỗi lựa chọn là (gap nghỉ, độ dài block, CA của block).
 * Nhờ biết cnt[s][d] toàn cục, người xây sau tự động trám đúng các ô (ngày, ca) còn thiếu —
 * tránh hẳn bài toán "tô màu pattern cố định" vốn hay vô nghiệm khi công suất sát nút.
 */
export function buildRowWithShifts(
  e: Employee,
  D: number,
  target: number,
  cntIn: Record<WorkShift, number[]>,
  minPer: PerShift,
  opts: { streakMin: number; streakMax: number; restMin: number; restMax: number; forceCont?: boolean },
  rng: Rng,
  /** nguồn cung kỳ vọng mỗi ngày từ những người CHƯA xây (worker-days / ngày) */
  futureExpect: number,
  /** phần chia công bằng mỗi loại ca cho người này (từ computeFairShare) */
  fairShare?: Record<WorkShift, number>,
  /** nguồn cung kỳ vọng RIÊNG cho ngày 1 theo ca (người chưa xây bị khoá ca bởi chuỗi dở tháng trước) */
  future0?: Record<WorkShift, number>,
): Shift[] | null {
  const { streakMin, streakMax, restMin, restMax } = opts
  // làm việc trên bản sao — caller tự cộng dồn row trả về vào cnt thật
  const cnt: Record<WorkShift, number[]> = {
    S1: cntIn.S1.slice(),
    S2: cntIn.S2.slice(),
    S3: cntIn.S3.slice(),
  }
  // nguồn cung kỳ vọng chia cho từng ca theo tỷ lệ số người cần
  const perDayNeed = Math.max(1, needPerDay(minPer))
  const futPerShiftOf = (sh: WorkShift, d = -1) =>
    d === 0 && future0 ? future0[sh] : (futureExpect * minPer[sh]) / perDayNeed
  const fixedOff = new Set(e.days_off)
  const allowed = WORK_SHIFTS.filter(
    (s) => !((s === 'S1' && e.no_s1) || (s === 'S2' && e.no_s2) || (s === 'S3' && e.no_s3)),
  )
  if (allowed.length === 0) return null
  const isOffDay = (d0: number) => fixedOff.has(d0 + 1)
  const carry = e.carry_in ?? null

  // người ưu tiên ca đêm: dãy block cố định [block-S3 ~4 ngày..., 2 block nhỏ S1/S2]
  const needsQuota = e.prefer_night && !e.no_s3 && e.min_night_shifts > 0
  type LenSpec = { len: number; small: boolean }
  let lenSpecs: LenSpec[] | null = null
  if (needsQuota) {
    const quota = Math.min(e.min_night_shifts, Math.max(0, target - 4))
    const nightLens = splitLens(quota, 4, streakMin, streakMax).map((len) => ({ len, small: false }))
    const dayLens = splitLens(target - quota, 3, streakMin, streakMax).map((len) => ({ len, small: true }))
    lenSpecs = shuffled([...nightLens, ...dayLens], rng)
  }

  let best: Shift[] | null = null
  let bestScore = -Infinity
  let bestRem = Infinity
  let nodes = 0
  const NODE_LIMIT = 9000

  const row: Shift[] = new Array<Shift>(D).fill('OFF')
  // số ca từng loại người này đã nhận trong row đang xây — để tự chia đều S1/S2/S3
  const selfCnt: Record<WorkShift, number> = { S1: 0, S2: 0, S3: 0 }

  const record = (rem: number, score: number) => {
    if (rem < bestRem || (rem === bestRem && score > bestScore)) {
      bestRem = rem
      bestScore = score
      best = row.slice()
    }
  }

  const dfs = (p: number, rem: number, blkIdx: number, usedSmall: Set<Shift>, score: number): boolean => {
    if (nodes++ > NODE_LIMIT) return false
    if (rem === 0 || p >= D) {
      record(rem, score)
      return rem === 0
    }
    // đang dở chuỗi từ tháng trước: đủ streakMax rồi thì ngày 1 phải nghỉ
    const gMin = p === 0 ? (carry && carry.run >= streakMax ? restMin : 0) : restMin
    // ép nối ca ngày 1 (bước vá chỗ nối): tại p = 0 chỉ xét g = 0
    const gCap = p === 0 && opts.forceCont && carry && carry.run < streakMax ? 0 : Math.min(D - p, restMax + 10)
    const choices: { g: number; L: number; sh: WorkShift; sc: number; small: boolean; cont: boolean }[] = []
    for (let g = gMin; g <= gCap; g++) {
      if (g > restMax && p !== 0) {
        let hasFixed = false
        for (let d = p; d < p + g; d++) if (isOffDay(d)) hasFixed = true
        if (!hasFixed) break
      }
      const s0 = p + g
      if (s0 >= D) break
      // block nối tiếp chuỗi tháng trước: cùng ca, tổng chuỗi ≤ streakMax, không tính vào dãy block ép sẵn
      const cont = s0 === 0 && carry !== null
      const spec = cont ? undefined : lenSpecs?.[blkIdx]
      const maxL = Math.min(cont ? streakMax - carry!.run : streakMax, D - s0, rem)
      for (let L = 1; L <= maxL; L++) {
        if (spec && L !== Math.min(spec.len, maxL)) continue
        const end = s0 + L
        let blocked = false
        for (let d = s0; d < end; d++) if (isOffDay(d)) { blocked = true; break }
        if (blocked) break
        if (L < streakMin && end < D && !(cont && carry!.run + L >= streakMin)) continue
        const remAfter = rem - L
        if (!spec && remAfter > 0 && remAfter < streakMin) continue
        // prune: phần target còn lại phải nhét vừa số ngày còn lại của tháng
        if (remAfter > 0) {
          const minDaysNeeded =
            remAfter + Math.max(0, Math.ceil(remAfter / streakMax) - 1) * restMin + restMin
          if (D - end < minDaysNeeded) continue
        }
        // domain ca cho block này
        let dom: WorkShift[]
        if (cont) {
          dom = allowed.includes(carry!.shift) ? [carry!.shift] : []
        } else if (spec) {
          dom = spec.small
            ? (['S1', 'S2'] as WorkShift[]).filter((x) => allowed.includes(x) && !usedSmall.has(x))
            : allowed.includes('S3') ? ['S3'] : []
        } else {
          dom = allowed
        }
        for (const sh of dom) {
          let sc = rng() * 1.5
          for (let d = s0; d < end; d++) {
            const deficit = minPer[sh] - cnt[sh][d]
            // urgency: thiếu hụt vượt quá nguồn cung kỳ vọng từ người xây sau = phải trám NGAY
            if (deficit > 0) sc += 5 + Math.max(0, deficit - futPerShiftOf(sh, d)) * 14
            else sc -= 5
          }
          if (!spec && (L === 3 || L === 4)) sc += 2
          // người không làm đêm: bám theo phần chia công bằng của từng loại ca
          // (phạt mạnh khi vượt fair share — cân bằng phải quyết ngay lúc xây,
          // hậu kỳ không sửa được vì coverage sát nút)
          if (!needsQuota && fairShare) {
            sc -= Math.max(0, selfCnt[sh] + L - fairShare[sh]) * 6 + selfCnt[sh] * 0.3
          } else if (!needsQuota) {
            sc -= selfCnt[sh] * 0.5
          }
          choices.push({ g, L, sh, sc, small: spec?.small ?? false, cont })
        }
      }
    }
    if (choices.length === 0) {
      record(rem, score)
      return false
    }
    choices.sort((a, b) => b.sc - a.sc)
    const tryN = Math.min(choices.length, 4)
    let solved = false
    for (let i = 0; i < tryN && !solved; i++) {
      const { g, L, sh, sc, small, cont } = choices[i]
      const s0 = p + g
      for (let d = s0; d < s0 + L; d++) {
        row[d] = sh
        cnt[sh][d]++
      }
      selfCnt[sh] += L
      if (small) usedSmall.add(sh)
      solved = dfs(s0 + L, rem - L, cont ? blkIdx : blkIdx + 1, usedSmall, score + sc)
      if (small && !solved) usedSmall.delete(sh)
      if (!solved) {
        selfCnt[sh] -= L
        for (let d = s0; d < s0 + L; d++) {
          row[d] = 'OFF'
          cnt[sh][d]--
        }
      }
    }
    return solved
  }

  const solvedAll = dfs(0, target, 0, new Set<Shift>(), 0)
  if (solvedAll) return row.slice()
  return best // best-effort khi không đạt đủ target (caller tự cộng vào cnt)
}

/** Xây toàn bộ ma trận bằng integrated builder, trả về matrix theo employee index. */
export function buildIntegrated(
  input: SolverInput,
  targets: number[],
  rng: Rng,
): Shift[][] | null {
  const { employees, daysInMonth: D, minPerShift } = input
  const cnt: Record<WorkShift, number[]> = {
    S1: new Array<number>(D).fill(0),
    S2: new Array<number>(D).fill(0),
    S3: new Array<number>(D).fill(0),
  }
  const rows: (Shift[] | null)[] = employees.map(() => null)
  const order = shuffled(employees.map((_, i) => i), rng)
  order.sort(
    (a, b) =>
      employees[b].days_off.length +
      (employees[b].prefer_night ? 3 : 0) +
      (employees[b].no_s1 || employees[b].no_s2 || employees[b].no_s3 ? 1 : 0) -
      (employees[a].days_off.length +
        (employees[a].prefer_night ? 3 : 0) +
        (employees[a].no_s1 || employees[a].no_s2 || employees[a].no_s3 ? 1 : 0)),
  )
  const opts = {
    streakMin: input.streakMin,
    streakMax: input.streakMax,
    restMin: input.restMin,
    restMax: input.restMax,
  }
  // người có chuỗi dở từ tháng trước xây SAU (ngày 1 của họ chỉ có 2 lựa chọn: nghỉ hoặc nối ca)
  // → lúc xây đã thấy rõ ngày 1 còn thiếu ca nào để nối đúng ca đó
  order.sort((a, b) => (employees[a].carry_in ? 1 : 0) - (employees[b].carry_in ? 1 : 0))
  const fairShare = computeFairShare(employees, targets, D, minPerShift)
  let remainingSupply = order.reduce((s, i) => s + targets[i], 0)
  const built = new Set<number>()
  // nguồn cung kỳ vọng ngày 1 theo ca từ những người CHƯA xây
  const future0 = (): Record<WorkShift, number> => {
    const f: Record<WorkShift, number> = { S1: 0, S2: 0, S3: 0 }
    const perDay = Math.max(1, needPerDay(minPerShift))
    employees.forEach((x, k) => {
      if (built.has(k) || x.days_off.includes(1)) return
      const c = x.carry_in
      if (c) {
        if (c.run < input.streakMax) f[c.shift] += 0.6
      } else {
        for (const sh of WORK_SHIFTS) f[sh] += ((targets[k] / D) * minPerShift[sh]) / perDay
      }
    })
    return f
  }
  for (const i of order) {
    remainingSupply -= targets[i]
    const futureExpect = remainingSupply / D
    const e = employees[i]
    built.add(i)
    const f0 = future0()
    // xây xuôi hoặc ngược tháng (mirror) — đối xứng hóa khả năng với tới 2 biên
    // có chuỗi dở từ tháng trước → chỉ xây xuôi (carry-in neo ở ngày 1)
    const mirror = !e.carry_in && rng() < 0.5
    let row: Shift[] | null
    if (!mirror) {
      row = buildRowWithShifts(e, D, targets[i], cnt, minPerShift, opts, rng, futureExpect, fairShare[i], f0)
    } else {
      const eM = { ...e, days_off: e.days_off.map((x) => D + 1 - x) }
      const cntM: Record<WorkShift, number[]> = {
        S1: cnt.S1.slice().reverse(),
        S2: cnt.S2.slice().reverse(),
        S3: cnt.S3.slice().reverse(),
      }
      const r = buildRowWithShifts(eM, D, targets[i], cntM, minPerShift, opts, rng, futureExpect, fairShare[i])
      row = r ? r.slice().reverse() : null
    }
    if (!row) {
      rows[i] = new Array<Shift>(D).fill('OFF')
      continue
    }
    rows[i] = row
    for (let d = 0; d < D; d++) {
      const s = row[d]
      if (s !== 'OFF') cnt[s as WorkShift][d]++
    }
  }

  lnsRefine(input, targets, rows as Shift[][], rng)
  return rows as Shift[][]
}

/**
 * Coordinate descent (LNS): gỡ từng người ra xây lại khi đã thấy toàn cảnh —
 * người xây lại trám chính xác các ô (ngày, ca) còn thủng. Chấp nhận move ngang
 * (dồn lỗ hổng về chỗ dễ vá) trong giới hạn vài vòng để thoát cực trị.
 */
export function lnsRefine(
  input: SolverInput,
  targets: number[],
  rows: Shift[][],
  rng: Rng,
): void {
  const { employees, daysInMonth: D, minPerShift } = input
  const opts = {
    streakMin: input.streakMin,
    streakMax: input.streakMax,
    restMin: input.restMin,
    restMax: input.restMax,
  }
  const cnt: Record<WorkShift, number[]> = {
    S1: new Array<number>(D).fill(0),
    S2: new Array<number>(D).fill(0),
    S3: new Array<number>(D).fill(0),
  }
  rows.forEach((row) => {
    for (let d = 0; d < D; d++) if (row[d] !== 'OFF') cnt[row[d] as WorkShift][d]++
  })
  const deficitTotal = () => {
    let s = 0
    for (const sh of WORK_SHIFTS) {
      for (let d = 0; d < D; d++) s += Math.max(0, minPerShift[sh] - cnt[sh][d])
    }
    // quota ca đêm + 2 ca S1/S2 bắt buộc của người ưu tiên đêm cũng là "thiếu hụt"
    employees.forEach((e, i) => {
      if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return
      const row = rows[i]
      let s1 = 0, s2 = 0, s3 = 0
      for (let d = 0; d < D; d++) {
        if (row[d] === 'S1') s1++
        else if (row[d] === 'S2') s2++
        else if (row[d] === 'S3') s3++
      }
      s += Math.max(0, e.min_night_shifts - s3) * 2
      if (!e.no_s1) s += Math.max(0, 2 - s1)
      if (!e.no_s2) s += Math.max(0, 2 - s2)
      // thiếu tổng ca (mất cân bằng) cũng tính
      s += Math.max(0, targets[i] - (s1 + s2 + s3))
    })
    return s
  }
  const fairShare = computeFairShare(employees, targets, D, minPerShift)
  const buildOne = (i: number): Shift[] | null => {
    const e = employees[i]
    if (e.carry_in || rng() < 0.5) {
      return buildRowWithShifts(e, D, targets[i], cnt, minPerShift, opts, rng, 0, fairShare[i])
    }
    const eM = { ...e, days_off: e.days_off.map((x) => D + 1 - x) }
    const cntM: Record<WorkShift, number[]> = {
      S1: cnt.S1.slice().reverse(),
      S2: cnt.S2.slice().reverse(),
      S3: cnt.S3.slice().reverse(),
    }
    const r = buildRowWithShifts(eM, D, targets[i], cntM, minPerShift, opts, rng, 0, fairShare[i])
    return r ? r.slice().reverse() : null
  }
  const applyRow = (row: Shift[], sign: 1 | -1) => {
    for (let d = 0; d < D; d++) {
      const s = row[d]
      if (s !== 'OFF') cnt[s as WorkShift][d] += sign
    }
  }
  // hàng có hợp lệ đầy đủ không (pattern + cùng ca ngày liền kề + cấm ca + nghỉ cố định)
  const rowValid = (row: Shift[], e: Employee): boolean => {
    if (!patternValid(row.map((s) => s !== 'OFF'), e, input)) return false
    if (e.carry_in && row[0] !== 'OFF' && row[0] !== e.carry_in.shift) return false
    for (let d = 0; d < D; d++) {
      const s = row[d]
      if (s === 'OFF') continue
      if ((s === 'S1' && e.no_s1) || (s === 'S2' && e.no_s2) || (s === 'S3' && e.no_s3)) return false
      if (d + 1 < D && row[d + 1] !== 'OFF' && row[d + 1] !== s) return false
    }
    return true
  }

  // endgame: chuyển 1 ngày làm của ai đó sang ô (ngày, ca) đang thủng.
  // Nguồn lấy đi ưu tiên ô thừa; nếu tạo lỗ mới thì đệ quy đóng tiếp (augmenting chain).
  const quotaSafe = (e: Employee, row: Shift[], sRemoved: WorkShift): boolean => {
    if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return true
    const c = (x: Shift) => row.filter((v) => v === x).length
    if (sRemoved === 'S3' && c('S3') - 1 < e.min_night_shifts) return false
    if (sRemoved === 'S1' && !e.no_s1 && c('S1') - 1 < 2) return false
    if (sRemoved === 'S2' && !e.no_s2 && c('S2') - 1 < 2) return false
    return true
  }
  const tryClose = (d: number, sh: WorkShift, depth: number, visited: Set<string>): boolean => {
    if (cnt[sh][d] >= minPerShift[sh]) return true
    for (const i of shuffled(employees.map((_, x) => x), rng)) {
      const e = employees[i]
      const row = rows[i]
      if (row[d] !== 'OFF' || e.days_off.includes(d + 1)) continue
      if ((sh === 'S1' && e.no_s1) || (sh === 'S2' && e.no_s2) || (sh === 'S3' && e.no_s3)) continue
      // nguồn: ưu tiên ngày thừa; ngày thường chỉ khi còn được đệ quy
      for (const surplusOnly of [true, false]) {
        if (!surplusOnly && depth >= 3) break
        for (let dS = 0; dS < D; dS++) {
          const sS = row[dS]
          if (sS === 'OFF' || dS === d) continue
          const isSurplus = cnt[sS as WorkShift][dS] > minPerShift[sS as WorkShift]
          if (surplusOnly !== isSurplus) continue
          const key = `${i}:${dS}`
          if (visited.has(key)) continue
          if (!quotaSafe(e, row, sS as WorkShift)) continue
          const trial = row.slice()
          trial[d] = sh
          trial[dS] = 'OFF'
          if (!rowValid(trial, e)) continue
          rows[i] = trial
          cnt[sh][d]++
          cnt[sS as WorkShift][dS]--
          if (isSurplus) return true
          visited.add(key)
          if (tryClose(dS, sS as WorkShift, depth + 1, visited)) return true
          visited.delete(key)
          rows[i] = row
          cnt[sh][d]--
          cnt[sS as WorkShift][dS]++
        }
      }
    }
    return false
  }
  const microMove = (): boolean => {
    let moved = false
    for (const sh of WORK_SHIFTS) {
      for (let d = 0; d < D; d++) {
        if (cnt[sh][d] >= minPerShift[sh]) continue
        if (tryClose(d, sh, 0, new Set())) moved = true
      }
    }
    return moved
  }

  // vá chỗ nối với tháng trước: ngày 1 thiếu ca X → người đang dở chuỗi X (đang nghỉ ngày 1)
  // xây lại hàng với yêu cầu nối tiếp ca X; nhận khi tổng thiếu hụt giảm
  const boundaryPass = (): boolean => {
    let moved = false
    for (const sh of WORK_SHIFTS) {
      if (cnt[sh][0] >= minPerShift[sh]) continue
      for (const i of shuffled(employees.map((_, x) => x), rng)) {
        if (cnt[sh][0] >= minPerShift[sh]) break
        const e = employees[i]
        const c = e.carry_in
        if (!c || c.shift !== sh || c.run >= input.streakMax || rows[i][0] !== 'OFF' || e.days_off.includes(1)) continue
        const before = deficitTotal()
        const old = rows[i]
        applyRow(old, -1)
        const cand = buildRowWithShifts(e, D, targets[i], cnt, minPerShift, { ...opts, forceCont: true }, rng, 0, fairShare[i])
        if (cand && cand[0] === sh && cand.filter((x) => x !== 'OFF').length >= targets[i] && rowValid(cand, e)) {
          applyRow(cand, 1)
          rows[i] = cand
          if (deficitTotal() < before) {
            moved = true
            continue
          }
          applyRow(cand, -1)
          rows[i] = old
        }
        applyRow(old, 1)
      }
    }
    return moved
  }

  let sideways = 0
  for (let round = 0; round < 25 && deficitTotal() > 0; round++) {
    boundaryPass()
    while (microMove()) {
      /* dồn hết các nước đi trực tiếp trước khi rebuild */
    }
    if (deficitTotal() === 0) break
    let improvedAny = false
    // người đang giữ ô "thừa" (ca đã dư người) rebuild trước — chỉ họ mới có thể
    // nhả ngày thừa ra để trám đúng lỗ hổng mà không mở lỗ mới
    const holdsSurplus = (i: number) => {
      const row = rows[i]
      for (let d = 0; d < D; d++) {
        const s = row[d]
        if (s !== 'OFF' && cnt[s as WorkShift][d] > minPerShift[s as WorkShift]) return 1
      }
      return 0
    }
    const roundOrder = shuffled(employees.map((_, x) => x), rng).sort(
      (a, b) => holdsSurplus(b) - holdsSurplus(a),
    )
    for (const i of roundOrder) {
      const before = deficitTotal()
      if (before === 0) break
      const old = rows[i]
      applyRow(old, -1)
      // thử 2 lượt rebuild (xuôi/ngược ngẫu nhiên), giữ bản ít thiếu hụt hơn
      let rebuilt: Shift[] | null = null
      let after = Infinity
      for (let t = 0; t < 2; t++) {
        const cand = buildOne(i)
        if (!cand) continue
        // không nhận bản rebuild thiếu target hoặc phá preference ưu tiên ca đêm
        const e = employees[i]
        const work = cand.filter((s) => s !== 'OFF').length
        if (work < targets[i]) continue
        if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) {
          const s3 = cand.filter((s) => s === 'S3').length
          const s1 = cand.filter((s) => s === 'S1').length
          const s2 = cand.filter((s) => s === 'S2').length
          if (s3 < e.min_night_shifts || (!e.no_s1 && s1 < 2) || (!e.no_s2 && s2 < 2)) continue
        }
        applyRow(cand, 1)
        rows[i] = cand
        const dt = deficitTotal()
        applyRow(cand, -1)
        rows[i] = old
        if (dt < after) {
          after = dt
          rebuilt = cand
        }
        if (dt === 0) break
      }
      if (rebuilt && after <= before) {
        applyRow(rebuilt, 1)
        rows[i] = rebuilt
        if (after < before) improvedAny = true
      } else {
        applyRow(old, 1)
      }
    }
    if (!improvedAny) {
      if (++sideways >= 5) break
    } else sideways = 0
  }
}

/**
 * LNS theo CẶP cho rule chia đều: lịch đã hợp lệ (độ phủ đủ) → chọn 2 người đang lệch
 * nhau (một nhiều, một ít cùng loại ca), gỡ cả 2 hàng rồi xây lại bằng buildRowWithShifts
 * (tôn trọng chuỗi làm/nghỉ, ngày nghỉ cố định, cấm ca, fair share). Chỉ nhận khi độ phủ
 * vẫn đủ, tổng ca giữ nguyên và (hard, soft) của rule chia đều giảm.
 */
export function fairnessLns(
  input: SolverInput,
  targets: number[],
  rows: Shift[][],
  rng: Rng,
  deadline: number,
): void {
  const { employees, daysInMonth: D, minPerShift } = input
  const opts = {
    streakMin: input.streakMin,
    streakMax: input.streakMax,
    restMin: input.restMin,
    restMax: input.restMax,
  }
  const cnt: Record<WorkShift, number[]> = {
    S1: new Array<number>(D).fill(0),
    S2: new Array<number>(D).fill(0),
    S3: new Array<number>(D).fill(0),
  }
  rows.forEach((row) => {
    for (let d = 0; d < D; d++) if (row[d] !== 'OFF') cnt[row[d] as WorkShift][d]++
  })
  const covered = () => {
    for (const sh of WORK_SHIFTS) for (let d = 0; d < D; d++) if (cnt[sh][d] < minPerShift[sh]) return false
    return true
  }
  if (!covered()) return
  const fairShare = computeFairShare(employees, targets, D, minPerShift)
  const buildOne = (i: number): Shift[] | null => {
    const e = employees[i]
    if (e.carry_in || rng() < 0.5) {
      return buildRowWithShifts(e, D, targets[i], cnt, minPerShift, opts, rng, 0, fairShare[i])
    }
    const eM = { ...e, days_off: e.days_off.map((x) => D + 1 - x) }
    const cntM: Record<WorkShift, number[]> = {
      S1: cnt.S1.slice().reverse(),
      S2: cnt.S2.slice().reverse(),
      S3: cnt.S3.slice().reverse(),
    }
    const r = buildRowWithShifts(eM, D, targets[i], cntM, minPerShift, opts, rng, 0, fairShare[i])
    return r ? r.slice().reverse() : null
  }
  const applyRow = (row: Shift[], sign: 1 | -1) => {
    for (let d = 0; d < D; d++) {
      const s = row[d]
      if (s !== 'OFF') cnt[s as WorkShift][d] += sign
    }
  }
  const idx = new Map(employees.map((e, i) => [e.id, i]))
  const fairNow = () => {
    const f = evaluateFairness(employees, (e) => {
      const row = rows[idx.get(e.id)!]
      const c: Record<WorkShift, number> = { S1: 0, S2: 0, S3: 0 }
      for (const x of row) if (x !== 'OFF') c[x as WorkShift]++
      return c
    }, minPerShift)
    return { score: f.hard * 1000 + f.soft, pairs: f.pairs, hard: f.hard }
  }
  // hàng xây lại phải giữ đúng tổng ca (cân bằng ±1) và preference người làm đêm
  const rowAcceptable = (i: number, row: Shift[]): boolean => {
    const e = employees[i]
    let s1 = 0, s2 = 0, s3 = 0
    for (const x of row) {
      if (x === 'S1') s1++
      else if (x === 'S2') s2++
      else if (x === 'S3') s3++
    }
    if (s1 + s2 + s3 !== targets[i]) return false
    if (e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) {
      const oldS3 = rows[i].filter((x) => x === 'S3').length
      if (s3 < Math.min(e.min_night_shifts, oldS3) || (!e.no_s1 && s1 < 2) || (!e.no_s2 && s2 < 2)) return false
    }
    return true
  }

  const recount = () => {
    for (const sh of WORK_SHIFTS) cnt[sh].fill(0)
    rows.forEach((row) => {
      for (let d = 0; d < D; d++) if (row[d] !== 'OFF') cnt[row[d] as WorkShift][d]++
    })
  }
  const allValid = (): boolean => {
    if (!covered()) return false
    for (let i = 0; i < employees.length; i++) if (!rowAcceptable(i, rows[i])) return false
    const matrix: ScheduleMatrix = {}
    employees.forEach((e, i) => (matrix[e.id] = rows[i]))
    return (
      validateMatrix({
        employees,
        matrix,
        daysInMonth: D,
        minPerShift,
        streakMin: input.streakMin,
        streakMax: input.streakMax,
        restMax: input.restMax,
        prevTail: input.prevTail,
      }).length === 0
    )
  }

  let cur = fairNow()
  let bestScore = cur.score
  let bestRows = rows.map((r) => r.slice())
  let stale = 0
  const n = employees.length
  while (cur.hard > 0 && stale < 200 && Date.now() < deadline) {
    let a: number
    let b: number
    if (cur.pairs.length > 0 && rng() < 0.7) {
      const [x, y] = cur.pairs[Math.floor(rng() * cur.pairs.length)]
      a = idx.get(x)!
      b = idx.get(y)!
    } else {
      a = Math.floor(rng() * n)
      b = Math.floor(rng() * n)
      if (a === b) continue
    }
    if (rng() < 0.5) [a, b] = [b, a]
    const snapshot = rows.map((r) => r.slice())
    const oldA = rows[a]
    const oldB = rows[b]
    applyRow(oldA, -1)
    applyRow(oldB, -1)
    const ra = buildOne(a)
    if (ra) applyRow(ra, 1)
    const rb = ra ? buildOne(b) : null
    let accepted = false
    if (ra && rb) {
      applyRow(rb, 1)
      rows[a] = ra
      rows[b] = rb
      // xây lại 2 hàng hiếm khi lấp kín độ phủ → vá lỗ bằng LNS/chain có sẵn
      if (!covered()) {
        lnsRefine(input, targets, rows, rng)
        recount()
      }
      if (allValid()) {
        const next = fairNow()
        // nhận cải thiện; thỉnh thoảng nhận bản xấu hơn ≤1 bậc hard để thoát cực trị
        // (iterated local search — bản tốt nhất luôn được giữ lại và khôi phục ở cuối)
        if (next.score < cur.score - 1e-9 || (next.score < cur.score + 1000 && rng() < 0.15)) {
          cur = next
          accepted = true
          if (cur.score < bestScore - 1e-9) {
            bestScore = cur.score
            bestRows = rows.map((r) => r.slice())
          }
        }
      }
    }
    if (accepted) stale = 0
    else {
      snapshot.forEach((r, i) => (rows[i] = r))
      recount()
      stale++
    }
  }
  if (cur.score > bestScore + 1e-9) bestRows.forEach((r, i) => (rows[i] = r))
}

// ---------- phase 1 driver ----------
function buildAllPatterns(
  input: SolverInput,
  targets: number[],
  rng: Rng,
): boolean[][] | null {
  const { employees, daysInMonth: D, minPerShift } = input
  const perDay = needPerDay(minPerShift)
  const colCount = new Array<number>(D).fill(0)
  const patterns: (boolean[] | null)[] = employees.map(() => null)

  const order = shuffled(
    employees.map((_, i) => i),
    rng,
  )
  // người có nhiều ràng buộc (nghỉ cố định nhiều, ưu tiên đêm) xếp trước
  order.sort(
    (a, b) =>
      employees[b].days_off.length +
      (employees[b].prefer_night ? 2 : 0) -
      (employees[a].days_off.length + (employees[a].prefer_night ? 2 : 0)),
  )

  // ngày đã bị block S3 (ngoài cặp chỉ định) của quota-emp trước phủ —
  // quota-emp sau nên TRÁNH trùng để nguồn S3 rải đều ~1 người/ngày,
  // phần bù của người thường thành một lớp tile duy nhất (dễ khả thi hơn hẳn)
  const nightCover = new Array<number>(D).fill(0)

  for (const i of order) {
    const e = employees[i]
    const deficit = colCount.map((c) => perDay - c)
    const baseOpts = {
      streakMin: input.streakMin,
      streakMax: input.streakMax,
      restMin: input.restMin,
      restMax: input.restMax,
    }
    let p: boolean[] | null = null

    const needsQuota = e.prefer_night && !e.no_s3 && e.min_night_shifts > 0
    if (needsQuota) {
      // ép cấu trúc block: các block ~4 ngày gánh quota đêm + 2 block nhỏ (2-3 ngày) cho S1/S2
      const quota = Math.min(e.min_night_shifts, Math.max(0, targets[i] - 4))
      const rem = targets[i] - quota
      const nightDeficit = deficit.map((v, d) => v - nightCover[d] * 5)
      for (let attempt = 0; attempt < 6 && !p; attempt++) {
        const lens = shuffled(
          [...splitLens(quota, 4, input.streakMin, input.streakMax), ...splitLens(rem, 3, input.streakMin, input.streakMax)],
          rng,
        )
        const candidate = buildPattern(D, targets[i], new Set(e.days_off), nightDeficit, { ...baseOpts, fixedLens: lens, carryRun: e.carry_in?.run }, rng, true)
        if (candidate && candidate.filter(Boolean).length === targets[i] && designable(candidate, quota)) {
          p = candidate
        }
      }
      if (p) {
        // đánh dấu các ngày S3 dự kiến (mọi block trừ cặp nhỏ nhất đủ điều kiện)
        const lens: { start: number; len: number }[] = []
        let d0 = 0
        while (d0 < D) {
          if (p[d0]) {
            let e0 = d0
            while (e0 < D && p[e0]) e0++
            lens.push({ start: d0, len: e0 - d0 })
            d0 = e0
          } else d0++
        }
        const sorted = [...lens].sort((a, b) => a.len - b.len)
        const pair = new Set<number>()
        for (const blk of sorted) {
          if (pair.size >= 2) break
          const rest = lens.reduce((s, x) => s + x.len, 0) - blk.len - [...pair].reduce((s, st) => s + lens.find((x) => x.start === st)!.len, 0)
          if (blk.len >= 2 && rest >= quota) pair.add(blk.start)
        }
        for (const blk of lens) {
          if (pair.has(blk.start)) continue
          for (let d = blk.start; d < blk.start + blk.len; d++) nightCover[d]++
        }
      }
    }
    if (!p) {
      p = buildPattern(D, targets[i], new Set(e.days_off), deficit, { ...baseOpts, carryRun: e.carry_in?.run }, rng, e.prefer_night)
    }
    if (!p) return null
    patterns[i] = p
    for (let d = 0; d < D; d++) if (p[d]) colCount[d]++
  }

  // sửa thiếu hụt cột: chuyển 1 ngày làm của ai đó từ ngày thừa sang ngày thiếu
  for (let pass = 0; pass < 60; pass++) {
    let worstDay = -1
    let worstDef = 0
    for (let d = 0; d < D; d++) {
      const def = perDay - colCount[d]
      if (def > worstDef) {
        worstDef = def
        worstDay = d
      }
    }
    if (worstDay < 0) break

    let fixed = false
    for (const i of shuffled(
      employees.map((_, x) => x),
      rng,
    )) {
      const p = patterns[i]!
      const e = employees[i]
      if (p[worstDay] || e.days_off.includes(worstDay + 1)) continue
      // thử bật worstDay thành làm + tắt một ngày ở cột thừa, rồi kiểm tra pattern còn hợp lệ
      for (let d2 = 0; d2 < D; d2++) {
        if (!p[d2] || colCount[d2] <= perDay) continue
        p[worstDay] = true
        p[d2] = false
        if (patternValid(p, e, input)) {
          colCount[worstDay]++
          colCount[d2]--
          fixed = true
          break
        }
        p[worstDay] = false
        p[d2] = true
      }
      if (fixed) break
      // không có cột thừa phù hợp: thử chỉ bật thêm (chấp nhận vượt target 1 ca)
      p[worstDay] = true
      if (
        patternValid(p, e, input) &&
        p.filter(Boolean).length <= e.max_shifts_per_month
      ) {
        colCount[worstDay]++
        fixed = true
        break
      }
      p[worstDay] = false
    }
    if (!fixed) break
  }

  rebalanceColumns(patterns as boolean[][], colCount, employees, input, rng)

  return patterns as boolean[][]
}

/**
 * Cân bằng cột bằng cách DI CHUYỂN nguyên block làm việc của một người
 * sang vị trí khác phủ được các ngày còn thiếu người (hill-climbing trên tổng thiếu hụt).
 */
function rebalanceColumns(
  patterns: boolean[][],
  colCount: number[],
  employees: Employee[],
  input: SolverInput,
  rng: Rng,
  needArr?: number[],
): void {
  const D = input.daysInMonth
  const perDay = needPerDay(input.minPerShift)
  const needOf = (d: number) => needArr?.[d] ?? perDay
  const deficitSum = () =>
    colCount.reduce((s, c, d) => s + Math.max(0, needOf(d) - c), 0)
  // không được phá cấu trúc block của người ưu tiên ca đêm
  const stillDesignable = (p: boolean[], e: Employee) =>
    !(e.prefer_night && !e.no_s3 && e.min_night_shifts > 0) || designable(p, e.min_night_shifts)

  let current = deficitSum()
  for (let iter = 0; iter < 120 && current > 0; iter++) {
    let bestGain = 0
    let bestMove: { empIdx: number; on: number[]; off: number[] } | null = null
    // move không lời không lỗ — dùng để thoát cực trị địa phương (plateau walk)
    const plateau: { empIdx: number; on: number[]; off: number[] }[] = []

    for (const empIdx of shuffled(employees.map((_, i) => i), rng)) {
      const p = patterns[empIdx]
      const e = employees[empIdx]
      // liệt kê block của người này
      let d = 0
      while (d < D) {
        if (!p[d]) {
          d++
          continue
        }
        let end = d
        while (end < D && p[end]) end++
        const len = end - d
        // thử đặt block này ở vị trí khác
        for (let ns = 0; ns <= D - len; ns++) {
          if (ns === d) continue
          // gỡ block cũ, đặt block mới
          for (let k = d; k < end; k++) p[k] = false
          let clash = false
          for (let k = ns; k < ns + len; k++) {
            if (p[k]) clash = true
          }
          if (!clash) {
            for (let k = ns; k < ns + len; k++) p[k] = true
            if (patternValid(p, e, input) && stillDesignable(p, e)) {
              // tính gain
              let gain = 0
              for (let k = d; k < end; k++) gain -= Math.max(0, needOf(k) - (colCount[k] - 1)) - Math.max(0, needOf(k) - colCount[k])
              for (let k = ns; k < ns + len; k++) gain += Math.max(0, needOf(k) - colCount[k]) - Math.max(0, needOf(k) - (colCount[k] + 1))
              if (gain > bestGain) {
                bestGain = gain
                bestMove = {
                  empIdx,
                  on: Array.from({ length: len }, (_, k) => ns + k),
                  off: Array.from({ length: len }, (_, k) => d + k),
                }
              } else if (gain === 0 && plateau.length < 40) {
                plateau.push({
                  empIdx,
                  on: Array.from({ length: len }, (_, k) => ns + k),
                  off: Array.from({ length: len }, (_, k) => d + k),
                })
              }
            }
            for (let k = ns; k < ns + len; k++) p[k] = false
          }
          for (let k = d; k < end; k++) p[k] = true
        }
        d = end
      }

      // move 2: nới block 1 ngày vào cột thiếu + co block (khác hoặc cùng) 1 ngày ở cột thừa
      for (let u = 0; u < D; u++) {
        if (colCount[u] >= needOf(u) || p[u] || e.days_off.includes(u + 1)) continue
        const adjacent = (u > 0 && p[u - 1]) || (u < D - 1 && p[u + 1])
        if (!adjacent) continue
        for (let o = 0; o < D; o++) {
          if (o === u || !p[o] || colCount[o] <= needOf(o)) continue
          const isEdge = (o === 0 || !p[o - 1]) || (o === D - 1 || !p[o + 1])
          if (!isEdge) continue
          p[u] = true
          p[o] = false
          if (patternValid(p, e, input) && stillDesignable(p, e)) {
            const gain =
              Math.max(0, needOf(u) - colCount[u]) -
              Math.max(0, needOf(u) - (colCount[u] + 1)) -
              (Math.max(0, needOf(o) - (colCount[o] - 1)) - Math.max(0, needOf(o) - colCount[o]))
            if (gain > bestGain) {
              bestGain = gain
              bestMove = { empIdx, on: [u], off: [o] }
            } else if (gain === 0 && plateau.length < 40) {
              plateau.push({ empIdx, on: [u], off: [o] })
            }
          }
          p[u] = false
          p[o] = true
        }
      }
    }

    if (!bestMove) {
      if (plateau.length === 0 || iter > 100) break
      bestMove = plateau[Math.floor(rng() * plateau.length)]
    }
    const p = patterns[bestMove.empIdx]
    for (const k of bestMove.off) {
      p[k] = false
      colCount[k]--
    }
    for (const k of bestMove.on) {
      p[k] = true
      colCount[k]++
    }
    current = deficitSum()
  }
}

/** Pattern làm/nghỉ có hợp lệ theo streak/rest/fixed-off không (chưa xét ca). */
function patternValid(p: boolean[], e: Employee, input: SolverInput): boolean {
  const D = input.daysInMonth
  const offSet = new Set(e.days_off)
  for (const d of e.days_off) if (p[d - 1]) return false
  const carryRun = e.carry_in?.run ?? 0
  let d = 0
  while (d < D) {
    const w = p[d]
    let end = d
    while (end < D && p[end] === w) end++
    // chuỗi đầu tháng nối tiếp chuỗi tháng trước
    const len = end - d + (d === 0 && w ? carryRun : 0)
    const edge = d === 0 || end === D
    if (w) {
      if (len > input.streakMax) return false
      if (len < input.streakMin && !edge) return false
    } else {
      const hasFixed = Array.from({ length: len }, (_, k) => d + 1 + k).some((x) => offSet.has(x))
      if (len > input.restMax && !edge && !hasFixed) return false
    }
    d = end
  }
  return true
}

// ---------- main ----------
/**
 * Xếp lịch cho một KHOẢNG NGÀY trong tháng: giải khoảng đó như một "tháng con" dài L ngày
 * (ngày nghỉ cố định, số ca tối đa, số ca đêm tối thiểu được co theo tỉ lệ L/D), rồi ghép vào
 * lịch hiện có — các ngày ngoài khoảng giữ nguyên. Vi phạm được tính lại trên cả tháng để lộ
 * chỗ nối giữa phần cũ và phần mới (chuyển ca sát nhau, chuỗi quá dài…).
 */
export function solve(input: SolverInput): SolverResult {
  const { range, base, daysInMonth: D, employees } = input
  if (!range || (range.from <= 1 && range.to >= D)) return solveMonth(input)

  const from = Math.max(1, Math.min(range.from, range.to))
  const to = Math.min(D, Math.max(range.from, range.to))
  const L = to - from + 1
  // co ràng buộc theo tỉ lệ L/D: trần ca làm tròn LÊN (giữ đủ công suất phủ ca), sàn ca đêm làm tròn XUỐNG
  const subEmployees: Employee[] = employees.map((e) => ({
    ...e,
    days_off: e.days_off.filter((d) => d >= from && d <= to).map((d) => d - from + 1),
    max_shifts_per_month: Math.min(L, Math.ceil((e.max_shifts_per_month * L) / D)),
    min_night_shifts: e.prefer_night ? Math.min(L, Math.floor((e.min_night_shifts * L) / D)) : 0,
  }))
  // chỗ nối đầu khoảng: các ngày trước `from` (trong lịch hiện có) đóng vai "cuối tháng trước"
  const subTail: Record<string, Shift[]> = {}
  for (const e of employees) {
    const before = (base?.[e.id] ?? []).slice(0, from - 1)
    const tail = [...(input.prevTail?.[e.id] ?? []), ...before]
    if (tail.length > 0) subTail[e.id] = tail
  }
  const sub = solveMonth({ ...input, employees: subEmployees, daysInMonth: L, range: undefined, base: undefined, prevTail: subTail })

  const matrix: ScheduleMatrix = {}
  for (const e of employees) {
    const row = new Array<Shift>(D).fill('OFF')
    const old = base?.[e.id]
    if (old) for (let d = 0; d < D; d++) row[d] = old[d] ?? 'OFF'
    const fresh = sub.matrix[e.id]
    if (fresh) for (let i = 0; i < L; i++) row[from - 1 + i] = fresh[i] ?? 'OFF'
    matrix[e.id] = row
  }
  const violations = validateMatrix({
    employees,
    matrix,
    daysInMonth: D,
    minPerShift: input.minPerShift,
    streakMin: input.streakMin,
    streakMax: input.streakMax,
    restMax: input.restMax,
    prevTail: input.prevTail,
    // ngoài khoảng có thể là OFF (chưa có lịch) → không chấm cân bằng cả tháng
    skipBalance: !base,
  })
  return { ok: violations.length === 0 && sub.conflicts.length === 0, matrix, violations, conflicts: sub.conflicts }
}

function solveMonth(rawInput: SolverInput): SolverResult {
  // gắn carry-in (chuỗi dở từ tháng trước) vào từng người; chuỗi đã đủ dài → ngày 1 bắt buộc nghỉ
  const input: SolverInput = {
    ...rawInput,
    employees: rawInput.employees.map((e) => {
      const carry = carryOf(rawInput.prevTail?.[e.id])
      const daysOff =
        carry && carry.run >= rawInput.streakMax && !e.days_off.includes(1)
          ? [1, ...e.days_off].sort((a, b) => a - b)
          : e.days_off
      return { ...e, carry_in: carry, days_off: daysOff }
    }),
  }
  const { employees, daysInMonth: D, minPerShift } = input
  const conflicts = diagnose(input)
  const rng = mulberry32(input.seed || 1)

  const emptyMatrix = (): ScheduleMatrix =>
    Object.fromEntries(employees.map((e) => [e.id, new Array<Shift>(D).fill('OFF')]))

  if (employees.length === 0) {
    return { ok: false, matrix: emptyMatrix(), violations: [], conflicts: ['Chưa có nhân viên nào.'] }
  }

  // phân bổ tổng ca: đều nhau ±1, tôn trọng max cá nhân.
  // Cộng thêm chút slack (vài ca dư so với mức tối thiểu) để bài toán tô ca bớt căng cứng —
  // độ phủ là "tối thiểu N" nên thừa người một vài ca không sao.
  const perDay = needPerDay(minPerShift)
  const needTotal = perDay * D
  const cap = employees.map((e) => Math.min(e.max_shifts_per_month, D - e.days_off.length))
  const capSum = cap.reduce((s, c) => s + c, 0)
  const byCapDesc = employees.map((_, i) => i).sort((a, b) => cap[b] - cap[a])

  const computeTargets = (slack: number): number[] => {
    const desired = Math.min(needTotal + slack, Math.max(needTotal, capSum))
    const base = Math.floor(desired / employees.length)
    let extra = desired % employees.length
    const t = employees.map((_, i) => Math.min(base, cap[i]))
    for (const i of byCapDesc) {
      if (extra > 0 && cap[i] >= base + 1) {
        t[i] = base + 1
        extra--
      }
    }
    // nếu còn thiếu do bị cap, dồn cho người còn dư công suất (chấp nhận lệch cân bằng, đã cảnh báo)
    let shortfall = needTotal - t.reduce((s, x) => s + x, 0)
    for (const i of byCapDesc) {
      while (shortfall > 0 && t[i] < cap[i]) {
        t[i]++
        shortfall--
      }
    }
    return t
  }
  const slackMax = Math.max(2, Math.floor(employees.length / 3))
  // slack tối đa cho mọi restart — bench cho thấy slack thấp khó khả thi hơn hẳn
  const slackCycle = [slackMax]
  let targets = computeTargets(slackMax)

  let best: Evaluated | null = null

  // quota ca đêm là ưu tiên mềm — không phải vi phạm, nhưng dùng làm tie-breaker
  // để solver vẫn trả về phương án đạt quota cao nhất có thể
  const nightShortfall = (matrix: ScheduleMatrix): number =>
    employees.reduce((sum, e) => {
      if (!e.prefer_night || e.no_s3 || e.min_night_shifts <= 0) return sum
      const nights = (matrix[e.id] ?? []).filter((s) => s === 'S3').length
      return sum + Math.max(0, e.min_night_shifts - nights)
    }, 0)

  // rule chia đều ca cho nhóm không làm đêm — fairHard: phần vượt ngưỡng (rule chưa đạt),
  // fairSoft: tổng chênh lệch thô để tie-break
  const fairnessOf = (matrix: ScheduleMatrix) => evaluateFairnessMatrix(employees, matrix, minPerShift)

  const evaluate = (blocks: Block[], shiftOf: (Shift | null)[]) => {
    const matrix = emptyMatrix()
    blocks.forEach((b, bi) => {
      const s = shiftOf[bi]
      if (!s || s === 'OFF') return
      const row = matrix[employees[b.empIdx].id]
      for (let d = b.start; d < b.start + b.len; d++) row[d] = s
    })
    const violations = validateMatrix({
      employees,
      matrix,
      daysInMonth: D,
      minPerShift,
      streakMin: input.streakMin,
      streakMax: input.streakMax,
      restMax: input.restMax,
      prevTail: input.prevTail,
    })
    // lịch đã hợp lệ → san đều ca bằng hoán đổi đoạn lịch (giữ nguyên độ phủ & cấu trúc block)
    if (violations.length === 0 && fairnessOf(matrix).hard > 0) {
      fairnessPolish(employees, matrix, D, { streakMin: input.streakMin, streakMax: input.streakMax, restMax: input.restMax }, rng, Date.now() + 600, minPerShift)
    }
    const fair = fairnessOf(matrix)
    return { matrix, violations, shortfall: nightShortfall(matrix), fairHard: fair.hard, fairSoft: fair.soft }
  }

  type Evaluated = ReturnType<typeof evaluate>
  const betterThan = (a: Evaluated, b: Evaluated | null): boolean => {
    if (!b) return true
    if (a.violations.length !== b.violations.length) return a.violations.length < b.violations.length
    // ưu tiên CHIA ĐỀU trước quota ca đêm (quota là ưu tiên mềm) — rồi mới tới chênh lệch thô
    if (a.fairHard !== b.fairHard) return a.fairHard < b.fairHard
    if (a.shortfall !== b.shortfall) return a.shortfall < b.shortfall
    return a.fairSoft < b.fairSoft
  }
  // "hoàn hảo" bao gồm cả chia đều: chỉ dừng sớm khi các ca đã chia đều đạt ngưỡng
  const perfect = (r: Evaluated) => r.violations.length === 0 && r.shortfall === 0 && r.fairHard === 0
  // khi đã đạt mọi rule vẫn dành thêm tối đa 1.5s để giảm chênh lệch ca giữa mọi người xuống thấp nhất
  // (hoán đổi đoạn giữ nguyên độ phủ & cấu trúc block, chỉ nhận khi chênh lệch giảm)
  const finish = (matrix: ScheduleMatrix): SolverResult => {
    const streak = { streakMin: input.streakMin, streakMax: input.streakMax, restMax: input.restMax }
    fairnessPolish(employees, matrix, D, streak, rng, Date.now() + 1500, minPerShift)
    return { ok: true, matrix, violations: [], conflicts }
  }

  const P1_TRIES = 24
  const P2_TRIES = 3
  const deadline = Date.now() + 9000 // ngân sách thời gian — bài vô nghiệm không cày mãi
  const t0 = Date.now()
  for (let a1 = 0; a1 < P1_TRIES; a1++) {
    if (Date.now() > deadline) break
    // đã có lịch hợp lệ (chỉ còn rule chia đều) sau vài restart → dừng restart,
    // dồn ngân sách cho vòng san đều ca ở cuối (hiệu quả hơn restart thêm)
    if (best && best.violations.length === 0 && best.shortfall === 0 && (a1 >= 4 || Date.now() - t0 > 3000)) break
    targets = computeTargets(slackCycle[a1 % slackCycle.length])
    // chiến lược A: integrated builder — đặt block kèm ca, rồi đan xen
    // (chain repair đổi màu block) ↔ (LNS xây lại pattern từng người)
    let rowsA = buildIntegrated(input, targets, rng)
    if (rowsA) {
      for (let cycle = 0; cycle < 3; cycle++) {
        const rowsCur: Shift[][] = rowsA
        const patternsA = rowsCur.map((row) => row.map((s) => s !== 'OFF'))
        const blocksA = extractBlocks(patternsA, D)
        const initial = blocksA.map((b) => rowsCur[b.empIdx][b.start])
        const rRaw = evaluate(blocksA, initial.slice())
        if (betterThan(rRaw, best)) best = rRaw
        // không return sớm trên bản thô — luôn qua repair + polish để chia đều ca
        const rep = assignShifts(blocksA, employees, D, minPerShift, rng, initial)
        const rFix = evaluate(blocksA, rep.shiftOf)
        if (betterThan(rFix, best)) best = rFix
        if (perfect(rFix)) {
          return finish(rFix.matrix)
        }
        // dựng lại rows từ kết quả đã vá rồi cho LNS di chuyển pattern
        const next: Shift[][] = employees.map(() => new Array<Shift>(D).fill('OFF'))
        blocksA.forEach((b, bi) => {
          const s = rep.shiftOf[bi]
          if (!s || s === 'OFF') return
          for (let d = b.start; d < b.start + b.len; d++) next[b.empIdx][d] = s
        })
        lnsRefine(input, targets, next, rng)
        rowsA = next
      }
    }

    // chiến lược B: pipeline hai pha cũ (đa dạng hóa restart, chạy thưa)
    if (a1 % 3 !== 2) continue
    const patterns = buildAllPatterns(input, targets, rng)
    if (!patterns) continue
    const blocks = extractBlocks(patterns, D)

    let bestLocal: Evaluated | null = null
    for (let a2 = 0; a2 < P2_TRIES; a2++) {
      const { shiftOf } = assignShifts(blocks, employees, D, minPerShift, rng, undefined)
      const r = evaluate(blocks, shiftOf)
      if (betterThan(r, bestLocal)) bestLocal = r
      if (betterThan(r, best)) best = r
      if (perfect(r)) {
        return finish(r.matrix)
      }
    }

    // feedback pha 1 ← pha 2: nếu chỉ còn vài lỗ độ phủ, bơm thêm 1 người
    // vào đúng những ngày đó (cột 7 người cho tô ca dư địa xoay) rồi tô lại
    if (
      bestLocal &&
      bestLocal.violations.length <= 4 &&
      bestLocal.violations.every((v) => v.type === 'coverage')
    ) {
      const needArr = new Array<number>(D).fill(perDay)
      for (const v of bestLocal.violations) if (v.day) needArr[v.day - 1] = perDay + 1
      const colCount = new Array<number>(D).fill(0)
      patterns.forEach((p) => p.forEach((w, d) => { if (w) colCount[d]++ }))
      rebalanceColumns(patterns, colCount, employees, input, rng, needArr)
      const blocks2 = extractBlocks(patterns, D)
      for (let a3 = 0; a3 < 3; a3++) {
        const { shiftOf } = assignShifts(blocks2, employees, D, minPerShift, rng, undefined)
        const r = evaluate(blocks2, shiftOf)
        if (betterThan(r, best)) best = r
        if (perfect(r)) {
          return finish(r.matrix)
        }
      }
    }
  }

  if (!best) {
    return {
      ok: false,
      matrix: emptyMatrix(),
      violations: [],
      conflicts: [...conflicts, 'Không sinh được pattern làm/nghỉ hợp lệ — kiểm tra lại ngày nghỉ cố định và cài đặt chuỗi làm/nghỉ.'],
    }
  }

  // polish cuối: dồn budget vào phương án tốt nhất thay vì restart thêm
  // (chạy cả khi chỉ còn hụt quota đêm — quota là ưu tiên mềm nhưng vẫn cố đạt)
  const endDeadline = Math.min(deadline + 3000, Date.now() + 6000)
  for (
    let polish = 0;
    polish < 40 &&
    (best.violations.length > 0 || best.shortfall > 0 || best.fairHard > 0) &&
    Date.now() < endDeadline;
    polish++
  ) {
    const rowsP: Shift[][] = employees.map((e) => best!.matrix[e.id].slice())
    if (best.violations.length === 0 && best.shortfall === 0) {
      // chỉ còn rule chia đều chưa đạt → LNS theo cặp nhắm thẳng vào các người đang lệch,
      // xen kẽ với hoán đổi đoạn (trong evaluate)
      fairnessLns(input, targets, rowsP, rng, Math.min(endDeadline, Date.now() + 1200))
    } else {
      lnsRefine(input, targets, rowsP, rng)
    }
    const patternsP = rowsP.map((row) => row.map((s) => s !== 'OFF'))
    const blocksP = extractBlocks(patternsP, D)
    const initialP = blocksP.map((b) => rowsP[b.empIdx][b.start])
    const rRawP = evaluate(blocksP, initialP.slice())
    if (betterThan(rRawP, best)) best = rRawP
    if (best.violations.length > 0 || best.shortfall > 0) {
      const repP = assignShifts(blocksP, employees, D, minPerShift, rng, initialP)
      const rP = evaluate(blocksP, repP.shiftOf)
      if (betterThan(rP, best)) best = rP
    }
    if (perfect(best)) {
      return finish(best.matrix)
    }
  }
  if (best.violations.length === 0) {
    // hợp lệ 100% — có thể còn hụt quota đêm / chưa chia đều tuyệt đối, đều là ưu tiên mềm
    return finish(best.matrix)
  }
  return {
    ok: false,
    matrix: best.matrix,
    violations: best.violations,
    conflicts:
      conflicts.length > 0
        ? conflicts
        : ['Không tìm được lịch thỏa mãn 100% ràng buộc — trả về phương án tốt nhất, các ô vi phạm được tô đỏ. Thử "Tạo lại (shuffle)" hoặc nới ràng buộc.'],
  }
}
