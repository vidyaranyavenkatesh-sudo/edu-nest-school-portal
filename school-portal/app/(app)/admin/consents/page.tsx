'use client'
import { useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHead } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync, useDebounced } from '@/lib/hooks'
import { fmtDate, q } from '@/lib/util'

const PURPOSES = ['Attendance', 'Marks and report cards', 'Communication with the school', 'Notes and learning material']
const METHODS = ['Signed form kept by the school', 'Verified in person', 'Digital verification (e.g. DigiLocker)', 'Guardian already known to the school']

export default function Consents() {
  const { me } = useMe()
  const sb = supabaseBrowser()
  const [search, setSearch] = useState('')
  const term = useDebounced(search, 300)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [limit, setLimit] = useState(60)
  const [form, setForm] = useState<any>(null)
  const { busy, run } = useAction()

  const d = useAsync<any>(async () => {
    let query = sb.from('profiles').select('id,full_name,login_id').eq('role', 'student').eq('is_active', true).order('full_name').limit(limit)
    if (term) { const t = term.replace(/[%,()]/g, ' '); query = query.or(`full_name.ilike.%${t}%,login_id.ilike.%${t.toUpperCase()}%`) }
    const students = await q<any[]>(query)
    const ids = students.map((s) => s.id)
    const consents = ids.length ? await q<any[]>(sb.from('guardian_consents').select('id,student_id,guardian_name,relationship,verified_method,purposes,consented_at,withdrawn_at').in('student_id', ids).order('consented_at', { ascending: false })) : []
    return { students, consents }
  }, [term, limit])

  const rows = (d.data?.students || []).map((s: any) => ({ s, c: (d.data.consents.filter((x: any) => x.student_id === s.id)) })).filter((r: any) => !onlyMissing || !r.c.some((x: any) => !x.withdrawn_at))
  const save = () => run(async () => {
    if (!form.guardian_name.trim()) throw new Error('Enter the guardian’s name')
    await q(sb.from('guardian_consents').insert({ school_id: me.school_id, student_id: form.student.id, guardian_name: form.guardian_name.trim(), relationship: form.relationship, verified_method: form.method, purposes: form.purposes, recorded_by: me.id }))
    setForm(null); d.reload()
  }, 'Consent recorded')
  const withdraw = (id: string) => window.confirm('Record that the guardian has withdrawn consent?') && run(async () => { await q(sb.from('guardian_consents').update({ withdrawn_at: new Date().toISOString() }).eq('id', id)); d.reload() }, 'Withdrawal recorded')

  return (
    <>
      <PageHead title="Guardian consents" sub="A record of who agreed to the school processing each child's data (India's DPDP Act treats everyone under 18 as a child)" />
      <Alert>Keep the signed form or proof yourself. This page only records <b>who</b> consented, <b>when</b>, <b>for what</b> and <b>how it was verified</b>. A guardian can withdraw at any time: record it here and speak to your lawyer about what must then stop. This is a record-keeping aid, not legal advice.</Alert>
      <Card>
        <div className="row">
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search a student" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />Only students with no active consent</label>
        </div>
      </Card>
      <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
        {rows.length === 0 && <Card><Empty>No students to show.</Empty></Card>}
        {rows.length > 0 && (
          <Card flush><div className="table-wrap"><table className="table">
            <thead><tr><th>Student</th><th>Consent</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ s, c }: any) => {
                const active = c.filter((x: any) => !x.withdrawn_at)
                return (
                  <tr key={s.id}>
                    <td><b>{s.full_name}</b><br /><span className="small muted">{s.login_id}</span></td>
                    <td>
                      {active.length === 0 && <Badge kind="bad">No active consent</Badge>}
                      {active.map((x: any) => <div key={x.id} className="small"><Badge kind="good">Consented</Badge> {x.guardian_name}{x.relationship && ` (${x.relationship})`} · {fmtDate(String(x.consented_at).slice(0, 10))} · {x.verified_method} <a style={{ cursor: 'pointer', color: 'var(--bad)' }} onClick={() => withdraw(x.id)}>withdraw</a><br /><span className="muted">{(x.purposes || []).join(', ')}</span></div>)}
                      {c.filter((x: any) => x.withdrawn_at).map((x: any) => <div key={x.id} className="small muted">Withdrawn {fmtDate(String(x.withdrawn_at).slice(0, 10))}: {x.guardian_name}</div>)}
                    </td>
                    <td className="num"><Button small onClick={() => setForm({ student: s, guardian_name: '', relationship: 'Parent', method: METHODS[0], purposes: [...PURPOSES] })}>Record consent</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table></div></Card>
        )}
        {(d.data?.students.length || 0) >= limit && <div className="row" style={{ justifyContent: 'center' }}><Button onClick={() => setLimit(limit + 60)}>Show more</Button></div>}
      </Loading>
      {form && (
        <Modal title={`Consent for ${form.student.full_name}`} onClose={() => setForm(null)} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save record</Button></>}>
          <div className="stack">
            <Field label="Guardian's name"><input className="input" value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} autoFocus /></Field>
            <Field label="Relationship"><select className="input" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>{['Parent', 'Legal guardian', 'Other'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="How was it verified?"><select className="input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <div><b style={{ fontSize: '.88rem' }}>Agreed to</b>{PURPOSES.map((p) => <label key={p} className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={form.purposes.includes(p)} onChange={(e) => setForm({ ...form, purposes: e.target.checked ? [...form.purposes, p] : form.purposes.filter((x: string) => x !== p) })} />{p}</label>)}</div>
          </div>
        </Modal>
      )}
    </>
  )
}
