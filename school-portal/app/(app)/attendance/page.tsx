'use client'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead, Segmented } from '@/components/ui'
import { useMe, setting } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { useMyClasses, usePeriods } from '@/lib/data'
import { classLabel, fmtDate, q, todayISO } from '@/lib/util'

export default function Attendance() {
  const { me, school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const mode = setting(school, 'attendance_mode', 'day')
  const my = useMyClasses()
  const periods = usePeriods()
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(today)
  const [periodId, setPeriodId] = useState('')
  const [reason, setReason] = useState('')
  const [marks, setMarks] = useState<Record<string, string>>({})
  const { busy, run } = useAction()

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('class')) setClassId(p.get('class') as string)
    if (p.get('date')) setDate(p.get('date') as string)
  }, [])
  useEffect(() => { if (!classId && my.data?.classes.length) setClassId(my.data.classes[0].id) }, [my.data, classId])
  useEffect(() => { if (mode === 'period' && !periodId && periods.data?.length) setPeriodId(periods.data[0].id) }, [mode, periods.data, periodId])

  const cls = my.data?.classes.find((c) => c.id === classId)
  const isPast = date < today
  const isClassTeacher = me.role === 'admin' || cls?.class_teacher_id === me.id

  const roster = useAsync<any>(async () => {
    if (!classId) return null
    const enr = await q<any[]>(sb.from('enrolments').select('id,roll_no,student:profiles(id,full_name)').eq('class_id', classId).eq('status', 'active').order('roll_no'))
    const ids = enr.map((e) => e.id)
    let att = ids.length ? sb.from('attendance').select('enrolment_id,status').eq('date', date).in('enrolment_id', ids) : null
    if (att) att = mode === 'period' ? att.eq('period_id', periodId || '00000000-0000-0000-0000-000000000000') : att.is('period_id', null)
    const existing = att ? await q<any[]>(att) : []
    const leaves = await q<any[]>(sb.from('leave_requests').select('requester_id').eq('kind', 'student').eq('status', 'approved').lte('from_date', date).gte('to_date', date))
    return { enr, existing, leaveIds: new Set(leaves.map((l) => l.requester_id)) }
  }, [classId, date, periodId, mode])

  useEffect(() => {
    if (!roster.data) return
    const m: Record<string, string> = {}
    roster.data.existing.forEach((a: any) => (m[a.enrolment_id] = a.status))
    roster.data.enr.forEach((e: any) => { if (!m[e.id] && roster.data.leaveIds.has(e.student.id)) m[e.id] = 'leave' })
    setMarks(m)
  }, [roster.data])

  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, late: 0, leave: 0 }
    Object.values(marks).forEach((s) => (c[s] = (c[s] || 0) + 1))
    return c
  }, [marks])
  const total = roster.data?.enr.length || 0
  const done = Object.keys(marks).length
  const already = (roster.data?.existing.length || 0) > 0

  const save = () =>
    run(async () => {
      const rows = roster.data.enr.filter((e: any) => marks[e.id]).map((e: any) => ({ enrolment_id: e.id, status: marks[e.id] }))
      if (rows.length < total && !window.confirm(`${total - rows.length} students have no mark yet. Save anyway?`)) return
      await q(sb.rpc('save_attendance', { p_class_id: classId, p_date: date, p_period_id: mode === 'period' ? periodId : null, p_rows: rows, p_reason: reason || null }))
      setReason('')
      roster.reload()
    }, 'Attendance saved. Absent students have been told and can see their notes.')

  return (
    <>
      <PageHead title="Take attendance" sub={mode === 'period' ? 'Marked once for every period' : 'Marked once per day'} />
      <Loading loading={my.loading} error={my.error} hasData={!!my.data}>
        {my.data?.classes.length === 0 && <Card><Empty>You are not assigned to any class yet. Ask the school office to assign your classes.</Empty></Card>}
        {(my.data?.classes.length || 0) > 0 && (
          <Card>
            <div className="grid c4">
              <Field label="Class"><select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>{my.data!.classes.map((c) => <option key={c.id} value={c.id}>Class {classLabel(c)}</option>)}</select></Field>
              <Field label="Date"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></Field>
              {mode === 'period' && <Field label="Period"><select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{(periods.data || []).map((p) => <option key={p.id} value={p.id}>Period {p.number}</option>)}</select></Field>}
              {isPast && <Field label="Reason for the change" hint="Required for earlier days"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to mark" /></Field>}
            </div>
            {isPast && !isClassTeacher && <Alert kind="warn">Only the class teacher or the school office can change earlier days.</Alert>}
          </Card>
        )}
        <Loading loading={roster.loading} error={roster.error} hasData={!!roster.data}>
          {roster.data && (
            <Card flush>
              <div className="row between" style={{ padding: 16 }}>
                <div className="row">
                  <b>{fmtDate(date)}</b>
                  {already && <Badge kind="good">Already marked</Badge>}
                  <Badge kind="good">Present {counts.present}</Badge><Badge kind="warn">Late {counts.late}</Badge><Badge kind="bad">Absent {counts.absent}</Badge><Badge kind="accent">Leave {counts.leave}</Badge>
                </div>
                <div className="row">
                  <Button small onClick={() => { const m = { ...marks }; roster.data.enr.forEach((e: any) => { if (!m[e.id]) m[e.id] = 'present' }); setMarks(m) }}>Mark unmarked as present</Button>
                  <Button small variant="primary" loading={busy} disabled={done === 0 || (isPast && !isClassTeacher)} onClick={save}>Save attendance ({done}/{total})</Button>
                </div>
              </div>
              {roster.data.enr.length === 0 && <Empty>No students in this class yet.</Empty>}
              <div className="table-wrap">
                <table className="table"><tbody>
                  {roster.data.enr.map((e: any) => (
                    <tr key={e.id}>
                      <td className="num small muted" style={{ width: 50 }}>{e.roll_no}</td>
                      <td><b>{e.student.full_name}</b></td>
                      <td className="num"><Segmented value={marks[e.id]} onChange={(s) => setMarks({ ...marks, [e.id]: s })} disabled={isPast && !isClassTeacher} /></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </Card>
          )}
        </Loading>
      </Loading>
      <p className="small muted">P = present, A = absent, L = late. “Leave” can only be set by the class teacher or the office (or is filled in automatically for approved leave).</p>
    </>
  )
}
