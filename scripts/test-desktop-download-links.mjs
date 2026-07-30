import assert from 'node:assert/strict'
import fs from 'node:fs'

const config = fs.readFileSync('src/config/desktopDownloads.ts', 'utf8')
const landing = fs.readFileSync('src/pages/landing/LandingPage.tsx', 'utf8')
const english = JSON.parse(fs.readFileSync('src/localization/locales/en/public.json', 'utf8'))
const arabic = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/public.json', 'utf8'))

const requiredUrls = [
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-macOS-arm64-unsigned.dmg',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-macOS-arm64-unsigned.zip',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-Windows-x64-unsigned-setup.exe',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/SHA256SUMS.txt',
]

for (const url of requiredUrls) {
  assert.ok(config.includes(url), `missing verified URL: ${url}`)
}

assert.match(config, /kubri-downloads\/releases\/tag\/desktop-pilot-v1\.0\.2-20260730/)
assert.match(config, /intelAvailable: false/)
assert.doesNotMatch(config, /macOS-x64|mac-x64|Intel Mac.*href/i)
assert.doesNotMatch(config, /api\.github\.com|actions\/artifacts|file:\/\/|\/Users\//i)
assert.doesNotMatch(landing, /vvmshahi\/Dafra\/releases|KUBRI_MAC_INTEL_DOWNLOAD_URL|KUBRI_WINDOWS_DOWNLOAD_URL/)
assert.match(landing, /desktopDownloads\.macos\.dmg\.href/)
assert.match(landing, /desktopDownloads\.windows\.installer\.href/)
assert.match(landing, /desktop\.pilotBadge/)
assert.match(landing, /desktop\.unsignedBadge/)
assert.match(landing, /desktop\.intelUnavailable/)
assert.equal(english.desktop.pilotBadge, 'Pilot')
assert.equal(english.desktop.unsignedBadge, 'Unsigned')
assert.ok(arabic.desktop.pilotBadge)
assert.ok(arabic.desktop.unsignedBadge)

console.log('Desktop public download links, warnings, architecture policy, and EN/AR labels passed.')
