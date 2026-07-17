import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string

function buildCommit(): string {
  const hostedCommit = process.env.VERCEL_GIT_COMMIT_SHA
  if (hostedCommit) return hostedCommit.slice(0, 8)
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
})
