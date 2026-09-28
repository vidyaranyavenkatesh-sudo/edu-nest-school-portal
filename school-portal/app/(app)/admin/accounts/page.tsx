'use client'
import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHead, Tabs } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync, useDebounced } from '@/lib/hooks'
import { fetchClasses, useCurrentYear } from '@/lib/data'
import { classLabel, downloadCsv, parseCsv, q } from '@/lib/util'
import { toast } from '@/lib/toast'

async function api(body: any) {
  const r = await fetch('/api/admin/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Something went wrong')
  return j
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const ROLE_LABEL: Record<string, string> = { student: 'Student', teacher: 'Teacher', admin: 'Office staff' }

function Credentials({ rows, title, onClose }: { rows: any[]; title: string; onClose: () => void }) {
  const ok = rows.filter((r) => r.ok !== false)
  return (
    <Modal wide title={title} onClose={onClose} footer={<>
      <Button onClick={() => downloadCsv('edunest-logins.csv', [['Name', 'Role', 'Login ID', 'Temporary password'], ...ok.map((r) => [r.full_name, r.role, r.login_id, r.password])])}>Download CSV</Button>
      <Button onClick={() => window.print()}>Print</Button>
      <Button variant="primary" onClick={onClose}>Done</Button>
    </>}>
      <Alert kind="warn"><b>Save these now.</b> Passwords are shown only once. Each person must choose their own password the first time they log in.</Alert>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Name</th><th>Login ID</th><th>Temporary password</th></tr></thead>
        <tbody>
          {rows.map((r, i) => r.ok === false
            ? <tr key={i}><td>{r.full_name}</td><td colSpan={2} style={{ color: 'var(--bad)' }}>Not created: {r.error}</td></tr>
            : <tr key={i}><td>{r.full_name}{r.warning && <div className="small" style={{ color: 'var(--warn)' }}>{r.warning}</div>}</td><td><b>{r.login_id}</b></td><td><code>{r.password}</code></td></tr>)}
        </tbody>
      </table></div>
    </Modal>
  )
}

function CreateModal({ role, classes, onClose, onDone }: { role: string; classes: any[]; onClose: () => void; onDone: (rows: any[]) => void }) {
  const [mode, setMode] = useState('one')
  const [name, setName] = useState('')
  const [r, setR] = useState(role)
  const [classId, setClassId] = useState('')
  const [loginId, setLoginId] = useState('')
  const [text, setText] = useState('')
  const { busy, run } = useAction()

  const byLabel = new Map(classes.map((c) => [norm(classLabel(c)), c.id]))
  const parsed = text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const cells = parseCsv(line)[0] || [line]
    const [n, cl] = [cells[0]?.trim(), cells[1]?.trim()]
    const cid = cl ? byLabel.get(norm(cl)) : ''
    return { full_name: n, class_label: cl, class_id: cid || '', bad_class: !!cl && !cid }
  })
  const submit = () => run(async () => {
    const users = mode === 'one'
      ? [{ full_name: name, role: r, class_id: r === 'student' ? classId || undefined : undefined, login_id: loginId || undefined }]
      : parsed.map((p) => ({ full_name: p.full_name, role, class_id: p.class_id || undefined }))
    const res = await api({ action: 'create', users })
    onDone(res.results)
  })
  const readFile = async (f?: File) => { if (f) setText((await f.text()).replace(/^﻿/, '')) }

  return (
    <Modal wide title={`Add ${ROLE_LABEL[role].toLowerCase()}s`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={mode === 'one' ? !name.trim() : parsed.length === 0 || parsed.some((p) => p.bad_class)} onClick={submit}>Create {mode === 'one' ? 'account' : `${parsed.length} accounts`}</Button></>}>
      <Tabs tabs={[['one', 'One person'], ['many', 'Many at once']]} value={mode} onChange={setMode} />
      {mode === 'one' ? (
        <div className="stack">
          <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <div className="grid c2">
            <Field label="Type of account"><select className="input" value={r} onChange={(e) => setR(e.target.value)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Office staff (admin)</option></select></Field>
            {r === 'student' && <Field label="Class"><select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">— not yet —</option>{classes.map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>}
          </div>
          <Field label="Login ID (optional)" hint="Leave empty and the system makes one, like DPS-STU-0042"><input className="input" value={loginId} onChange={(e) => setLoginId(e.target.value.toUpperCase())} /></Field>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>One person per line: <code>Full name, class</code> (for example <code>Asha Rao, 8 A</code>). The class is only for students and can be left out. Type or paste below, or load a CSV file. All become <b>{ROLE_LABEL[role].toLowerCase()}s</b>.</p>
          <input type="file" accept=".csv,.txt" onChange={(e) => readFile(e.target.files?.[0])} />
          <textarea className="input" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Asha Rao, 8 A\nBala Kumar, 8 A\nChitra Devi, 9 B'} />
          {parsed.length > 0 && <p className="small muted">{parsed.length} people ready. {parsed.filter((p) => p.bad_class).length > 0 && <span style={{ color: 'var(--bad)' }}>Some classes were not found: {Array.from(new Set(parsed.filter((p) => p.bad_class).map((p) => p.class_label))).join(', ')}.</span>}</p>}
        </div>
      )}
    </Modal>
  )
}

export default function Accounts() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const year = useCurrentYear()
  const classes = useAsync<any[]>(async () => (year.data ? fetchClasses(year.data.id) : []), [year.data?.id])
  const [role, setRole] = useState('student')
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 300)
  const [classId, setClassId] = useState('')
  const [showOff, setShowOff] = useState(false)
  const [limit, setLimit] = useState(50)
  const [creating, setCreating] = useState(false)
  const [creds, setCreds] = useState<{ title: string; rows: any[] } | null>(null)
  const [move, setMove] = useState<any>(null)
  const [moveTo, setMoveTo] = useState('')
  const { busy, run } = useAction()
  useEffect(() => { setClassId(''); setLimit(50) }, [role])

  const list = useAsync<any[]>(() => {
    const base = 'id,full_name,login_id,role,is_active,must_change_password,messaging_disabled'
    const cols = role === 'student' ? `${base},enrolments${classId ? '!inner' : ''}(id,roll_no,status,class:classes(id,section,grade:grade_levels(name)))` : base
    let query = sb.from('profiles').select(cols).eq('role', role).order('full_name').limit(limit)
    if (classId && role === 'student') query = query.eq('enrolments.class_id', classId).eq('enrolments.status', 'active')
    if (!showOff) query = query.eq('is_active', true)
    if (term) { const t = term.replace(/[%,()]/g, ' '); query = query.or(`full_name.ilike.%${t}%,login_id.ilike.%${t.toUpperCase()}%`) }
    return q(query)
  }, [role, classId, showOff, term, limit])

  const reset = (p: any) => window.confirm(`Make a new temporary password for ${p.full_name}?`) && run(async () => {
    const r = await api({ action: 'reset', profile_id: p.id })
    setCreds({ title: 'New temporary password', rows: [{ full_name: r.full_name, role: p.role, login_id: r.login_id, password: r.password }] })
  })
  const setActive = (p: any, active: boolean) => (active || window.confirm(`Disable ${p.full_name}? They will not be able to log in. Their records stay.`)) && run(async () => { await api({ action: 'set_active', profile_id: p.id, active }); list.reload() }, active ? 'Account enabled' : 'Account disabled')
  const rename = (p: any) => { const n = window.prompt('Full name', p.full_name); if (n && n.trim() && n !== p.full_name) run(async () => { await api({ action: 'rename', profile_id: p.id, full_name: n }); list.reload() }, 'Renamed') }
  const doMove = () => run(async () => { await q(sb.rpc('enrol_student', { p_student: move.id, p_class: moveTo })); setMove(null); list.reload() }, 'Class updated')
  const toggleChat = (p: any) => run(async () => { await q(sb.rpc('set_messaging_disabled', { p_profile: p.id, p_disabled: !p.messaging_disabled })); list.reload() }, p.messaging_disabled ? 'Messaging is on' : 'Messaging is off')

  return (
    <>
      <PageHead title="Accounts" sub="Only accounts created here can log in. There is no public sign-up.">
        <Button variant="primary" onClick={() => setCreating(true)}>+ Add {ROLE_LABEL[role].toLowerCase()}s</Button>
      </PageHead>
      <Tabs tabs={[['student', 'Students'], ['teacher', 'Teachers'], ['admin', 'Office staff']]} value={role} onChange={setRole} />
      <Card>
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search name or login ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          {role === 'student' && <select className="input" style={{ maxWidth: 200 }} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select>}
          <label className="check"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Show disabled accounts</label>
        </div>
      </Card>
      <Loading loading={list.loading} error={list.error} hasData={!!list.data}>
        <Card flush>
          {list.data?.length === 0 && <Empty>No one found.</Empty>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Login ID</th>{role === 'student' && <th>Class</th>}<th>Status</th><th></th></tr></thead>
            <tbody>
              {(list.data || []).map((p) => {
                const enr = (p.enrolments || []).find((e: any) => e.status === 'active')
                return (
                  <tr key={p.id}>
                    <td><b>{p.full_name}</b></td>
                    <td><code>{p.login_id}</code></td>
                    {role === 'student' && <td>{enr ? <>{classLabel(enr.class)} <span className="small muted">roll {enr.roll_no}</span></> : <span className="muted">—</span>}</td>}
                    <td><div className="row" style={{ gap: 4 }}>{!p.is_active && <Badge kind="bad">Disabled</Badge>}{p.must_change_password && <Badge kind="warn">Has not logged in</Badge>}{p.messaging_disabled && <Badge kind="bad">Chat off</Badge>}</div></td>
                    <td className="num"><div className="row end">
                      <Button small onClick={() => rename(p)}>Rename</Button>
                      {role === 'student' && <Button small onClick={() => { setMove(p); setMoveTo(enr?.class?.id || '') }}>Class</Button>}
                      {role === 'student' && <Button small onClick={() => toggleChat(p)}>{p.messaging_disabled ? 'Chat on' : 'Chat off'}</Button>}
                      <Button small onClick={() => reset(p)}>Reset password</Button>
                      {p.id !== me.id && (p.is_active ? <Button small variant="danger" onClick={() => setActive(p, false)}>Disable</Button> : <Button small variant="primary" onClick={() => setActive(p, true)}>Enable</Button>)}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        </Card>
        {list.data && list.data.length >= limit && <div className="row" style={{ justifyContent: 'center' }}><Button onClick={() => setLimit(limit + 50)}>Show more</Button></div>}
      </Loading>

      {creating && <CreateModal role={role} classes={classes.data || []} onClose={() => setCreating(false)} onDone={(rows) => { setCreating(false); setCreds({ title: `${rows.filter((r) => r.ok !== false).length} account${rows.length === 1 ? '' : 's'} created`, rows }); list.reload() }} />}
      {creds && <Credentials rows={creds.rows} title={creds.title} onClose={() => setCreds(null)} />}
      {move && (
        <Modal title={`Class for ${move.full_name}`} onClose={() => setMove(null)} footer={<><Button onClick={() => setMove(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!moveTo} onClick={doMove}>Save</Button></>}>
          <Field label="Class this year"><select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">Choose…</option>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
          <p className="small muted">The student gets the next roll number in the new class. Their earlier attendance and marks stay with them.</p>
        </Modal>
      )}
    </>
  )
}
