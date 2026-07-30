export type DesktopDownload = {
  href: string
  filename: string
  sizeBytes: number
  sizeLabel: string
}

export const desktopDownloads = {
  version: '1.0.3',
  releaseTag: 'desktop-pilot-v1.0.3-20260730',
  pilot: true,
  unsigned: true,
  releaseUrl: 'https://github.com/vvmshahi/kubri-downloads/releases/tag/desktop-pilot-v1.0.3-20260730',
  checksumsUrl: 'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/SHA256SUMS.txt',
  macos: {
    architecture: 'Apple Silicon — M1, M2, M3, M4 and later',
    dmg: {
      href: 'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.dmg',
      filename: 'Kubri-Desktop-1.0.3-macOS-arm64-unsigned.dmg',
      sizeBytes: 159818962,
      sizeLabel: '152.5 MB',
    } satisfies DesktopDownload,
    zip: {
      href: 'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.zip',
      filename: 'Kubri-Desktop-1.0.3-macOS-arm64-unsigned.zip',
      sizeBytes: 152450232,
      sizeLabel: '145.3 MB',
    } satisfies DesktopDownload,
    intelAvailable: false,
  },
  windows: {
    architecture: 'Windows 10/11, 64-bit',
    installer: {
      href: 'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-Windows-x64-unsigned-setup.exe',
      filename: 'Kubri-Desktop-1.0.3-Windows-x64-unsigned-setup.exe',
      sizeBytes: 121357998,
      sizeLabel: '115.7 MB',
    } satisfies DesktopDownload,
  },
} as const
