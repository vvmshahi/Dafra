import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'

interface BoundaryProps {
  children: ReactNode
  title: string
  body: string
  reload: string
  signOut: string
}

class RuntimeBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[runtime-boundary] render recovery', {
      name: error.name,
      componentStackPresent: Boolean(info.componentStack),
    })
  }

  private signOut = async () => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    window.location.assign('/login')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="min-h-screen bg-gray-50 px-6 flex items-center justify-center">
        <section className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">{this.props.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{this.props.body}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>
              {this.props.reload}
            </button>
            <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700" onClick={this.signOut}>
              {this.props.signOut}
            </button>
          </div>
        </section>
      </main>
    )
  }
}

export function AppRuntimeErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation(['common', 'auth'])
  return (
    <RuntimeBoundary
      title={t('common:errors.runtimeTitle')}
      body={t('common:errors.runtimeBody')}
      reload={t('common:reload')}
      signOut={t('auth:signOut')}
    >
      {children}
    </RuntimeBoundary>
  )
}
