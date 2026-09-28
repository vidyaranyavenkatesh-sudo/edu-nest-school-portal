'use client'
import { useState } from 'react'
import { Badge, Button, Card, Empty, Field, Loading, PageHead, StatusBadge, Tabs } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { useTeachers } from '@/lib/data'
import { addDays, fmtDate, q, todayISO } from '@/lib/util'

const LEAVE_COLS = 'id,kind,from_date,to_date,reason,status,created_at,requester_id,requester:profiles!leave_requests_requester_id_fkey(full_name)'

export default function Leave() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const teachers = useTeachers()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState('')
  const [absentTeacher, setAbsentTeacher] = useState('')
  const [aFrom, setAFrom] = useState(today)
  const [aTo, setATo] = useState(today)
  const [aReason, setAReason] = useState('')
  const [tab, setTab] = useState('inbox')
  const { busy, run } = useAction()

  const mine = useAsync<any[]>(() => q(sb.from('leave_requests').select(LEAVE_COLS).eq('requester_id', me.id).order('created_at', { ascending: false }).limit(20)), [])
  const others = useAsync<any[]>(() => q(sb.from('leave_requests').select(LEAVE_COLS).neq('requester_id', me.id).order('created_at', { ascending: false }).limit(60)), [])

  const apply = () => run(async () => { await q(sb.rpc('request_leave', { p_from: from, p_to: to, p_reason: reason })); setReason(''); mine.reload() }, 'Leave request sent to the school office')
  const decide = (id: string, approve: boolean) => run(async () => { await q(sb.rpc('decide_leave', { p_id: id, p_approve: approve })); others.reload() }, approve ? 'Approved' : 'Not approved')
  const markAbsent = () => run(async () => {
    if (!absentTeacher) throw new Error('Choose a teacher')
    await q(sb.rpc('mark_teacher_absent', { p_teacher: absentTeacher, p_from: aFrom, p_to: aTo, p_reason: aReason }))
    setAReason(''); others.reload()
  }, 'Recorded. Go to Substitutions to find cover for their periods.')

  const inbox = (others.data || []).filter((l) => l.status === 'pending')
  const history = (others.data || []).filter((l) => l.status !== 'pending')
  return (
    <>
      <PageHead title="Leave" sub={me.role === 'admin' ? 'Approve leave and record teacher absences' : 'Apply for leave and approve your students’ leave'} />
      <Tabs tabs={[['inbox', `To decide${inbox.length ? ` (${inbox.length})` : ''}`], ['mine', 'My leave'], ...(me.role === 'admin' ? [['absent', 'Mark a teacher absent'] as [string, string]] : []), ['history', 'History']]} value={tab} onChange={setTab} />

      {tab === 'inbox' && (
        <Loading loading={others.loading} error={others.error} hasData={!!others.data}>
          {inbox.length === 0 && <Card><Empty>No leave requests waiting for you.</Empty></Card>}
          {inbox.map((l) => (
            <Card key={l.id}>
              <div className="row between">
                <div><b>{l.requester?.full_name}</b> <Badge>{l.kind === 'student' ? 'Student' : 'Teacher'}</Badge><br />
                  {fmtDate(l.from_date)}{l.to_date !== l.from_date && ` → ${fmtDate(l.to_date)}`}<br /><span className="muted">{l.reason || 'No reason given'}</span></div>
                <div className="row">
                  <Button variant="primary" loading={busy} onClick={() => decide(l.id, true)}>Approve</Button>
                  <Button variant="danger" loading={busy} onClick={() => decide(l.id, false)}>Decline</Button>
                </div>
              </div>
            </Card>
          ))}
        </Loading>
      )}

      {tab === 'mine' && (
        <>
          {me.role === 'teacher' && (
            <Card title="Apply for leave">
              <div className="grid c3">
                <Field label="From"><input className="input" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
                <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              </div>
              <div style={{ marginTop: 12 }}><Button variant="primary" loading={busy} onClick={apply}>Send request</Button></div>
            </Card>
          )}
          <Loading loading={mine.loading} error={mine.error} hasData={!!mine.data}>
            <Card title="My requests">
              {mine.data?.length === 0 && <Empty>Nothing yet.</Empty>}
              <table className="table"><tbody>{(mine.data || []).map((l) => <tr key={l.id}><td>{fmtDate(l.from_date)}{l.to_date !== l.from_date && ` → ${fmtDate(l.to_date)}`}<br /><span className="small muted">{l.reason}</span></td><td className="num"><StatusBadge status={l.status} /></td></tr>)}</tbody></table>
            </Card>
          </Loading>
        </>
      )}

      {tab === 'absent' && me.role === 'admin' && (
        <Card title="Mark a teacher absent">
          <p className="muted">Use this when a teacher calls in sick. It is recorded as approved leave, and their periods will show up under Substitutions.</p>
          <div className="grid c2">
            <Field label="Teacher"><select className="input" value={absentTeacher} onChange={(e) => setAbsentTeacher(e.target.value)}><option value="">Choose…</option>{(teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
            <Field label="Reason"><input className="input" value={aReason} onChange={(e) => setAReason(e.target.value)} /></Field>
            <Field label="From"><input className="input" type="date" value={aFrom} onChange={(e) => { setAFrom(e.target.value); if (aTo < e.target.value) setATo(e.target.value) }} /></Field>
            <Field label="To"><input className="input" type="date" value={aTo} min={aFrom} onChange={(e) => setATo(e.target.value)} /></Field>
          </div>
          <div style={{ marginTop: 12 }}><Button variant="primary" loading={busy} onClick={markAbsent}>Record absence</Button> <Button onClick={() => { setAFrom(addDays(today, 1)); setATo(addDays(today, 1)) }}>Tomorrow</Button></div>
        </Card>
      )}

      {tab === 'history' && (
        <Loading loading={others.loading} error={others.error} hasData={!!others.data}>
          <Card flush>
            {history.length === 0 && <Empty>No earlier requests.</Empty>}
            <table className="table"><tbody>{history.map((l) => <tr key={l.id}><td><b>{l.requester?.full_name}</b> <span className="small muted">{l.kind}</span><br />{fmtDate(l.from_date)}{l.to_date !== l.from_date && ` → ${fmtDate(l.to_date)}`}</td><td className="muted small">{l.reason}</td><td className="num"><StatusBadge status={l.status} /></td></tr>)}</tbody></table>
          </Card>
        </Loading>
      )}
    </>
  )
}
