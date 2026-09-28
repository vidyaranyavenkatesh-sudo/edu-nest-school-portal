import { NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { requireAdmin, supabaseAdmin } from '@/lib/supabase-admin'
import { loginIdToEmail, normalizeLoginId, validLoginId } from '@/lib/env'

export const dynamic = 'force-dynamic'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const tempPassword = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin) return bad('Only school admins can do this.', 403)
  let body: any
  try { body = await req.json() } catch { return bad('Bad request') }
  const db = supabaseAdmin()

  const audit = (action: string, rowId: string | null, data: any) =>
    db.from('audit_log').insert({ school_id: admin.schoolId, actor_id: admin.userId, table_name: 'profiles', row_id: rowId, action, new_data: data })

  const target = async (id: string) => {
    const { data } = await db.from('profiles').select('id,login_id,role,school_id,full_name,is_active').eq('id', id).maybeSingle()
    return data && data.school_id === admin.schoolId ? data : null
  }

  // ---------- create one or many accounts ----------
  if (body.action === 'create') {
    const users: any[] = Array.isArray(body.users) ? body.users.slice(0, 400) : []
    if (!users.length) return bad('No people to create.')
    const { data: year } = await db.from('academic_years').select('id').eq('school_id', admin.schoolId).eq('is_current', true).maybeSingle()
    const results: any[] = []
    for (const u of users) {
      const full_name = String(u.full_name || '').trim().slice(0, 100)
      const role = String(u.role || '')
      const out: any = { full_name, role }
      try {
        if (!full_name) throw new Error('Name is missing')
        if (!['student', 'teacher', 'admin'].includes(role)) throw new Error('Role must be student, teacher or admin')
        let classRow: any = null
        if (role === 'student' && u.class_id) {
          const { data: c } = await db.from('classes').select('id,academic_year_id,school_id').eq('id', u.class_id).maybeSingle()
          if (!c || c.school_id !== admin.schoolId) throw new Error('Class not found')
          classRow = c
        }
        const password = tempPassword()
        let loginId = u.login_id ? normalizeLoginId(u.login_id) : ''
        if (loginId && !validLoginId(loginId)) throw new Error('Login ID may use letters, digits, - . _ only')
        let userId: string | null = null
        for (let attempt = 0; attempt < 25 && !userId; attempt++) {
          if (!u.login_id) {
            const r = await db.rpc('next_login_id', { p_school: admin.schoolId, p_kind: role })
            if (r.error) throw r.error
            loginId = r.data as string
          }
          const created = await db.auth.admin.createUser({ email: loginIdToEmail(loginId), password, email_confirm: true })
          if (created.error) {
            const dup = /already|registered|exists/i.test(created.error.message)
            if (dup && !u.login_id) continue
            throw new Error(dup ? `The ID ${loginId} is already taken` : created.error.message)
          }
          userId = created.data.user.id
        }
        if (!userId) throw new Error('Could not create a unique login ID')
        const ins = await db.from('profiles').insert({ id: userId, school_id: admin.schoolId, role, login_id: loginId, full_name, must_change_password: true })
        if (ins.error) {
          await db.auth.admin.deleteUser(userId)
          throw new Error(/duplicate/i.test(ins.error.message) ? `The ID ${loginId} is already taken` : ins.error.message)
        }
        if (classRow) {
          const { data: last } = await db.from('enrolments').select('roll_no').eq('class_id', classRow.id).order('roll_no', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
          const e = await db.from('enrolments').insert({ school_id: admin.schoolId, student_id: userId, class_id: classRow.id, academic_year_id: classRow.academic_year_id, roll_no: (last?.roll_no || 0) + 1 })
          if (e.error) out.warning = 'Account created, but adding to the class failed: ' + e.error.message
        } else if (role === 'student' && !year) out.warning = 'No current academic year yet, so the student was not added to a class.'
        await audit('ACCOUNT_CREATED', userId, { login_id: loginId, role, full_name })
        Object.assign(out, { ok: true, login_id: loginId, password, id: userId })
      } catch (e: any) {
        Object.assign(out, { ok: false, error: e.message || String(e) })
      }
      results.push(out)
    }
    return NextResponse.json({ results })
  }

  // ---------- reset password ----------
  if (body.action === 'reset') {
    const t = await target(String(body.profile_id))
    if (!t) return bad('Person not found.', 404)
    const password = tempPassword()
    const r = await db.auth.admin.updateUserById(t.id, { password })
    if (r.error) return bad(r.error.message, 500)
    await db.from('profiles').update({ must_change_password: true }).eq('id', t.id)
    await db.from('login_attempts').delete().eq('login_id', t.login_id)
    await audit('PASSWORD_RESET', t.id, { login_id: t.login_id })
    return NextResponse.json({ login_id: t.login_id, full_name: t.full_name, password })
  }

  // ---------- disable / enable ----------
  if (body.action === 'set_active') {
    const t = await target(String(body.profile_id))
    if (!t) return bad('Person not found.', 404)
    if (t.id === admin.userId) return bad('You cannot disable your own account.')
    const active = !!body.active
    const r = await db.auth.admin.updateUserById(t.id, { ban_duration: active ? 'none' : '876000h' })
    if (r.error) return bad(r.error.message, 500)
    await db.from('profiles').update({ is_active: active, disabled_from: null }).eq('id', t.id)
    await audit(active ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED', t.id, { login_id: t.login_id })
    return NextResponse.json({ ok: true })
  }

  // ---------- rename ----------
  if (body.action === 'rename') {
    const t = await target(String(body.profile_id))
    const name = String(body.full_name || '').trim().slice(0, 100)
    if (!t || !name) return bad('Person not found or name is empty.')
    await db.from('profiles').update({ full_name: name }).eq('id', t.id)
    await audit('ACCOUNT_RENAMED', t.id, { from: t.full_name, to: name })
    return NextResponse.json({ ok: true })
  }

  return bad('Unknown action')
}
