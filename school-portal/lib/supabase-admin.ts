import { createClient } from '@supabase/supabase-js'
import { supabaseServer } from './supabase-server'

/** Full-access client. SERVER ONLY. Only used after checking that the caller is a school admin. */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on the server')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** Returns the signed-in school admin (checked through their own login), or null. */
export async function requireAdmin() {
  const sb = supabaseServer()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data: p } = await sb.from('profiles').select('id,school_id,role,is_active').eq('id', user.id).maybeSingle()
  if (!p || p.role !== 'admin' || !p.is_active) return null
  return { userId: user.id, schoolId: p.school_id as string }
}
