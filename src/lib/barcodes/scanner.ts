export interface ScannerCapture {
  code: string
  durationMs: number
  terminator: 'enter' | 'tab' | 'idle'
  characterCount: number
}

export interface ScannerOptions {
  maxInterCharacterMs?: number
  idleCompletionMs?: number
  minimumLength?: number
  maximumDurationMs?: number
  now?: () => number
}

export function isEditableScannerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-scanner-ignore="true"], [role="dialog"]')) return true
  const editable = target.closest('input, textarea, select, [contenteditable="true"]')
  return editable !== null
}

export class KeyboardWedgeCapture {
  private buffer = ''
  private startedAt = 0
  private lastAt = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly maxInterCharacterMs: number
  private readonly idleCompletionMs: number
  private readonly minimumLength: number
  private readonly maximumDurationMs: number
  private readonly now: () => number

  constructor(
    private readonly onCapture: (capture: ScannerCapture) => void,
    options: ScannerOptions = {},
  ) {
    this.maxInterCharacterMs = options.maxInterCharacterMs ?? 45
    this.idleCompletionMs = options.idleCompletionMs ?? 90
    this.minimumLength = options.minimumLength ?? 3
    this.maximumDurationMs = options.maximumDurationMs ?? 1500
    this.now = options.now ?? (() => performance.now())
  }

  reset() {
    this.buffer = ''
    this.startedAt = 0
    this.lastAt = 0
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  handle(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'isComposing'>): boolean {
    if (event.repeat || event.isComposing) return false
    const now = this.now()
    if (event.key === 'Enter' || event.key === 'Tab') {
      const accepted = this.complete(event.key === 'Tab' ? 'tab' : 'enter', now)
      if (!accepted) this.reset()
      return accepted
    }
    if (event.key.length !== 1 || /[\u0000-\u001f\u007f]/.test(event.key)) return false
    if (this.buffer && now - this.lastAt > this.maxInterCharacterMs) this.reset()
    if (!this.buffer) this.startedAt = now
    this.buffer += event.key
    this.lastAt = now
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.complete('idle', this.now()), this.idleCompletionMs)
    return false
  }

  private complete(terminator: ScannerCapture['terminator'], now: number): boolean {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const code = this.buffer
    const durationMs = Math.max(0, now - this.startedAt)
    this.buffer = ''
    this.startedAt = 0
    this.lastAt = 0
    if (code.length < this.minimumLength || durationMs > this.maximumDurationMs) return false
    this.onCapture({ code, durationMs, terminator, characterCount: code.length })
    return true
  }
}

export class OrderedScanQueue {
  private tail = Promise.resolve()
  private queued = 0

  enqueue(task: () => Promise<void>): Promise<void> {
    this.queued += 1
    const run = async () => {
      try {
        await task()
      } finally {
        this.queued -= 1
      }
    }
    this.tail = this.tail.then(run, run)
    return this.tail
  }

  get pending(): number {
    return this.queued
  }

  whenIdle(): Promise<void> {
    return this.tail
  }
}
