'use client'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Field, Loading, PageHead, Segmented } from '@/components/ui'
import { useMe } from '@/lib/profile'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useAction, useAsync } from '@/lib/hooks'
import { fmtDate, q, todayISO } from '@/lib/util'

export default function StaffAttendance() {
  const { school } = useMe()
  const sb = supabaseBrowser()
  const today = todayISO(school.timezone)
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const [marks, setMarks] = useState<Record<string, string>>({})
  const { busy, run } = useAction()
  const isPast = date < today

  const roster = useAsync<any>(async () => {
    const teachers = await q<any[]>(sb.from('profiles').select('id,full_name,login_id').eq('role', 'teacher').eq('is_active', true).order('full_name'))
    const existing = teachers.length ? await q<any[]>(sb.from('staff_attendance').select('profile_id,status').eq('date', date)) : []
    return { teachers, existing }
  }, [date])

  useEffect(() => {
    if (!roster.data) return
    const m: Record<string, string> = {}
    roster.data.existing.forEach((a: any) => (m[a.profile_id] = a.status))
    setMarks(m)
  }, [roster.data])

  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, late: 0, leave: 0 }
    Object.values(marks).forEach((s) => (c[s] = (c[s] || 0) + 1))
    return c
  }, [marks])
  const total = roster.data?.teachers.length || 0
  const done = Object.keys(marks).length
  const already = (roster.data?.existing.length || 0) > 0
  const absentCount = (counts.absent || 0) + (counts.leave || 0)

  const save = () =>
    run(async () => {
      const rows = roster.data.teachers.filter((t: any) => marks[t.id]).map((t: any) => ({ profile_id: t.id, status: marks[t.id] }))
      if (rows.length < total && !window.confirm(`${total - rows.length} teachers have no mark yet. Save anyway?`)) return
      await q(sb.rpc('save_staff_attendance', { p_date: date, p_rows: rows, p_reason: reason || null }))
      setReason('')
      roster.reload()
    }, absentCount > 0 ? `Saved. Substitutes were suggested automatically for ${absentCount} absent teacher${absentCount > 1 ? "s'" : "'s"} periods today.` : 'Attendance saved.')

  return (
    <>
      <PageHead title="Staff attendance" sub="A daily register for teachers. Marking someone absent or on leave suggests substitutes for their periods automatically — no extra step." />
      <Alert>The moment a teacher is marked <b>absent</b> or <b>leave</b> here, the system finds their periods for that day and suggests a free substitute for each one by itself. Review or change any suggestion under <Link href="/substitutions">Substitutions</Link>.</Alert>
      <Card>
        <div className="grid c2">
          <Field label="Date"><input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} /></Field>
          {isPast && <Field label="Reason for the change" hint="Required for earlier days"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to mark" /></Field>}
        </div>
      </Card>
      <Loading loading={roster.loading} error={roster.error} hasData={!!roster.data}>
        {roster.data?.teachers.length === 0 && <Card><Empty>No teachers yet. Add some under Accounts.</Empty></Card>}
        {(roster.data?.teachers.length || 0) > 0 && (
          <Card flush>
            <div className="row between" style={{ padding: 16 }}>
              <div className="row">
                <b>{fmtDate(date)}</b>
                {already && <Badge kind="good">Already marked</Badge>}
                <Badge kind="good">Present {counts.present}</Badge><Badge kind="warn">Late {counts.late}</Badge><Badge kind="bad">Absent {counts.absent}</Badge><Badge kind="accent">Leave {counts.leave}</Badge>
              </div>
              <div className="row">
                <Button small onClick={() => { const m = { ...marks }; roster.data.teachers.forEach((t: any) => { if (!m[t.id]) m[t.id] = 'present' }); setMarks(m) }}>Mark unmarked as present</Button>
                <Button small variant="primary" loading={busy} disabled={done === 0} onClick={save}>Save attendance ({done}/{total})</Button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="table"><tbody>
                {roster.data.teachers.map((t: any) => (
                  <tr key={t.id}>
                    <td><b>{t.full_name}</b><br /><span className="small muted">{t.login_id}</span></td>
                    <td className="num"><Segmented value={marks[t.id]} onChange={(s) => setMarks({ ...marks, [t.id]: s })} /></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </Card>
        )}
      </Loading>
      <p className="small muted">P = present, A = absent, L = late. Only the school office can mark staff attendance.</p>
    </>
  )
}
