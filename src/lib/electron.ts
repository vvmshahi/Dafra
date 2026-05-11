export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron

export const printSilent = async (): Promise<void> => {
  if (isElectron()) {
    const result = await (window as any).electronAPI.printSilent()
    if (!result?.success) window.print()
  } else {
    window.print()
  }
}

export const getPrinters = async (): Promise<any[]> => {
  if (!isElectron()) return []
  return (window as any).electronAPI.getPrinters()
}

export const getDefaultPrinter = async (): Promise<string | null> => {
  if (!isElectron()) return null
  return (window as any).electronAPI.getDefaultPrinter()
}

export const savePrinter = async (name: string): Promise<void> => {
  if (!isElectron()) return
  await (window as any).electronAPI.savePrinter(name)
}

export const clearPrinter = async (): Promise<void> => {
  if (!isElectron()) return
  await (window as any).electronAPI.clearPrinter()
}
