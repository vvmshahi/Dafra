import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const expectedSupabaseHost = 'bkbphkpqcxuejozayrsy.supabase.co'
const isElectronRuntime = typeof window !== 'undefined' && window.electronAPI?.isElectron === true

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(isElectronRuntime
    ? 'Desktop application configuration error. Please update or reinstall Kubri.'
    : 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

if (isElectronRuntime && new URL(supabaseUrl).host !== expectedSupabaseHost) {
  throw new Error('Desktop application configuration error. Please update or reinstall Kubri.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'meem-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const supabaseConfigMetadata = {
  host: new URL(supabaseUrl).host,
  expectedHost: expectedSupabaseHost,
  configured: true,
}
