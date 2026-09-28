'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Alert, Button, Field } from '@/components/ui'
import { APP_NAME } from '@/lib/config'

export default function RegisterSchool() {
  const [schoolName, setSchoolName] = useState('')
  const [code, setCode] = useState('')
  const [adminName, setAdminName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<any>(null)
  const [copied, setCopied] = useState(false)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/register-school', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school_name: schoolName, school_code: code, admin_name: adminName }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Something went wrong. Please try again.'); setBusy(false); return }
      setResult(j)
    } catch {
      setErr('Network problem. Check your connection and try again.')
    }
    setBusy(false)
  }

  function copy() {
    if (!result) return
    navigator.clipboard?.writeText(`Login ID: ${result.login_id}\nPassword: ${result.password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (result) {
    return (
      <div className="login-wrap">
        <div className="login-card stack">
          <div>
            <div className="logo">E</div>
            <h1 style={{ marginBottom: 2 }}>{result.school_name} is ready</h1>
            <p className="muted" style={{ margin: 0 }}>Here is the first admin login for your school. Save it now — this is shown only once.</p>
          </div>
          <Alert kind="good">
            <div><b>Login ID:</b> {result.login_id}</div>
            <div><b>Password:</b> {result.password}</div>
          </Alert>
          <Button variant="primary" onClick={copy}>{copied ? 'Copied!' : 'Copy login ID and password'}</Button>
          <p className="small muted">Log in with this ID and password — you'll be asked to set a permanent password right away. From there, add your teachers and students under School office → Accounts.</p>
          <Link href="/login"><Button variant="primary">Go to login</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <div className="logo">E</div>
          <h1 style={{ marginBottom: 2 }}>Register your school</h1>
          <p className="muted" style={{ margin: 0 }}>Set up {APP_NAME.replace(' School', '')} for your school. This creates your school's space and its first admin account.</p>
        </div>
        {err && <Alert kind="bad">{err}</Alert>}
        <Field label="School name">
          <input className="input" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="e.g. Delhi Public School" required autoFocus />
        </Field>
        <Field label="School code" hint="2 to 10 letters or digits. This becomes part of every login ID at your school, like DPS-ADM-0001 — choose something short and memorable, and note it won't be easy to change later.">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DPS" maxLength={10} required />
        </Field>
        <Field label="Your name" hint="You'll be the first admin for this school">
          <input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="e.g. Priya Sharma" required />
        </Field>
        <Button variant="primary" type="submit" loading={busy}>Create school</Button>
        <p className="small muted" style={{ margin: 0 }}>Already have a school set up? <Link href="/login">Log in instead</Link>.</p>
      </form>
    </div>
  )
}