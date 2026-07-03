interface MeemLogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

export function MeemLogo({ size = 'md', showText = true }: MeemLogoProps) {
  const sizes = {
    sm: { box: 'w-8 h-8',   letter: 'text-lg',  name: 'text-lg',  sub: 'text-xs'  },
    md: { box: 'w-10 h-10', letter: 'text-xl',  name: 'text-xl',  sub: 'text-sm'  },
    lg: { box: 'w-14 h-14', letter: 'text-3xl', name: 'text-2xl', sub: 'text-base' },
  }
  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.box} rounded-xl bg-gold-500 flex items-center justify-center shadow-lg flex-shrink-0`}>
        <span className={`${s.letter} text-white font-black`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
          K
        </span>
      </div>
      {showText && (
        <div className="flex flex-col leading-tight">
          <span className={`${s.name} font-bold text-gold-500`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
            Kubri
          </span>
          <span className={`${s.sub} text-gold-400 tracking-widest uppercase font-medium`}>
            POS
          </span>
        </div>
      )}
    </div>
  )
}
