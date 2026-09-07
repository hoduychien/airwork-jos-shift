import { useEffect, useRef, useState } from 'react'
import DatePicker from 'react-date-picker'
import 'react-date-picker/dist/DatePicker.css'
import 'react-calendar/dist/Calendar.css'

/* Ô chọn 1 ngày dùng chung — cùng bộ (react-date-picker + react-calendar) và cùng style
 * với popup chọn khoảng ngày (scope CSS `.app-date` trong layout.css).
 * Giá trị là chuỗi YYYY-MM-DD hoặc null; chỉ chọn trên lịch, không gõ tay. */

export function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  )
}

export function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === 'left' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

/** props chung cho lịch của app: tiếng Việt, dd/mm/yyyy, mũi tên nét mảnh, không nút nhảy năm */
export const calendarProps = {
  prevLabel: <Chevron dir="left" />,
  nextLabel: <Chevron dir="right" />,
  prev2Label: null,
  next2Label: null,
}

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromIso = (s: string | null | undefined): Date | null => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return y && m && d ? new Date(y, m - 1, d) : null
}

interface Props {
  value: string | null | undefined
  onChange: (iso: string | null) => void
  min?: string | null
  max?: string | null
  disabled?: boolean
  /** cho phép xoá về trống (mặc định có) */
  clearable?: boolean
  'aria-label'?: string
}

export default function DateField({ value, onChange, min, max, disabled, clearable = true, ...rest }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // khóa các ô dd/mm/yyyy (readOnly, bỏ khỏi tab) — chỉ chọn trên lịch, giống popup khoảng ngày
  useEffect(() => {
    ref.current?.querySelectorAll<HTMLInputElement>('.react-date-picker__inputGroup input').forEach((el) => {
      el.readOnly = true
      el.tabIndex = -1
    })
  }, [value])
  return (
    <div ref={ref} className="app-date" data-disabled={disabled || undefined} onClick={() => !disabled && setOpen(true)}>
      <DatePicker
        isOpen={open}
        onCalendarOpen={() => setOpen(true)}
        onCalendarClose={() => setOpen(false)}
        value={fromIso(value)}
        onChange={(v) => onChange(v instanceof Date ? toIso(v) : null)}
        minDate={fromIso(min) ?? undefined}
        maxDate={fromIso(max) ?? undefined}
        disabled={disabled}
        locale="vi-VN"
        format="dd/MM/y"
        dayPlaceholder="dd"
        monthPlaceholder="mm"
        yearPlaceholder="yyyy"
        clearIcon={clearable && value ? <ClearIcon /> : null}
        clearAriaLabel="Xoá ngày"
        calendarIcon={<CalendarIcon />}
        calendarAriaLabel="Mở lịch"
        calendarProps={calendarProps}
        {...(rest['aria-label'] ? { 'aria-label': rest['aria-label'] } : {})}
      />
    </div>
  )
}
