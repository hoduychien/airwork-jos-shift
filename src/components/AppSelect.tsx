import Select from 'react-select'

/* Hallmark · component: select · theme: Cobalt — react-select style qua token,
 * states: default · hover · focus · active · disabled đủ theo styles API */

export interface Option<T extends string | number> {
  value: T
  label: string
}

interface Props<T extends string | number> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label'?: string
  inputId?: string
  width?: string
  disabled?: boolean
}

export default function AppSelect<T extends string | number>({
  options,
  value,
  onChange,
  inputId,
  width = '9rem',
  disabled,
  ...rest
}: Props<T>) {
  return (
    <Select<Option<T>>
      inputId={inputId}
      aria-label={rest['aria-label']}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => {
        if (o) onChange(o.value)
      }}
      isDisabled={disabled}
      isSearchable={false}
      // menu render trong body để không bị bảng lịch (overflow) cắt mất
      menuPortalTarget={document.body}
      styles={{
        container: (base) => ({ ...base, width }),
        control: (base, state) => ({
          ...base,
          minHeight: '2.25rem',
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          borderRadius: 'var(--radius-sm)',
          borderColor: state.isFocused ? 'var(--color-ink)' : 'var(--color-line-strong)',
          boxShadow: 'none',
          cursor: 'pointer',
          transition: 'border-color var(--dur-fast) var(--ease-out)',
          backgroundColor: state.isDisabled ? 'var(--color-paper-2)' : 'white',
          ':hover': { borderColor: state.isFocused ? 'var(--color-ink)' : 'var(--color-ink-3)' },
        }),
        valueContainer: (base) => ({ ...base, padding: '0 0.6rem' }),
        singleValue: (base) => ({ ...base, color: 'var(--color-ink)' }),
        indicatorSeparator: () => ({ display: 'none' }),
        dropdownIndicator: (base, state) => ({
          ...base,
          padding: '0 0.5rem',
          color: 'var(--color-ink-3)',
          transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : undefined,
          transition: 'transform var(--dur-base) var(--ease-out)',
          ':hover': { color: 'var(--color-ink-2)' },
        }),
        menuPortal: (base) => ({ ...base, zIndex: 70 }),
        menu: (base) => ({
          ...base,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-line)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }),
        option: (base, state) => ({
          ...base,
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          padding: '0.45rem 0.7rem',
          cursor: 'pointer',
          backgroundColor: state.isSelected
            ? 'var(--color-accent)'
            : state.isFocused
              ? 'var(--color-accent-soft)'
              : 'white',
          color: state.isSelected ? 'var(--color-accent-ink)' : 'var(--color-ink)',
          ':active': { backgroundColor: 'var(--color-accent-soft)' },
        }),
      }}
    />
  )
}
