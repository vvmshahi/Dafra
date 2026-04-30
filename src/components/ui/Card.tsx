interface Props {
  children: React.ReactNode
  className?: string
  padding?: boolean
  hover?: boolean
}

export function Card({ children, className = '', padding = true, hover = false }: Props) {
  return (
    <div className={`card ${padding ? 'p-6' : ''} ${hover ? 'transition-shadow hover:shadow-card-md cursor-pointer' : ''} ${className}`}>
      {children}
    </div>
  )
}
