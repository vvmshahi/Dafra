import type { ButtonHTMLAttributes } from 'react'

type SwitchSize = 'sm' | 'md'

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked: boolean
  onChange: (checked: boolean) => void
  size?: SwitchSize
  ariaLabel?: string
}

const sizes: Record<SwitchSize, { track: string; thumb: string; translate: string }> = {
  sm: {
    track: 'h-5 w-9',
    thumb: 'h-4 w-4',
    translate: 'translate-x-4',
  },
  md: {
    track: 'h-6 w-11',
    thumb: 'h-5 w-5',
    translate: 'translate-x-5',
  },
}

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function Switch({
  checked,
  onChange,
  disabled,
  size = 'md',
  className,
  ariaLabel,
  ...props
}: SwitchProps) {
  const selectedSize = sizes[size]
  const label = ariaLabel ?? props['aria-label']

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
      className={classes(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'bg-primary-500' : 'bg-gray-200',
        selectedSize.track,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={classes(
          'block rounded-full bg-white shadow-sm transition-transform',
          selectedSize.thumb,
          checked ? selectedSize.translate : 'translate-x-0',
        )}
      />
    </button>
  )
}
