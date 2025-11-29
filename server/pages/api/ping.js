import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return }
  try {
    if (!supabase) { res.status(200).json({ ok: false, message: 'supabase client not configured' }); return }
    const { data, error } = await supabase.from('rule_templates').select('id').limit(1)
    if (error) { res.status(200).json({ ok: false, error: error.message }); return }
    res.status(200).json({ ok: true, count: Array.isArray(data) ? data.length : 0 })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) })
  }
}
