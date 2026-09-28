'use client'
import { useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAsync } from '@/lib/hooks'
import { fmtDateTime, q } from '@/lib/util'

const TABLES: [string, string][] = [
  ['', 'Everything'], ['attendance', 'Attendance'], ['marks', 'Marks'], ['exams', 'Exams'], ['report_cards', 'Report cards'], ['report_remarks', 'Report remarks'],
  ['enrolments', 'Class placement'], ['promotion_runs', 'Year-end plans'], ['grade_change_requests', 'Grade change requests'], ['profiles', 'Accounts'],
  ['substitutions', 'Substitutions'], ['timetable_entries', 'Timetable'], ['leave_requests', 'Leave'], ['notices', 'Official notices'], ['daily_notes', 'Daily notes'],
  ['guardian_consents', 'Consents'], ['schools', 'School settings'],
]
const IGNORE = new Set(['id', 'school_id', 'created_at', 'updated_at'])

function summary(r: any) {
  const o = r.old_data || {}, n = r.new_data || {}
  if (r.action === 'INSERT') return Object.entries(n).filter(([k, v]) => !IGNORE.has(k) && v !== null && !/_id$/.test(k)).slice(0, 5).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
  if (r.action === 'DELETE') return 'removed ' + Object.entries(o).filter(([k, v]) => !IGNORE.has(k) && v !== null && !/_id$/.test(k)).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ')
  const diffs = Object.keys(n).filter((k) => !IGNORE.has(k) && JSON.stringify(n[k]) !== JSON.stringify(o[k]))
  return diffs.map((k) => `${k}: ${JSON.stringify(o[k]) ?? '—'} → ${JSON.stringify(n[k]) ?? '—'}`).join(' · ') || '—'
}

export default function Audit() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const [table, setTable] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const size = 50
  const d = useAsync<any>(async () => {
    let query = sb.from('audit_log').select('id,actor_id,table_name,row_id,action,old_data,new_data,created_at', { count: 'exact' }).order('id', { ascending: false }).range(page * size, page * size + size - 1)
    if (table) query = query.eq('table_name', table)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to + 'T23:59:59')
    const { data, error, count } = await query
    if (error) throw error
    const ids = Array.from(new Set(data.map((r: any) => r.actor_id).filter(Boolean)))
    const names = ids.length ? await q<any[]>(sb.from('profiles').select('id,full_name,login_id').in('id', ids as string[])) : []
    return { rows: data, count: count || 0, names: Object.fromEntries(names.map((n) => [n.id, n])) as Record<string, any> }
  }, [table, from, to, page])
  return (
    <>
      <PageHead title="Audit log" sub="Every change to attendance, marks, grades, accounts and more. It cannot be edited or deleted." />
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="What"><select className="input" value={table} onChange={(e) => { setTable(e.target.value); setPage(0) }}>{TABLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} /></Field>
        </div>
      </Card>
      <Loading loading={d.loading} error={d.error} hasData={!!d.data}>
        <Card flush>
          {d.data?.rows.length === 0 && <Empty>Nothing recorded.</Empty>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
            <tbody>
              {(d.data?.rows || []).map((r: any) => (
                <tr key={r.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at, school.timezone)}</td>
                  <td className="small">{r.actor_id ? (d.data.names[r.actor_id]?.full_name || 'Someone') : <span className="muted">System</span>}</td>
                  <td><Badge>{r.table_name}</Badge> <Badge kind={r.action === 'DELETE' ? 'bad' : r.action === 'INSERT' ? 'good' : 'accent'}>{r.action.toLowerCase().replace('_', ' ')}</Badge></td>
                  <td className="small" style={{ maxWidth: 520, overflowWrap: 'anywhere' }}>{summary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        <div className="row between">
          <span className="small muted">{d.data?.count} entries</span>
          <div className="row"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</Button><Button disabled={(page + 1) * size >= (d.data?.count || 0)} onClick={() => setPage(page + 1)}>Older →</Button></div>
        </div>
      </Loading>
      <Alert>Passwords are never stored in this log. Password resets and account changes show who did them.</Alert>
    </>
  )
}
