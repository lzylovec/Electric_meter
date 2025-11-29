import { createClient } from '@supabase/supabase-js'

const rawUrl = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined
const rawKey = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : undefined
const clean = v => {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return t.replace(/^['"`]/, '').replace(/['"`]$/, '')
}
const url = clean(rawUrl)
const key = clean(rawKey)

let client = null
try {
  if (url && key) client = createClient(url, key)
} catch {}

export const supabase = client
