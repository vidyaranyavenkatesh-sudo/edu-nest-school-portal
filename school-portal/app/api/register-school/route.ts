import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loginIdToEmail, normalizeLoginId } from '@/lib/env'

// Public route: this is the ONE place a brand-new school gets created without
// an existing admin session, because there is no admin yet. It only ever
// creates a school row plus a single admin profile — nothing else, and it
// never touches an existing school. Every other write in this app requires
// an authenticated admin; this route is the deliberate, narrow exception.
export const dynamic = 'force-dynamic'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const tempPassword = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

const CODE_RE = /^[A-Z0-9]{2,10}$/
const TIMEZONES = ['Asia/Kolkata', 'Asia/Calcutta']

export async function POST(req: Request) {
  let body: any
  try { body = await req.json() } catch { return bad('Bad request') }

  const schoolName = String(body.school_name || '').trim().slice(0, 150)
  const code = String(body.school_code || '').trim().toUpperCase()
  const adminName = String(body.admin_name || '').trim().slice(0, 100)
  const timezone = TIMEZONES.includes(body.timezone) ? body.timezone : 'Asia/Kolkata'

  if (!schoolName) return bad('School name is required.')
  if (!CODE_RE.test(code)) return bad('School code must be 2 to 10 letters or digits, like DPS or GHS12.')
  if (!adminName) return bad('The admin\'s name is required.')

  const db = supabaseAdmin()

  // 1. Create the school.
  const school = await db.from('schools').insert({ name: schoolName, code, timezone }).select('id,code').single()
  if (school.error) {
    if (/duplicate|already exists/i.test(school.error.message)) {
      return bad(`The code "${code}" is already taken by another school. Please choose a different one.`)
    }
    return bad(school.error.message, 500)
  }
  const schoolId = school.data.id as string

  // 2. Work out the first admin's login ID and create their Auth account.
  const cleanup = async () => { await db.from('schools').delete().eq('id', schoolId) }
  try {
    const idRes = await db.rpc('next_login_id', { p_school: schoolId, p_kind: 'admin' })
    if (idRes.error) throw new Error(idRes.error.message)
    const loginId = idRes.data as string
    const password = tempPassword()

    const created = await db.auth.admin.createUser({ email: loginIdToEmail(loginId), password, email_confirm: true })
    if (created.error) throw new Error(created.error.message)
    const userId = created.data.user.id

    // 3. Create their admin profile.
    const profile = await db.from('profiles').insert({
      id: userId, school_id: schoolId, role: 'admin', login_id: loginId, full_name: adminName, must_change_password: true,
    })
    if (profile.error) {
      await db.auth.admin.deleteUser(userId)
      throw new Error(profile.error.message)
    }

    return NextResponse.json({ school_name: schoolName, school_code: code, login_id: loginId, password })
  } catch (e: any) {
    await cleanup()
    return bad(e.message || 'Could not set up the school. Please try again.', 500)
  }
}