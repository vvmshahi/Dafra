interface Props {
  children: React.ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className = '', padding = true }: Props) {
  return (
    <div className={`card ${padding ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  )
}
