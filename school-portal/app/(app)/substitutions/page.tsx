'use client'
import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead, StatusBadge } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { useTeachers } from '@/lib/data'
import { addDays, classLabel, fmtDate, fmtTime, q, todayISO } from '@/lib/util'

const COLS = 'id,date,status,substitute_id,absent_teacher_id,declined_by,period:periods(number,start_time),entry:timetable_entries(subject:subjects(name),class:classes(id,section,grade:grade_levels(name)))'

function AdminView() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 7))
  const teachers = useTeachers()
  const [choice, setChoice] = useState<Record<string, string>>({})
  const { busy, run } = useAction()
  const list = useAsync<any[]>(() => q(sb.from('substitutions').select(COLS).gte('date', from).lte('date', to).order('date').order('period_id')), [from, to])
  const name = Object.fromEntries((teachers.data || []).map((t) => [t.id, t.full_name]))
  useEffect(() => { const c: Record<string, string> = {}; (list.data || []).forEach((s) => { if (s.substitute_id) c[s.id] = s.substitute_id }); setChoice(c) }, [list.data])

  const generate = () => run(async () => { const n = await q<number>(sb.rpc('generate_substitutions', { p_from: from, p_to: to })); list.reload(); if (n === 0) throw new Error('No periods need cover in this range. Mark a teacher absent first (Leave → Mark a teacher absent).') }, 'Suggestions updated')
  const assign = (id: string, teacher: string | null, status: string) => run(async () => { await q(sb.rpc('assign_substitution', { p_id: id, p_substitute: teacher, p_status: status })); list.reload() }, status === 'approved' ? 'Approved. The teacher has been told.' : 'Saved')

  const need = (list.data || []).filter((s) => ['unassigned', 'suggested', 'declined'].includes(s.status)).length
  return (
    <>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button variant="primary" loading={busy} onClick={generate}>Find substitutes</Button>
        </div>
        <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>The system lists every period of absent teachers and suggests a free teacher who is not on leave, preferring the same subject, then the same grade, then whoever has covered the fewest periods this month.</p>
      </Card>
      {need > 0 && <Alert kind="warn">{need} period{need > 1 ? 's' : ''} still need a decision.</Alert>}
      <Loading loading={list.loading} error={list.error} hasData={!!list.data}>
        {list.data?.length === 0 && <Card><Empty>No substitutions in this range.</Empty></Card>}
        {(list.data || []).length > 0 && (
          <Card flush><div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Period</th><th>Class</th><th>Absent teacher</th><th>Substitute</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.data!.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.date)}</td>
                  <td>P{s.period?.number}<br /><span className="small muted">{fmtTime(s.period?.start_time)}</span></td>
                  <td>{classLabel(s.entry?.class)}<br /><span className="small muted">{s.entry?.subject?.name}</span></td>
                  <td>{name[s.absent_teacher_id] || '—'}</td>
                  <td>
                    <select className="input" style={{ minWidth: 170 }} value={choice[s.id] || ''} onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })} disabled={s.status === 'accepted'}>
                      <option value="">— none —</option>
                      {(teachers.data || []).filter((t) => t.id !== s.absent_teacher_id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                    </select>
                    {s.declined_by?.length > 0 && <div className="small muted">Declined by {s.declined_by.map((x: string) => name[x]).join(', ')}</div>}
                  </td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="num"><div className="row end">
                    {s.status !== 'accepted' && <Button small variant="primary" loading={busy} disabled={!choice[s.id]} onClick={() => assign(s.id, choice[s.id], 'approved')}>{s.status === 'approved' ? 'Change' : 'Approve'}</Button>}
                    {s.status !== 'self_study' && s.status !== 'accepted' && <Button small onClick={() => assign(s.id, null, 'self_study')}>Self study</Button>}
                    {s.status === 'accepted' && <Button small onClick={() => window.confirm('Take this back?') && assign(s.id, null, 'unassigned')}>Undo</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table></div></Card>
        )}
      </Loading>
    </>
  )
}

function TeacherView() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const { busy, run } = useAction()
  const duties = useAsync<any[]>(() => q(sb.from('substitutions').select(COLS).eq('substitute_id', me.id).gte('date', addDays(today, -7)).order('date')), [])
  const covered = useAsync<any[]>(() => q(sb.from('substitutions').select(COLS).eq('absent_teacher_id', me.id).gte('date', today).order('date')), [])
  const respond = (id: string, accept: boolean) => run(async () => { await q(sb.rpc('respond_substitution', { p_id: id, p_accept: accept })); duties.reload() }, accept ? 'Accepted' : 'Declined')
  return (
    <>
      <Card title="My substitution duties">
        <Loading loading={duties.loading} error={duties.error} hasData={!!duties.data}>
          {duties.data?.length === 0 && <Empty>None.</Empty>}
          {(duties.data || []).map((s) => (
            <div key={s.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span><b>{fmtDate(s.date)}</b> · P{s.period?.number} · Class {classLabel(s.entry?.class)} · {s.entry?.subject?.name}</span>
              <span className="row"><StatusBadge status={s.status} />
                {s.status === 'approved' && <><Button small variant="primary" loading={busy} onClick={() => respond(s.id, true)}>Accept</Button><Button small variant="danger" loading={busy} onClick={() => respond(s.id, false)}>Decline</Button></>}
              </span>
            </div>
          ))}
        </Loading>
      </Card>
      <Card title="My periods being covered">
        <Loading loading={covered.loading} error={covered.error} hasData={!!covered.data}>
          {covered.data?.length === 0 && <Empty>None coming up.</Empty>}
          {(covered.data || []).map((s) => <div key={s.id} style={{ padding: '6px 0' }}><b>{fmtDate(s.date)}</b> · P{s.period?.number} · Class {classLabel(s.entry?.class)} <StatusBadge status={s.status} /></div>)}
        </Loading>
      </Card>
    </>
  )
}

export default function Substitutions() {
  const { me } = useMe()
  return (
    <>
      <PageHead title="Substitutions" sub={me.role === 'admin' ? 'Cover for absent teachers' : 'Periods you cover, and periods covered for you'} />
      {me.role === 'admin' ? <AdminView /> : <TeacherView />}
      {me.role === 'admin' && <p className="small muted"><Badge>Tip</Badge> A substitute who accepts can take attendance and post notes for that class on that day.</p>}
    </>
  )
}
