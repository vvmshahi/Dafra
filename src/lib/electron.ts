interface ElectronApi {
  isElectron: true
  printSilent: () => Promise<{ success: boolean; errorType?: string | null }>
  getPrinters: () => Promise<any[]>
  getDefaultPrinter: () => Promise<string | null>
  savePrinter: (name: string) => Promise<{ success?: boolean } | void>
  clearPrinter: () => Promise<{ success?: boolean } | void>
}

declare global {
  interface Window {
    electronAPI?: ElectronApi
  }
}

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && window.electronAPI?.isElectron === true

export const isDesktopApp = (): boolean => isElectron()

export const printSilent = async (): Promise<void> => {
  if (isElectron()) {
    const result = await window.electronAPI?.printSilent()
    if (!result?.success) window.print()
  } else {
    window.print()
  }
}

export const getPrinters = async (): Promise<any[]> => {
  if (!isElectron()) return []
  return window.electronAPI?.getPrinters() ?? []
}

export const getDefaultPrinter = async (): Promise<string | null> => {
  if (!isElectron()) return null
  return window.electronAPI?.getDefaultPrinter() ?? null
}

export const savePrinter = async (name: string): Promise<void> => {
  if (!isElectron()) return
  await window.electronAPI?.savePrinter(name)
}

export const clearPrinter = async (): Promise<void> => {
  if (!isElectron()) return
  await window.electronAPI?.clearPrinter()
}
