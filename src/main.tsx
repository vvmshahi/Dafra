import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider } from '@/hooks/useAuth'
import { AppRuntimeErrorBoundary } from '@/components/errors/AppRuntimeErrorBoundary'
import '@/localization/i18n'
import { configureArtworkUrlResolver } from '../packages/kubri-document-renderer/src/artwork'
import { resolveInvoiceArtworkUrl } from '@/lib/invoices/runtimePresentation'

configureArtworkUrlResolver(resolveInvoiceArtworkUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppRuntimeErrorBoundary>
        <App />
      </AppRuntimeErrorBoundary>
    </AuthProvider>
  </StrictMode>,
)
