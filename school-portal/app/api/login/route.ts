import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { loginIdToEmail, normalizeLoginId, validLoginId } from '@/lib/env'
import { ALLOWED_ROLES, OTHER_PORTAL_MESSAGE } from '@/lib/config'

export const dynamic = 'force-dynamic'
const WRONG = 'Wrong ID or password.'

export async function POST(req: Request) {
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const id = normalizeLoginId(body.loginId)
  const password = String(body.password || '')
  if (!validLoginId(id) || !password || password.length > 200) return NextResponse.json({ error: WRONG }, { status: 401 })

  const supabase = supabaseServer()

  // 1. Locked out after too many wrong passwords?
  const gate = await supabase.rpc('login_gate', { p_login_id: id })
  if (gate.data?.locked) {
    const mins = Math.max(1, Math.ceil((gate.data.retry_seconds || 900) / 60))
    return NextResponse.json({ error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or ask the school office to reset your password.` }, { status: 429 })
  }

  // 2. ID + password
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginIdToEmail(id), password })
  if (error || !data.user) {
    await supabase.rpc('login_record_failure', { p_login_id: id })
    return NextResponse.json({ error: WRONG }, { status: 401 })
  }

  // 3. Must be an active school-created account of the right kind for this website
  const { data: profile } = await supabase.from('profiles').select('role,is_active,disabled_from,must_change_password').eq('id', data.user.id).maybeSingle()
  const today = new Date().toISOString().slice(0, 10)
  const active = profile && profile.is_active && (!profile.disabled_from || profile.disabled_from > today)
  if (!active) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: WRONG }, { status: 401 })
  }
  if (!ALLOWED_ROLES.includes(profile.role)) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: OTHER_PORTAL_MESSAGE }, { status: 403 })
  }
  await supabase.rpc('login_clear_failures')
  return NextResponse.json({ ok: true, mustChange: !!profile.must_change_password })
}
