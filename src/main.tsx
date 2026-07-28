import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider } from '@/hooks/useAuth'
import { AppRuntimeErrorBoundary } from '@/components/errors/AppRuntimeErrorBoundary'
import '@/localization/i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppRuntimeErrorBoundary>
        <App />
      </AppRuntimeErrorBoundary>
    </AuthProvider>
  </StrictMode>,
)
