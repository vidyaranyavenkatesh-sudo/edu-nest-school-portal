'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Field } from './ui'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { errMsg } from '@/lib/util'
import { toast } from '@/lib/toast'

export default function ChangePasswordForm({ forced, loginId }: { forced?: boolean; loginId?: string }) {
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return setErr('Use both letters and numbers.')
    if (loginId && pw.toUpperCase().includes(loginId.toUpperCase())) return setErr('Your password should not contain your login ID.')
    if (pw !== pw2) return setErr('The two passwords do not match.')
    setBusy(true)
    try {
      const sb = supabaseBrowser()
      const { error } = await sb.auth.updateUser({ password: pw })
      if (error) throw error
      const r = await sb.rpc('mark_password_changed')
      if (r.error) throw r.error
      toast('Password changed', 'good')
      setPw(''); setPw2('')
      if (forced) { router.replace('/'); router.refresh() }
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 420 }}>
      {forced && <Alert kind="warn">For your safety, please choose your own password before you continue.</Alert>}
      {err && <Alert kind="bad">{err}</Alert>}
      <Field label="New password" hint="At least 8 characters, with letters and numbers">
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Field label="Type it again">
        <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
      </Field>
      <div><Button variant="primary" type="submit" loading={busy}>Save password</Button></div>
    </form>
  )
}
