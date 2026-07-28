import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.kubri.pos.dev',
  appName: 'Kubri',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorBarcodeScanner: {
      scanInstructions: 'Align one product barcode inside the frame',
    },
  },
}

export default config
