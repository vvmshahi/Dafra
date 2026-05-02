import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    // Polyfills Node.js built-ins (events, url, buffer, process, etc.) for browser bundles.
    // Replaces the manual `events: 'events'` alias that was causing
    // "Object.defineProperty called on non-object" at runtime.
    nodePolyfills({
      // Only polyfill what's actually needed by our deps:
      //   events    — xmlbuilder2/XMLBuilderCBImpl extends EventEmitter
      //   url       — @oozcitak/url (xmlbuilder2 dependency)
      //   buffer    — node-forge
      //   process   — node-forge prng / util
      include: ['events', 'url', 'buffer', 'process'],
      globals: {
        Buffer:  true,
        process: true,
      },
    }),
  ],
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
