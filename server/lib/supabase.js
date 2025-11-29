import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let client = null
if (typeof url === 'string' && url && typeof key === 'string' && key) {
  client = createClient(url, key)
}

export const supabase = client
