'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Field } from './ui'

export default function LoginForm({ appName, tagline }: { appName: string; tagline: string }) {
  const router = useRouter()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get('e')
    if (e === 'session') setInfo('Your session has ended. Please log in again.')
    if (e === 'access') setErr('That account cannot use this website.')
  }, [])

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setBusy(true); setErr(''); setInfo('')
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loginId, password }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'Could not log in. Please try again.'); setBusy(false); return }
      router.replace(j.mustChange ? '/change-password' : '/')
      router.refresh()
    } catch {
      setErr('Network problem. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <div className="logo">E</div>
          <h1 style={{ marginBottom: 2 }}>{appName}</h1>
          <p className="muted" style={{ margin: 0 }}>{tagline}</p>
        </div>
        {info && <Alert>{info}</Alert>}
        {err && <Alert kind="bad">{err}</Alert>}
        <Field label="Login ID" hint="Given to you by the school, like DPS-STU-0001">
          <input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="username" autoFocus required />
        </Field>
        <Field label="Password">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </Field>
        <Button variant="primary" type="submit" loading={busy}>Log in</Button>
        <p className="small muted" style={{ margin: 0 }}>Forgot your password? Ask the school office to reset it. There is no sign-up for teachers or students: only accounts created by the school can log in.</p>
        <p className="small muted" style={{ margin: 0, borderTop: '1px solid var(--line)', paddingTop: 12 }}>New school? <Link href="/register-school">Register your school here</Link>.</p>
      </form>
    </div>
  )
}