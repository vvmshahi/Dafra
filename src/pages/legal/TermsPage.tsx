import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function TermsPage() {
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
            <span className="text-3xl">📄</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Terms of Service</h1>
          <p className="text-gray-500">
            Our full Terms of Service are being prepared and will be published soon.
            By using Dafra, you agree to use the platform responsibly and in accordance
            with applicable Saudi laws and regulations.
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
