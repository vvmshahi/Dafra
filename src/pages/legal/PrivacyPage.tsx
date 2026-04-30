import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowLeft size={16} />
          Back
        </Link>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#1B6B3A] flex items-center justify-center">
            <span className="text-white font-black text-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
          </div>
          <span className="font-bold text-gray-900" style={{ fontFamily: 'Cairo, sans-serif' }}>Dafra</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-[#1B6B3A]/10 flex items-center justify-center mx-auto">
            <span className="text-3xl">🔒</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Privacy Policy</h1>
          <p className="text-gray-500">
            Your privacy matters to us. We collect only the data necessary to operate the
            Dafra platform, store it securely on Saudi-hosted infrastructure, and never
            sell it to third parties.
          </p>
          <p className="text-gray-500">
            Our full Privacy Policy is being prepared and will be published soon.
          </p>
          <p className="text-sm text-gray-400">
            For questions, contact us at{' '}
            <a href="mailto:support@dafra.sa" className="text-[#1B6B3A] hover:underline">
              support@dafra.sa
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}
