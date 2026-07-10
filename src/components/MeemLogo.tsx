interface MeemLogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

const KUBRI_WORDMARK_SRC = '/brand/kubiri-wordmark.png?v=kubri-2'
const KUBRI_MARK_SRC = '/brand/kubiri-logo-mark.png?v=kubri-2'

export function MeemLogo({ size = 'md', showText = true }: MeemLogoProps) {
  const sizes = {
    sm: { markBox: 'w-8 h-8',  mark: 'w-7 h-7',   wordmark: 'h-9 w-auto' },
    md: { markBox: 'w-10 h-10', mark: 'w-9 h-9',   wordmark: 'h-12 w-auto' },
    lg: { markBox: 'w-14 h-14', mark: 'w-12 h-12', wordmark: 'h-16 w-auto' },
  }
  const s = sizes[size]

  if (showText) {
    return (
      <img
        src={KUBRI_WORDMARK_SRC}
        alt="Kubri"
        className={`${s.wordmark} object-contain object-left`}
      />
    )
  }

  return (
    <div className="flex items-center">
      <div className={`${s.markBox} flex items-center justify-center flex-shrink-0`}>
        <img
          src={KUBRI_MARK_SRC}
          alt="Kubri"
          className={`${s.mark} object-contain`}
        />
      </div>
    </div>
  )
}
