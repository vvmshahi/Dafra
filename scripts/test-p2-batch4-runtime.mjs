import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html lang="en" dir="ltr"><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
dom.window.requestAnimationFrame = callback => dom.window.setTimeout(() => callback(Date.now()), 0)
dom.window.cancelAnimationFrame = id => dom.window.clearTimeout(id)

const globals = [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'MutationObserver', 'getComputedStyle',
  'localStorage', 'sessionStorage',
]
for (const name of globals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: dom.window[name],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}

const unexpected = []
const originalError = console.error
const originalWarn = console.warn
console.error = (...args) => { unexpected.push(`error: ${args.join(' ')}`) }
console.warn = (...args) => { unexpected.push(`warn: ${args.join(' ')}`) }

const server = await createServer({
  appType: 'custom',
  server: { middlewareMode: true },
  logLevel: 'error',
})

try {
  const harness = await server.ssrLoadModule('/scripts/runtime/p2-batch4-interactions.harness.tsx')
  const covered = await harness.run()
  if (unexpected.length) throw new Error(`Unexpected runtime console output:\n${unexpected.join('\n')}`)
  console.error = originalError
  console.warn = originalWarn
  for (const item of covered) console.log(`✓ ${item}`)
  console.log(`P2 Batch 4 runtime interactions passed (${covered.length} suites).`)
} catch (error) {
  console.error = originalError
  console.warn = originalWarn
  originalError(error)
  process.exitCode = 1
} finally {
  await server.close()
  dom.window.close()
  process.exit(process.exitCode ?? 0)
}
