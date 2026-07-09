interface MeemLogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

export function MeemLogo({ size = 'md', showText = true }: MeemLogoProps) {
  const sizes = {
    sm: { box: 'w-8 h-8',   mark: 'w-7 h-7',    name: 'text-lg',  sub: 'text-xs'  },
    md: { box: 'w-10 h-10', mark: 'w-9 h-9',    name: 'text-xl',  sub: 'text-sm'  },
    lg: { box: 'w-14 h-14', mark: 'w-12 h-12',  name: 'text-2xl', sub: 'text-base' },
  }
  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.box} flex items-center justify-center flex-shrink-0`}>
        <img
          src="/brand/kubri-logo-mark.png"
          alt="Kubri"
          className={`${s.mark} object-contain`}
        />
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
