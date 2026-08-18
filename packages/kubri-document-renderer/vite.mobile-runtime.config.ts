import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  build: {
    lib: { entry: path.resolve(__dirname, 'src/browserRuntime.tsx'), name: 'KubriCanonicalDocumentRenderer', formats: ['iife'], fileName: () => 'kubri-canonical-document-renderer.js' },
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
