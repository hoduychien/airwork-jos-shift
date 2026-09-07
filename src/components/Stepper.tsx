import { useEffect, useState } from 'react'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** cỡ nhỏ để đặt trong dòng chữ */
  size?: 'sm' | 'md'
  /** chữ nhỏ sau số, vd "ngày", "ca" */
  suffix?: string
  'aria-label'?: string
  id?: string
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Ô số dùng chung cho cả dự án: gõ tay được (chốt khi rời ô / Enter),
 * phím ↑↓ hoặc 2 nút − / + để tăng giảm, luôn kẹp trong [min, max].
 */
export default function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  disabled,
  size = 'md',
  suffix,
  id,
  ...rest
}: Props) {
  // bản nháp khi đang gõ — cho phép xoá trống rồi gõ số mới
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])

  const commit = (raw: string) => {
    setDraft(null)
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n)) return
    const v = clamp(Math.round(n), min, max)
    if (v !== value) onChange(v)
  }
  const bump = (dir: 1 | -1) => {
    const v = clamp(value + dir * step, min, max)
    if (v !== value) onChange(v)
  }

  return (
    <div className={`stepper stepper-${size}`} data-disabled={disabled || undefined}>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => bump(-1)}
        disabled={disabled || value <= min}
        aria-label="Giảm"
        tabIndex={-1}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <span className="stepper-mid">
      <input
        id={id}
        className="stepper-value"
        size={3}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={rest['aria-label']}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d-]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            bump(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            bump(-1)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
          } else if (e.key === 'Escape') {
            setDraft(null)
          }
        }}
      />
      {suffix && <span className="stepper-suffix">{suffix}</span>}
      </span>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => bump(1)}
        disabled={disabled || value >= max}
        aria-label="Tăng"
        tabIndex={-1}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
