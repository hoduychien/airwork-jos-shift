interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  disabled?: boolean
  'aria-label'?: string
}

/** Ô số chỉ tăng/giảm bằng 2 nút − / + (không gõ tay). */
export default function Stepper({ value, onChange, min = 0, max = 99, disabled, ...rest }: Props) {
  const dec = () => onChange(Math.max(min, value - 1))
  const inc = () => onChange(Math.min(max, value + 1))
  return (
    <div className="stepper" role="group" aria-label={rest['aria-label']}>
      <button type="button" className="stepper-btn" onClick={dec} disabled={disabled || value <= min} aria-label="Giảm">
        −
      </button>
      <output className="stepper-value" aria-live="polite">
        {value}
      </output>
      <button type="button" className="stepper-btn" onClick={inc} disabled={disabled || value >= max} aria-label="Tăng">
        +
      </button>
    </div>
  )
}
