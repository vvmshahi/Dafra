import { Link } from 'react-router-dom'
import { MessageCircle, Mail, Lock } from 'lucide-react'

const WA_LINK    = 'https://wa.me/919895953210'
const EMAIL_LINK = 'mailto:vvmshahin@gmail.com'

function GeometricPattern() {
  return (
    <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="geo-signup" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
          <path d="M24 4 L56 4 L76 24 L76 56 L56 76 L24 76 L4 56 L4 24 Z"
            fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <rect x="22" y="22" width="36" height="36" transform="rotate(45 40 40)"
            fill="none" stroke="rgba(200,169,110,0.07)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#geo-signup)" />
    </svg>
  )
}

export default function SignupPage() {
  return (
    <div className="min-h-screen flex">

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[48%] relative bg-[#0F2419] flex-col justify-between p-12 overflow-hidden">
        <GeometricPattern />
        <div className="absolute inset-0 bg-gradient-to-br from-[#1B6B3A]/50 via-transparent to-[#0F2419]/80 pointer-events-none" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-500 flex items-center justify-center shadow-lg">
            <span className="text-[#0F2419] font-black text-xl" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
          </div>
          <div>
            <p className="text-white font-bold text-2xl leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</p>
            <p className="text-gold-400 text-xs tracking-widest uppercase">Dafra</p>
          </div>
        </div>

        <div className="relative z-10 space-y-4">
          <h2 className="text-4xl font-black text-white leading-tight" style={{ fontFamily: 'Cairo, sans-serif' }}>
            نظام فوترة ذكي
            <br />
            <span className="text-gold-400">للمطاعم والكافيهات</span>
          </h2>
          <p className="text-lg font-light text-white/70">ZATCA-compliant invoicing for Saudi SMEs.</p>
        </div>

        <div className="relative z-10">
          <p className="text-white/30 text-xs">هيئة الزكاة والضريبة والجمارك · ZATCA Certified</p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-[420px] space-y-6">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center">
              <span className="text-[#0F2419] font-black text-lg" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
            </div>
            <span className="font-bold text-xl text-gray-900" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</span>
          </div>

          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 mx-auto">
            <Lock size={28} className="text-gray-400" />
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Account creation is by invitation only</h1>
            <p className="text-gray-500 text-sm mt-3 leading-relaxed">
              Contact us to get started with Dafra. We'll set up your account and have you running within 24 hours.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-6 py-3.5 rounded-xl transition-colors shadow-md"
            >
              <MessageCircle size={18} />
              WhatsApp Us
            </a>
            <a
              href={EMAIL_LINK}
              className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-6 py-3.5 rounded-xl transition-colors"
            >
              <Mail size={18} />
              Email Us
            </a>
          </div>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
