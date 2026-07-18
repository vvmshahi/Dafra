import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  icon?: LucideIcon
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, helperText, icon: Icon, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
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
            className={`input ${Icon ? 'ps-10' : ''} ${error ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' : ''} ${className}`}
            {...props}
          />
        </div>
        {error      && <p className="mt-1.5 text-xs text-red-600 text-start" dir="auto">{error}</p>}
        {helperText && !error && <p className="mt-1.5 text-xs text-gray-500 text-start">{helperText}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
