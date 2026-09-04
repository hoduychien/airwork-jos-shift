import { useMemo, useState } from 'react'
import type { Employee, ScheduleMatrix, Settings, Violation } from '../lib/types'
import { FAIR_SPREAD, evaluateFairnessMatrix, fairnessSummary } from '../lib/solver/fairness'

/* Hallmark · component: rule-checklist · theme: Cobalt
 * Checklist tuân thủ: mỗi rule nghiệp vụ một dòng, ✓/✗ suy ra từ validateMatrix
 * (cùng một nguồn sự thật với highlight ô đỏ) — bấm dòng ✗ để xem chi tiết. */

interface Rule {
  key: string
  label: string
  /** các loại vi phạm quy về rule này */
  types: Violation['type'][]
  /** ghi chú thêm khi rule ĐẠT */
  extra?: () => string[]
  /** kiểm tra riêng ngoài validator (trả về mô tả lỗi, [] nếu đạt) */
  checkFails?: () => string[]
}

interface Props {
  employees: Employee[]
  matrix: ScheduleMatrix
  settings: Settings
  violations: Violation[]
}

export default function RuleChecklist({ employees, matrix, settings, violations }: Props) {
  const [open, setOpen] = useState<string | null>(null)

  const rules = useMemo<Rule[]>(() => {
    const nightPref = employees.filter((e) => e.prefer_night && !e.no_s3 && e.min_night_shifts > 0)
    return [
      {
        key: 'coverage',
        label: `Độ phủ: mỗi ngày, mỗi ca có tối thiểu ${settings.min_per_shift} người`,
        types: ['coverage'],
      },
      {
        key: 'rest16',
        label: 'Nghỉ giữa 2 ngày làm > 8 tiếng — 2 ngày làm liên tiếp luôn cùng ca (nghỉ 16h), không có chuyển ca S2→S1, S3→S2, S3→S1 liền kề',
        types: ['adjacent-switch'],
      },
      {
        key: 'streak',
        label: `Chuỗi làm ${settings.streak_min}-${settings.streak_max} ngày liên tục cùng một ca, không chuỗi nào vượt ${settings.streak_max} ngày`,
        types: ['streak-too-long', 'streak-too-short'],
      },
      {
        key: 'balance',
        label: 'Cân bằng khối lượng: chênh lệch tổng ca giữa người nhiều nhất và ít nhất ≤ 1',
        types: ['balance'],
        extra: () => {
          const totals = employees.map((e) => (matrix[e.id] ?? []).filter((s) => s !== 'OFF').length)
          if (totals.length === 0) return []
          return [`Tổng ca: ${Math.min(...totals)}–${Math.max(...totals)} ca/người`]
        },
      },
      {
        key: 'max-shifts',
        label: 'Không ai vượt số ca tối đa/tháng đã cấu hình',
        types: ['max-shifts'],
      },
      ...(nightPref.length > 0
        ? [
            {
              key: 'night',
              label: `Người ưu tiên ca đêm vẫn có ≥2 ca S1 và ≥2 ca S2 (quota S3 là ưu tiên mềm — làm ít hơn số đăng ký vẫn hợp lệ)`,
              types: ['min-night'] as Violation['type'][],
              extra: () =>
                nightPref.map((e) => {
                  const nights = (matrix[e.id] ?? []).filter((s) => s === 'S3').length
                  return `${e.name}: ${nights}/${e.min_night_shifts} ca đêm`
                }),
            },
          ]
        : []),
      {
        key: 'no-shift',
        label: 'Không ai bị xếp vào ca đã đăng ký KHÔNG làm (không S1 / không S2 / không S3)',
        types: ['pref-no-shift'],
      },
      {
        key: 'even-split',
        label: `Chia đều ca cho mọi nhân viên: trong cùng nhóm ràng buộc, mỗi loại ca chênh ≤ ${FAIR_SPREAD}; người làm cả S1 và S2 có |S1 − S2| ≤ ${FAIR_SPREAD} (nhóm ưu tiên đêm chỉ san đều mềm vì quota khác nhau)`,
        types: [],
        checkFails: () => evaluateFairnessMatrix(employees, matrix).messages,
        extra: () => fairnessSummary(employees, matrix),
      },
      {
        key: 'day-off',
        label: 'Ngày nghỉ cố định đã đăng ký đều được OFF',
        types: ['pref-day-off'],
      },
    ]
  }, [employees, matrix, settings])

  const byRule = useMemo(() => {
    const map = new Map<string, { message: string }[]>()
    for (const r of rules) {
      map.set(r.key, [
        ...violations.filter((v) => r.types.includes(v.type)),
        ...(r.checkFails?.() ?? []).map((message) => ({ message })),
      ])
    }
    return map
  }, [rules, violations])

  const failCount = rules.filter((r) => (byRule.get(r.key) ?? []).length > 0).length

  return (
    <section className="card !py-4" aria-label="Kiểm tra tuân thủ ràng buộc">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 style={{ fontSize: 'var(--text-md)' }}>Kiểm tra tuân thủ</h2>
        <span className={`badge ${failCount === 0 ? 'badge-published' : 'badge-danger'}`}>
          {failCount === 0 ? `PASS ${rules.length}/${rules.length}` : `FAIL ${failCount}/${rules.length}`}
        </span>
      </div>
      <ul className="status-list">
        {rules.map((r) => {
          const fails = byRule.get(r.key) ?? []
          const ok = fails.length === 0
          const note = ok && r.extra ? r.extra() : []
          const expanded = open === r.key
          return (
            <li key={r.key} className="status-row">
              <span className="status-tag" data-ok={ok ? 'true' : 'false'} aria-hidden>
                {ok ? 'PASS' : 'FAIL'}
              </span>
              <div>
                <div
                  style={{ color: ok ? 'var(--color-ink)' : 'var(--color-danger)', cursor: ok ? 'default' : 'pointer' }}
                  onClick={() => {
                    if (!ok) setOpen(expanded ? null : r.key)
                  }}
                  role={ok ? undefined : 'button'}
                  aria-expanded={ok ? undefined : expanded}
                >
                  {r.label}
                  {!ok && <strong> — {fails.length} vi phạm{expanded ? '' : ' (bấm để xem)'}</strong>}
                </div>
                {note.length > 0 && <div className="status-note">{note.join(' · ')}</div>}
                {expanded && (
                  <ul className="status-fails">
                    {fails.slice(0, 6).map((v, i) => (
                      <li key={i}>{v.message}</li>
                    ))}
                    {fails.length > 6 && <li>… và {fails.length - 6} vi phạm khác</li>}
                  </ul>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
