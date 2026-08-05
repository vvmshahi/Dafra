export type DesktopDownload = {
  href: string
  filename: string
  sizeBytes: number
  sizeLabel: string
}

export const desktopDownloads = {
  version: '1.0.5',
  releaseTag: 'v1.0.5',
  pilot: false,
  unsigned: false,
  releaseUrl: 'https://github.com/vvmshahi/Dafra/releases/tag/v1.0.5',
  checksumsUrl: 'https://github.com/vvmshahi/Dafra/releases/download/v1.0.5/SHA256SUMS.txt',
  macos: {
    architecture: 'Apple Silicon — M1, M2, M3, M4 and later',
    dmg: {
      href: 'https://github.com/vvmshahi/Dafra/releases/download/v1.0.5/Kubri-Desktop-1.0.5-macOS-arm64.dmg',
      filename: 'Kubri-Desktop-1.0.5-macOS-arm64.dmg',
      sizeBytes: 159872741,
      sizeLabel: '152.4 MB',
    } satisfies DesktopDownload,
    intel: {
      href: 'https://github.com/vvmshahi/Dafra/releases/download/v1.0.5/Kubri-Desktop-1.0.5-macOS-x64.dmg',
      filename: 'Kubri-Desktop-1.0.5-macOS-x64.dmg',
      sizeBytes: 164937698,
      sizeLabel: '157.3 MB',
    } satisfies DesktopDownload,
    intelAvailable: true,
  },
  windows: {
    architecture: 'Windows 10/11, 64-bit',
    installer: {
      href: 'https://github.com/vvmshahi/Dafra/releases/download/v1.0.5/Kubri-Desktop-1.0.5-Windows-x64-Setup.exe',
      filename: 'Kubri-Desktop-1.0.5-Windows-x64-Setup.exe',
      sizeBytes: 121301344,
      sizeLabel: '115.7 MB',
    } satisfies DesktopDownload,
  },
} as const
