import assert from 'node:assert/strict'
import fs from 'node:fs'

const config = fs.readFileSync('src/config/desktopDownloads.ts', 'utf8')
const landing = fs.readFileSync('src/pages/landing/LandingPage.tsx', 'utf8')
const english = JSON.parse(fs.readFileSync('src/localization/locales/en/public.json', 'utf8'))
const arabic = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/public.json', 'utf8'))

const requiredUrls = [
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.dmg',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.zip',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-Windows-x64-unsigned-setup.exe',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/SHA256SUMS.txt',
]

for (const url of requiredUrls) {
  assert.ok(config.includes(url), `missing verified URL: ${url}`)
}

assert.match(config, /version: '1\.0\.3'/)
assert.match(config, /kubri-downloads\/releases\/tag\/desktop-pilot-v1\.0\.3-20260730/)
assert.match(config, /intelAvailable: false/)
assert.doesNotMatch(config, /1\.0\.2|desktop-pilot-v1\.0\.2-20260730/)
assert.doesNotMatch(config, /macOS-x64|mac-x64|Intel Mac.*href/i)
assert.doesNotMatch(config, /api\.github\.com|actions\/artifacts|file:\/\/|\/Users\//i)
assert.doesNotMatch(landing, /vvmshahi\/Dafra\/releases|KUBRI_MAC_INTEL_DOWNLOAD_URL|KUBRI_WINDOWS_DOWNLOAD_URL/)
assert.match(landing, /desktopDownloads\.macos\.dmg\.href/)
assert.match(landing, /desktopDownloads\.windows\.installer\.href/)
assert.match(landing, /desktop\.pilotBadge/)
assert.match(landing, /desktop\.unsignedBadge/)
assert.match(landing, /desktop\.downloadDmg/)
assert.match(landing, /desktop\.downloadZip/)
assert.match(landing, /desktop\.downloadInstaller/)
assert.match(landing, /desktop\.macTitle/)
assert.match(landing, /desktop\.windowsTitle/)
assert.match(landing, /desktop\.intelUnavailable/)
assert.equal(english.desktop.pilotBadge, 'Pilot')
assert.equal(english.desktop.unsignedBadge, 'Unsigned')
assert.equal(english.desktop.version, 'Version 1.0.3')
assert.equal(english.desktop.downloadDmg, 'Download DMG')
assert.equal(english.desktop.downloadZip, 'Download ZIP')
assert.equal(english.desktop.downloadInstaller, 'Download installer')
assert.ok(english.desktop.macDescription)
assert.ok(english.desktop.windowsDescription)
assert.ok(arabic.desktop.pilotBadge)
assert.ok(arabic.desktop.unsignedBadge)
assert.ok(arabic.desktop.downloadDmg)
assert.ok(arabic.desktop.downloadZip)
assert.ok(arabic.desktop.downloadInstaller)
assert.ok(arabic.desktop.macDescription)
assert.ok(arabic.desktop.windowsDescription)

console.log('Desktop public download links, warnings, architecture policy, and EN/AR labels passed.')
