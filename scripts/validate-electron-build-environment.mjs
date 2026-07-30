const expectedUrl = 'https://bkbphkpqcxuejozayrsy.supabase.co'
const supabaseUrl = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl) {
  throw new Error('Electron production build requires VITE_SUPABASE_URL.')
}
if (supabaseUrl !== expectedUrl) {
  throw new Error('Electron production build requires the approved Supabase project URL.')
}
if (!anonKey || !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(anonKey)) {
  throw new Error('Electron production build requires a valid public Supabase anon key.')
}

console.log(`Electron build environment verified: host=${new URL(supabaseUrl).host} publicKeyPresent=true`)
