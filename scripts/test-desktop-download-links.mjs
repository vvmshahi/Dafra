import assert from 'node:assert/strict'
import fs from 'node:fs'

const config = fs.readFileSync('src/config/desktopDownloads.ts', 'utf8')
const landing = fs.readFileSync('src/pages/landing/LandingPage.tsx', 'utf8')
const english = JSON.parse(fs.readFileSync('src/localization/locales/en/public.json', 'utf8'))
const arabic = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/public.json', 'utf8'))

const requiredUrls = [
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.dmg',
  'https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-Windows-x64-unsigned-setup.exe',
]

for (const url of requiredUrls) {
  assert.ok(config.includes(url), `missing verified URL: ${url}`)
}

assert.match(config, /version: '1\.0\.3'/)
assert.match(config, /kubri-downloads\/releases\/tag\/desktop-pilot-v1\.0\.3-20260730/)
assert.match(config, /Kubri-Desktop-1\.0\.3-macOS-arm64-unsigned\.zip/)
assert.doesNotMatch(config, /api\.github\.com|actions\/artifacts|file:\/\/|\/Users\//i)
assert.equal((landing.match(/href=\{desktopDownloads\./g) ?? []).length, 2)
assert.match(landing, /desktopDownloads\.macos\.dmg\.href/)
assert.match(landing, /desktopDownloads\.windows\.installer\.href/)
assert.doesNotMatch(landing, /desktopDownloads\.macos\.zip|desktopDownloads\.releaseUrl|desktopDownloads\.checksumsUrl/)
assert.doesNotMatch(landing, /pilot|unsigned|releaseNotes|checksums|intel|gatekeeper|smartscreen|desktop\.version|desktop\.benefits/i)
assert.match(landing, /desktop\.downloadMac/)
assert.match(landing, /desktop\.downloadWindows/)
assert.match(landing, /desktop\.macPlatform/)
assert.match(landing, /desktop\.windowsPlatform/)
assert.match(landing, /desktop\.macDownloadLabel/)
assert.match(landing, /desktop\.windowsDownloadLabel/)
assert.match(landing, /focus-visible:ring-2/)
assert.match(landing, /flex-col gap-4 md:flex-row/)
assert.equal(english.desktop.title, 'Kubri Desktop')
assert.equal(english.desktop.subtitle, 'Run Kubri directly on your Mac or Windows computer.')
assert.equal(english.desktop.downloadMac, 'Download for Mac')
assert.equal(english.desktop.macPlatform, 'Apple Silicon')
assert.equal(english.desktop.downloadWindows, 'Download for Windows')
assert.equal(english.desktop.windowsPlatform, 'Windows 10/11')
assert.match(english.desktop.macDownloadLabel, /Mac Apple Silicon/)
assert.match(english.desktop.windowsDownloadLabel, /Windows 10 and 11/)
assert.ok(arabic.desktop.title)
assert.ok(arabic.desktop.subtitle)
assert.ok(arabic.desktop.downloadMac)
assert.ok(arabic.desktop.downloadWindows)
assert.ok(arabic.desktop.macDownloadLabel)
assert.ok(arabic.desktop.windowsDownloadLabel)

console.log('Desktop public download links, warnings, architecture policy, and EN/AR labels passed.')
