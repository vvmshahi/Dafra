import { forwardRef, useId } from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  icon?: LucideIcon
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, helperText, icon: Icon, className = '', id, ...props }, ref) => {
    const generatedId = useId().replace(/:/g, '')
    const inputId = id ?? `field-${generatedId}`
    const helperId = helperText && !error ? `${inputId}-helper` : undefined
    const errorId = error ? `${inputId}-error` : undefined
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="label text-start">
            {label}
          </label>
        )}
        <div className="relative">
          {Icon && (
            <div className="pointer-events-none absolute inset-y-0 start-3.5 flex items-center">
              <Icon size={16} className="text-gray-400" />
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId ?? helperId}
            className={`input ${Icon ? 'ps-10' : ''} ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''} ${className}`}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="mt-1.5 text-xs text-red-600 text-start" dir="auto" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="mt-1.5 text-xs text-gray-500 text-start">
            {helperText}
          </p>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'
